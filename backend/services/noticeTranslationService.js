// Real-time AI translation for scraped PNU notices (Korean source -> target
// language). Mirrors the cafeteria-menu translation pattern in
// geminiService.js: OpenRouter only (Gemini is blocked account-wide, see
// ai-provider-setup notes), an in-memory cache so a notice is only ever
// translated once per language, and fail-open on any error so a broken
// translation call never breaks the notices list.
const { isOpenRouterConfigured } = require("./openrouterService");

const LANGUAGE_NAMES = {
  en: "English",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  th: "Thai",
  bn: "Bengali",
  mn: "Mongolian",
  vi: "Vietnamese",
  hi: "Hindi",
  kk: "Kazakh",
  id: "Indonesian",
  fa: "Persian",
  uz: "Uzbek",
  ja: "Japanese",
  my: "Burmese",
  ur: "Urdu",
  ru: "Russian",
  am: "Amharic",
  tr: "Turkish",
  es: "Spanish",
};

const noticeTranslationCache = new Map(); // `${lang}:${id}` -> { title, body, fetchedAt }
const NOTICE_TRANSLATION_TTL_MS = 1000 * 60 * 60 * 12; // 12h — notice text never changes after it's written

// Bounds worst-case per-request LLM latency regardless of the caller's
// `limit` query param. Notices past this are left in their original
// language rather than blocking the response.
const MAX_NOTICES_PER_REQUEST = 40;
// Small enough that a batch of full notice bodies + their translations
// reliably fits under max_tokens — a batch of 10 was overflowing it,
// truncating the JSON mid-response and failing every model in the
// fallback chain on every batch (each retry costs a full round trip).
const BATCH_SIZE = 2;
// Bounds how long a single model attempt can hang before the fallback
// chain moves to the next model — without it a stalled provider blocks
// the whole request with no upper bound.
const MODEL_TIMEOUT_MS = 12_000;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function parseJsonResponse(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    // Sanitise unescaped control characters inside JSON strings (e.g. raw newlines in long notice bodies)
    try {
      const sanitized = cleaned
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (ch) => {
          if (ch === "\n") return "\\n";
          if (ch === "\r") return "\\r";
          if (ch === "\t") return "\\t";
          return "";
        });
      return JSON.parse(sanitized);
    } catch (_err2) {
      // Fallback regex extractor for translations object { "<id>": { "title": "...", "body": "..." } }
      const translations = {};
      const idMatches = cleaned.matchAll(/"([^"]+)":\s*\{\s*"title":\s*"((?:[^"\\]|\\.)*)",\s*"body":\s*"((?:[^"\\]|\\.)*)"/gs);
      for (const m of idMatches) {
        translations[m[1]] = { title: m[2], body: m[3] };
      }
      if (Object.keys(translations).length > 0) {
        return { translations };
      }
      throw _err;
    }
  }
}

async function requestNoticeTranslations(items, langName) {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const preferredModel = process.env.OPENROUTER_MODEL;
  const models = [
    ...(preferredModel ? [preferredModel] : []),
    "google/gemini-2.5-flash",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",
  ];

  const prompt = `
You are translating official Pusan National University (PNU) notices for international students.
Translate each notice's title and body from Korean into natural ${langName}.

Rules:
- Return JSON ONLY: { "translations": { "<id>": { "title": "...", "body": "..." }, ... } }
- Keep every id exactly as given.
- These are official notices (deadlines, eligibility, procedures) — preserve meaning precisely. Do not summarize, shorten, or omit information.
- Keep dates, numbers, URLs, and office/department names as-is or naturally transliterated.
- If a field is already in ${langName}, return it unchanged.

Notices:
${JSON.stringify(items, null, 2)}
`.trim();

  let lastError = null;
  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://localhost:3000",
          "X-Title": "Hey! PNU Notice Translation",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 6000,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `${model}: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 160)}` : ""}`,
        );
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || `${model}: OpenRouter error`);
      }

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error(`${model}: empty response`);
      }

      const parsed = parseJsonResponse(text);
      if (parsed && typeof parsed.translations === "object" && parsed.translations) {
        return parsed.translations;
      }
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      throw new Error(`${model}: unexpected JSON shape`);
    } catch (error) {
      clearTimeout(timeoutId);
      lastError =
        error.name === "AbortError"
          ? new Error(`${model}: no response within ${MODEL_TIMEOUT_MS}ms`)
          : error;
      console.warn("[noticeTranslationService] model failed:", lastError.message);
    }
  }

  throw lastError || new Error("Notice translation failed");
}

/**
 * Translates a list of public notices `{ id, title, body, ... }` into
 * `targetLanguage`. Returns new objects with `title`/`body` replaced;
 * every other field is passed through unchanged. Falls back to the
 * original (Korean) text for any notice that fails to translate or sits
 * past MAX_NOTICES_PER_REQUEST — this never throws.
 */
async function translateNotices(notices, targetLanguage) {
  const lang = String(targetLanguage || "en").toLowerCase().split("-")[0];
  if (!Array.isArray(notices) || notices.length === 0) return notices;
  if (lang === "ko") return notices;
  if (!isOpenRouterConfigured()) return notices;

  const langName = LANGUAGE_NAMES[lang] || "English";
  const results = notices.map((notice) => ({
    ...notice,
    originalTitle: notice.title || "",
    originalBody: notice.body || "",
    translationLanguage: null,
  }));
  const toTranslate = [];

  results.forEach((notice, index) => {
    if (index >= MAX_NOTICES_PER_REQUEST) return;
    if (!notice.title && !notice.body) return;

    const cacheKey = `${lang}:${notice.id}`;
    const cached = noticeTranslationCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < NOTICE_TRANSLATION_TTL_MS) {
      results[index].title = cached.title;
      results[index].body = cached.body;
      results[index].translationLanguage = lang;
      return;
    }

    toTranslate.push({
      index,
      id: String(notice.id),
      title: notice.title || "",
      body: notice.body || "",
    });
  });

  if (toTranslate.length === 0) return results;

  try {
    const batches = chunkArray(toTranslate, BATCH_SIZE);
    const dictionaries = await Promise.all(
      batches.map((batch) =>
        requestNoticeTranslations(
          batch.map(({ id, title, body }) => ({ id, title, body })),
          langName,
        ).catch((err) => {
          console.warn("[noticeTranslationService] batch failed:", err.message);
          return {};
        }),
      ),
    );
    const merged = Object.assign({}, ...dictionaries);

    toTranslate.forEach(({ index, id }) => {
      const translated = merged[id];
      if (translated && (translated.title || translated.body)) {
        const title = translated.title || results[index].title;
        const body = translated.body || results[index].body;
        results[index].title = title;
        results[index].body = body;
        results[index].translationLanguage = lang;
        noticeTranslationCache.set(`${lang}:${id}`, {
          title,
          body,
          fetchedAt: Date.now(),
        });
      }
    });
  } catch (err) {
    console.warn("[noticeTranslationService] translation failed:", err.message);
  }

  return results;
}

module.exports = {
  translateNotices,
  LANGUAGE_NAMES,
};
