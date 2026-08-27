// Extracts structured fields (deadline, eligibility, required documents)
// from scraped PNU notice text via an LLM. Language-independent: always
// extracts from the original Korean source (never a translated copy), so
// the result is identical regardless of which language the student is
// viewing in — extracted once per notice, ever, then cached.
//
// This is a different job from noticeTranslationService: translation is
// explicitly told not to summarize or drop information; this service does
// the opposite on purpose — it distills specific fields out of the prose,
// and is told to return null/[] rather than invent a value that isn't
// actually stated in the text.
const { isOpenRouterConfigured } = require("./openrouterService");

const extractionCache = new Map(); // id -> { deadline, eligibility, requiredDocuments, fetchedAt }
const EXTRACTION_TTL_MS = 1000 * 60 * 60 * 24; // 24h — notice text never changes after it's written

const MAX_NOTICES_PER_REQUEST = 40;
const BATCH_SIZE = 10;
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
  return JSON.parse(cleaned);
}

function normalizeExtraction(raw) {
  const deadline =
    typeof raw?.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline.trim())
      ? raw.deadline.trim()
      : null;
  const eligibility =
    typeof raw?.eligibility === "string" && raw.eligibility.trim() ? raw.eligibility.trim() : null;
  const requiredDocuments = Array.isArray(raw?.requiredDocuments)
    ? raw.requiredDocuments.map((doc) => String(doc || "").trim()).filter(Boolean)
    : [];

  return { deadline, eligibility, requiredDocuments };
}

async function requestNoticeExtraction(items) {
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
You are extracting structured facts from official Pusan National University (PNU) notices, written in Korean.

For each notice, extract ONLY what is explicitly stated in the text:
- deadline: the application/submission deadline as "YYYY-MM-DD", or null if no deadline is stated or it cannot be resolved to an exact date
- eligibility: a short phrase (under 15 words) describing who may apply/participate, or null if not stated
- requiredDocuments: an array of required document names mentioned in the text, or [] if none are mentioned

Rules:
- Do NOT invent or infer a value that isn't actually in the text. If it isn't stated, use null / [].
- Do not resolve relative dates (e.g. "3일 이내") to an absolute date — only extract dates already given as calendar dates.

Return JSON ONLY: { "extractions": { "<id>": { "deadline": "YYYY-MM-DD"|null, "eligibility": "..."|null, "requiredDocuments": ["..."] } } }

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
          "X-Title": "Hey! PNU Notice Extraction",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 3000,
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
      if (parsed && typeof parsed.extractions === "object" && parsed.extractions) {
        return parsed.extractions;
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
      console.warn("[noticeExtractionService] model failed:", lastError.message);
    }
  }

  throw lastError || new Error("Notice extraction failed");
}

/**
 * Attaches `deadline` (fills it in only if the notice doesn't already have
 * one), `eligibility`, and `requiredDocuments` to each notice, extracted
 * from the notice's original Korean text. Notices past
 * MAX_NOTICES_PER_REQUEST or that fail to extract keep null/[] rather than
 * blocking the response — this never throws.
 */
async function extractNoticeInfo(notices) {
  if (!Array.isArray(notices) || notices.length === 0) return notices;
  if (!isOpenRouterConfigured()) return notices;

  const results = notices.map((notice) => ({
    ...notice,
    eligibility: notice.eligibility ?? null,
    requiredDocuments: notice.requiredDocuments ?? [],
  }));
  const toExtract = [];

  results.forEach((notice, index) => {
    if (index >= MAX_NOTICES_PER_REQUEST) return;
    const sourceTitle = notice.originalTitle || notice.title || "";
    const sourceBody = notice.originalBody || notice.body || "";
    if (!sourceTitle && !sourceBody) return;

    const cached = extractionCache.get(String(notice.id));
    if (cached && Date.now() - cached.fetchedAt < EXTRACTION_TTL_MS) {
      results[index].deadline = notice.deadline || cached.deadline;
      results[index].eligibility = cached.eligibility;
      results[index].requiredDocuments = cached.requiredDocuments;
      return;
    }

    toExtract.push({ index, id: String(notice.id), title: sourceTitle, body: sourceBody });
  });

  if (toExtract.length === 0) return results;

  try {
    const batches = chunkArray(toExtract, BATCH_SIZE);
    const dictionaries = await Promise.all(
      batches.map((batch) =>
        requestNoticeExtraction(batch.map(({ id, title, body }) => ({ id, title, body }))).catch(
          (err) => {
            console.warn("[noticeExtractionService] batch failed:", err.message);
            return {};
          },
        ),
      ),
    );
    const merged = Object.assign({}, ...dictionaries);

    toExtract.forEach(({ index, id }) => {
      const normalized = normalizeExtraction(merged[id]);
      results[index].deadline = results[index].deadline || normalized.deadline;
      results[index].eligibility = normalized.eligibility;
      results[index].requiredDocuments = normalized.requiredDocuments;
      extractionCache.set(id, { ...normalized, fetchedAt: Date.now() });
    });
  } catch (err) {
    console.warn("[noticeExtractionService] extraction failed:", err.message);
  }

  return results;
}

module.exports = {
  extractNoticeInfo,
};
