// Model slugs verified against OpenRouter's live list on 2026-08-20.
// google/gemini-1.5-flash and meta-llama/llama-3.3-70b-instruct:free were
// retired and returned 400/404 on every attempt, so cafeteria translation
// had no working model at all. Run `npm run check:models` to re-verify.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generateGeminiChat(message, languagePref, context) {
  if (!isGeminiConfigured()) {
    throw new Error("Gemini API key is not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const langName =
    languagePref === "KO"
      ? "Korean"
      : languagePref === "ZH"
        ? "Chinese (Simplified)"
        : "English";
  let systemInstruction = `You are the Hey! PNU Smart Assistant, an AI helper for international students at Pusan National University. Your specialty is PNU campus life, academics, and settlement in Korea, but you are a genuinely helpful assistant: answer any reasonable question the student asks rather than refusing it, and if it is unrelated to student life, answer briefly then gently offer to help with their studies or life at PNU. Keep your responses short (under 4 sentences), friendly, and helpful. Respond in ${langName}. IMPORTANT: The user's profile details (Major, completed semesters, intake term) are already provided above in 'Student Academic Background'. Do NOT ask the user what their major, year, or completed semesters are under any circumstances; use the provided context to answer directly.`;

  if (context) {
    systemInstruction += `\n\nUse the following verified PNU reference context to answer the user's question. If the question cannot be answered using this context, reply using your general knowledge but mention it is not from official PNU documentation:\n\n${context}`;
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemInstruction}\n\nUser Question: ${message}` }],
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  return text;
}

async function generateGeminiMajorAnalysis(userProfile, recommendations) {
  if (!isGeminiConfigured()) {
    return {
      enabled: false,
      analysis: null,
      warning:
        "Gemini is not configured yet. Rule-based recommendations are being used.",
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const prompt = `
You are the major recommendation assistant for Hey! PNU, a support platform for international students at Pusan National University.
Use only the supplied questionnaire data and rule-based recommendations.
Do not guarantee admission, scholarship eligibility, or graduation outcomes.
Treat the eligibility notes as reminders, not final admission decisions.

Input Profile: ${JSON.stringify(userProfile)}
Rule-based Recommendations: ${JSON.stringify(recommendations)}

Return valid JSON ONLY matching this format:
{
  "summary": "short overall recommendation summary",
  "gapAnalysis": [
    "one practical area the student can strengthen",
    "another practical area the student can strengthen"
  ],
  "recommendations": [
    {
      "id": "department id from the input",
      "claudeReason": "short, specific explanation"
    }
  ]
}
  `.trim();

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    const cleanedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return {
      enabled: true,
      analysis: JSON.parse(cleanedText),
      warning: null,
    };
  } catch (error) {
    console.error("Gemini major recommendation error:", error.message);
    return {
      enabled: false,
      analysis: null,
      warning: "Gemini analysis is temporarily unavailable.",
    };
  }
}

async function translateGeminiAnnouncement(imageBase64, mimeType, textContent) {
  if (!isGeminiConfigured()) {
    throw new Error("Gemini API key is not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const systemPrompt = `
You are the Hey! PNU Academic and Settlement Notice Translator.
Your job is to translate Pusan National University Korean announcements into clear English, and extract key action-items and deadlines.

Please return JSON ONLY matching the following schema:
{
  "translatedTitle": "Clear, concise translated title in English",
  "translation": "Paragraph-by-paragraph translation or detail summary in English",
  "deadlines": [
    "Key date/deadline 1 (e.g. 2026-08-10: Enrollment begins)",
    "Key date/deadline 2 (e.g. 2026-09-01: Document submission)"
  ],
  "actionItems": [
    "Practical action item for the student 1",
    "Practical action item for the student 2"
  ]
}
`;

  const parts = [];

  if (imageBase64 && mimeType) {
    const base64Data = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1]
      : imageBase64;

    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data,
      },
    });
    parts.push({
      text: `${systemPrompt}\n\nPlease translate this announcement image. Explain any dates and required steps.`,
    });
  } else {
    parts.push({
      text: `${systemPrompt}\n\nAnnouncement Text:\n${textContent || ""}\n\nPlease translate this text announcement.`,
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini");
  }

  const cleanedText = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleanedText);
}

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

const cafeteriaTranslationCache = new Map();
// Longer than the 3h menu cache so a warm translation survives the full menu
// lifespan and never forces a synchronous AI call mid-cycle.
const CAFETERIA_TRANSLATION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const cafeteriaTranslationInflight = new Map(); // cacheKey -> Promise

function collectCafeteriaStrings(cafeterias = []) {
  const strings = new Set();

  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    // Skip pure punctuation / placeholders
    if (text === "-" || text === "·") return;
    strings.add(text);
  };

  const collectMenu = (menu) => {
    add(menu?.week_label);

    for (const row of menu?.rows || []) {
      add(row.meal_type);
      for (const line of String(row.meal_label || "").split("\n")) {
        add(line);
      }

      for (const column of row.columns || []) {
        add(column.day_label);
        add(column.note);
        add(column.price);
        for (const item of column.items || []) add(item);

        for (const option of column.options || []) {
          add(option.price);
          for (const item of option.items || []) add(item);
        }
      }
    }
  };

  for (const hall of cafeterias) {
    // Mapped shape: { name, menu: { week_label, rows } }.
    // Raw scraped shape: { dining_hall, week_label, meals: rows } at top level.
    add(hall?.name ?? hall?.dining_hall);
    if (hall?.menu) {
      collectMenu(hall.menu);
    } else {
      collectMenu({ week_label: hall?.week_label, rows: hall?.meals });
    }
  }

  return [...strings];
}

function applyCafeteriaTranslations(cafeterias = [], dictionary = {}) {
  const translate = (value) => {
    if (value == null) return value;
    const text = String(value);
    if (!text.trim()) return value;
    return dictionary[text] ?? dictionary[text.trim()] ?? value;
  };

  return cafeterias.map((hall) => {
    const menu = hall.menu;
    if (!menu) {
      return { ...hall, name: translate(hall.name) };
    }

    return {
      ...hall,
      name: translate(hall.name),
      menu: {
        ...menu,
        week_label: translate(menu.week_label),
        rows: (menu.rows || []).map((row) => ({
          ...row,
          meal_type: translate(row.meal_type),
          meal_label: String(row.meal_label || "")
            .split("\n")
            .map((line) => translate(line))
            .join("\n"),
          columns: (row.columns || []).map((column) => {
            const options = (column.options || []).map((option) => ({
              ...option,
              price: translate(option.price),
              items: (option.items || []).map((item) => translate(item)),
            }));

            return {
              ...column,
              day_label: translate(column.day_label),
              note: translate(column.note),
              price: translate(column.price),
              items: (column.items || []).map((item) => translate(item)),
              options,
            };
          }),
        })),
      },
    };
  });
}

function parseGeminiJson(text) {
  const cleanedText = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleanedText);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function requestCafeteriaTranslationsViaOpenRouter(strings, langName) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key is not configured");
  }

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
You are translating a Pusan National University (PNU) cafeteria weekly menu for international students.
Translate each Korean string into natural ${langName}.

Rules:
- Return JSON ONLY: { "translations": { "<exact source string>": "<translated string>", ... } }
- Keep every source string as an exact key (do not drop or rename keys).
- Translate dish names, meal labels (조식/중식/석식), option titles (정식/일품), hall names, and notes.
- Keep numbers, times (e.g. 11:00~14:00), and prices readable (e.g. keep "5,000원" or use "5,000 won").
- Do not invent dishes. Do not add explanations.

Source strings:
${JSON.stringify(strings, null, 2)}
`.trim();

  let lastError = null;
  for (const model of models) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://localhost:3000",
          "X-Title": "Hey! PNU Cafeteria Translation",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });

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

      const parsed = parseGeminiJson(text);
      if (parsed && typeof parsed.translations === "object" && parsed.translations) {
        return parsed.translations;
      }
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
      throw new Error(`${model}: unexpected JSON shape`);
    } catch (error) {
      lastError = error;
      console.warn(
        "[geminiService] OpenRouter cafeteria model failed:",
        error.message,
      );
    }
  }

  throw lastError || new Error("OpenRouter cafeteria translation failed");
}

async function requestCafeteriaTranslations(strings, langName, { retries = 3 } = {}) {
  if (isGeminiConfigured()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `
You are translating a Pusan National University (PNU) cafeteria weekly menu for international students.
Translate each Korean string into natural ${langName}.

Rules:
- Return JSON ONLY: { "translations": { "<exact source string>": "<translated string>", ... } }
- Keep every source string as an exact key (do not drop or rename keys).
- Translate dish names, meal labels (조식/중식/석식), option titles (정식/일품), hall names, and notes.
- Keep numbers, times (e.g. 11:00~14:00), and prices readable (e.g. keep "5,000원" or use "5,000 won").
- Do not invent dishes. Do not add explanations.
- If a string is already in ${langName} or is only numbers/punctuation, return it unchanged.

Source strings:
${JSON.stringify(strings, null, 2)}
`.trim();

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.statusText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error("Empty response from Gemini");
        }

        const parsed = parseGeminiJson(text);
        if (parsed && typeof parsed.translations === "object" && parsed.translations) {
          return parsed.translations;
        }
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
        return {};
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        }
      }
    }
  }

  if (process.env.OPENROUTER_API_KEY) {
    try {
      return await requestCafeteriaTranslationsViaOpenRouter(strings, langName);
    } catch (fallbackError) {
      console.warn(
        "[geminiService] OpenRouter cafeteria translation failed:",
        fallbackError.message,
      );
    }
  }

  return {};
}

/**
 * Real-time AI translation for cafeteria menus (Korean source → target language).
 * Returns `{ cafeterias, translated }` — falls back to Korean on failure.
 *
 * @param {Array} cafeterias
 * @param {string} targetLanguage ISO language code (e.g. en, vi, my)
 * @param {string} [cacheSalt] stable key fragment (e.g. scraped_at / menu_date)
 * @param {{ nonBlocking?: boolean }} [options] when `nonBlocking` is true and the
 *   translation is not cached, this returns the Korean menu immediately and warms
 *   the cache in the background so HTTP requests never wait on the AI provider.
 */
async function translateCafeteriaMenus(cafeterias, targetLanguage = "en", cacheSalt = "", { nonBlocking = false } = {}) {
  const lang = String(targetLanguage || "en").toLowerCase().split("-")[0];
  if (!Array.isArray(cafeterias) || cafeterias.length === 0) {
    return { cafeterias, translated: false };
  }
  if (lang === "ko") {
    return { cafeterias, translated: false };
  }
  if (!isGeminiConfigured() && !process.env.OPENROUTER_API_KEY) {
    return { cafeterias, translated: false };
  }

  const strings = collectCafeteriaStrings(cafeterias);
  if (strings.length === 0) {
    return { cafeterias, translated: false };
  }

  const cacheKey = `${lang}:${cacheSalt || "current"}:${strings.length}`;
  const cached = cafeteriaTranslationCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CAFETERIA_TRANSLATION_TTL_MS) {
    return {
      cafeterias: applyCafeteriaTranslations(cafeterias, cached.dictionary),
      translated: true,
    };
  }

  const langName = LANGUAGE_NAMES[lang] || "English";

  const warm = async () => {
    const dictionary = {};
    const batches = chunkArray(strings, 40);
    const partials = await Promise.all(
      batches.map((batch) =>
        requestCafeteriaTranslations(batch, langName).catch((err) => {
          console.warn(`[geminiService] Batch translation failed for ${langName}:`, err.message);
          return {};
        })
      )
    );
    for (const partial of partials) {
      Object.assign(dictionary, partial);
    }

    if (Object.keys(dictionary).length === 0) {
      return false;
    }

    cafeteriaTranslationCache.set(cacheKey, {
      fetchedAt: Date.now(),
      dictionary,
    });
    return true;
  };

  if (nonBlocking) {
    // Never block the request on AI: kick off a single shared warm job and
    // return the Korean menu now so latency stays sub-second.
    if (!cafeteriaTranslationInflight.has(cacheKey)) {
      const job = warm()
        .catch(() => false)
        .finally(() => cafeteriaTranslationInflight.delete(cacheKey));
      cafeteriaTranslationInflight.set(cacheKey, job);
    }
    return { cafeterias, translated: false };
  }

  try {
    const translated = await warm();
    const warmed = cafeteriaTranslationCache.get(cacheKey);
    return {
      cafeterias:
        translated && warmed ? applyCafeteriaTranslations(cafeterias, warmed.dictionary) : cafeterias,
      translated,
    };
  } catch (error) {
    console.warn(
      "[geminiService] Cafeteria menu translation failed:",
      error.message,
    );
    return { cafeterias, translated: false };
  }
}

/**
 * Pre-translates cafeteria menus for common target languages to warm cache.
 * Languages are processed sequentially (not Promise.all) so a burst of
 * concurrent calls doesn't trip the provider rate limit at boot.
 */
async function preTranslateCafeteriaMenus(cafeterias, targetLanguages = ["en", "zh", "vi", "ja"], cacheSalt = "") {
  if (!Array.isArray(cafeterias) || cafeterias.length === 0) return;
  for (const lang of targetLanguages) {
    try {
      await translateCafeteriaMenus(cafeterias, lang, cacheSalt);
    } catch (err) {
      console.warn(`[geminiService] Pre-translation for ${lang} failed:`, err.message);
    }
  }
}

async function generateGeminiChatStream(message, languagePref, context) {
  if (!isGeminiConfigured()) {
    throw new Error("Gemini API key is not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${process.env.GEMINI_API_KEY}`;

  const langName =
    languagePref === "KO"
      ? "Korean"
      : languagePref === "ZH"
        ? "Chinese (Simplified)"
        : "English";
  let systemInstruction = `You are the Hey! PNU Smart Assistant, an AI helper for international students at Pusan National University. Your specialty is PNU campus life, academics, and settlement in Korea, but you are a genuinely helpful assistant: answer any reasonable question the student asks rather than refusing it, and if it is unrelated to student life, answer briefly then gently offer to help with their studies or life at PNU. Keep your responses short (under 4 sentences), friendly, and helpful. Respond in ${langName}. IMPORTANT: The user's profile details (Major, completed semesters, intake term) are already provided above in 'Student Academic Background'. Do NOT ask the user what their major, year, or completed semesters are under any circumstances; use the provided context to answer directly.`;

  if (context) {
    systemInstruction += `\n\nUse the following verified PNU reference context to answer the user's question. If the question cannot be answered using this context, reply using your general knowledge but mention it is not from official PNU documentation:\n\n${context}`;
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${systemInstruction}\n\nUser Question: ${message}` }],
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  return response.body;
}

const programTranslationCache = new Map(); // lang -> Map<programId, { fetchedAt, data, fields }>
const programTranslationInflight = new Map(); // chunkKey -> Promise (dedupes overlapping AI work)
const PROGRAM_TRANSLATION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const PROGRAM_TRANSLATION_BATCH_SIZE = 25;

function getProgramCache(lang) {
  let cache = programTranslationCache.get(lang);
  if (!cache) {
    cache = new Map();
    programTranslationCache.set(lang, cache);
  }
  return cache;
}

function toProgramCacheEntry(translation, includeDescriptions) {
  const data = {
    title: translation?.title || "",
    category: translation?.category || "",
    description: translation?.description || null,
    matchHint: translation?.matchHint || "",
  };
  const fields = {
    title: Boolean(data.title),
    category: Boolean(data.category),
    description: includeDescriptions ? Boolean(data.description) : false,
    matchHint: Boolean(data.matchHint),
  };
  return { fetchedAt: Date.now(), data, fields };
}

async function hydrateProgramTranslationsFromDb(ids, cache, lang) {
  const numericIds = [...new Set(ids.map((id) => Number(id)).filter((n) => Number.isInteger(n)))];
  if (!numericIds.length) return;

  let supabase;
  try {
    supabase = require("../supabaseClient");
  } catch {
    return;
  }

  const { data, error } = await supabase
    .from("program_translation")
    .select("program_id, title, category, description, match_hint")
    .eq("language", lang)
    .in("program_id", numericIds);

  if (error) {
    console.warn("[geminiService] Failed to read program translations from DB:", error.message);
    return;
  }

  for (const row of data || []) {
    cache.set(String(row.program_id), toProgramCacheEntry({
      title: row.title,
      category: row.category,
      description: row.description,
      matchHint: row.match_hint,
    }, true));
  }
}

async function upsertProgramTranslations(translations, lang) {
  const rows = (translations || [])
    .filter((t) => t && Number.isInteger(Number(t.id)))
    .map((t) => ({
      program_id: Number(t.id),
      language: lang,
      title: t.title || null,
      category: t.category || null,
      description: t.description || null,
      match_hint: t.matchHint || null,
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return;

  let supabase;
  try {
    supabase = require("../supabaseClient");
  } catch {
    return;
  }

  const { error } = await supabase
    .from("program_translation")
    .upsert(rows, { onConflict: "program_id, language" });

  if (error) {
    console.warn("[geminiService] Failed to persist program translations:", error.message);
  }
}

/**
 * Single AI call to translate a batch of program items into English.
 * Returns an array of `{ id, title, category, description?, matchHint }`.
 * When `includeDescriptions` is false, descriptions are omitted from the
 * request so the list endpoint stays fast (title/category/matchHint only).
 */
async function requestProgramTranslations(itemsToTranslate, langName, includeDescriptions = true) {
  const prompt = `
You are an expert academic translator for Pusan National University (PNU) extracurricular programs, student activities, and competitions.
Translate each program item from Korean into clear, high-quality ${langName}.

Rules:
- Return JSON ONLY matching this format:
{
  "translations": [
    {
      "id": "<matching exact string id>",
      "title": "<translated title in ${langName}>",
      "category": "<translated category in ${langName}>",
      ${includeDescriptions ? `"description": "<translated description in ${langName} - format as clean Markdown>",` : ""}
      "matchHint": "<translated matchHint in ${langName} if present>"
    }
  ]
}
${includeDescriptions ? "- Convert any HTML tags in the original description into clean, equivalent Markdown formatting.\n" : ""}- Do not alter IDs.
- Omit any field that is empty in the source item.

Programs to translate:
${JSON.stringify(itemsToTranslate, null, 2)}
`.trim();

  let jsonText = "";

  if (isGeminiConfigured()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    } catch (_err) {
      // ignore
    }
  }

  if (!jsonText && process.env.OPENROUTER_API_KEY) {
    const orUrl = "https://openrouter.ai/api/v1/chat/completions";
    const preferredModel = process.env.OPENROUTER_MODEL;
    const models = [
      ...(preferredModel ? [preferredModel] : []),
      "google/gemini-2.5-flash",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it:free",
      "openrouter/free",
    ];

    for (const model of models) {
      try {
        const response = await fetch(orUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://localhost:3000",
            "X-Title": "Hey! PNU Program Translation",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 4000,
          }),
        });

        if (!response.ok) {
          console.warn(
            `[geminiService] OpenRouter ${model}: ${response.status} ${response.statusText}`,
          );
          continue;
        }

        const data = await response.json();
        if (data.error) {
          console.warn(
            `[geminiService] OpenRouter ${model} error: ${data.error.message}`,
          );
          continue;
        }

        jsonText = data.choices?.[0]?.message?.content || "";
        if (jsonText) break;
      } catch (orErr) {
        console.warn(
          `[geminiService] OpenRouter ${model} exception: ${orErr.message}`,
        );
      }
    }
  }

  if (!jsonText) {
    return [];
  }

  const parsed = parseGeminiJson(jsonText);
  const translationList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.translations)
    ? parsed.translations
    : [];
  return Array.isArray(translationList) ? translationList : [];
}

/**
 * Real-time AI translation for Extracurricular Programs (Korean -> targetLanguage).
 * Translates program title, category, matchHint, and detailed description body.
 *
 * Results are cached per program id (not per request-list). A Supabase-backed
 * cache makes translations durable across restarts, and overlapping work is
 * deduped per chunk (not per whole job), so a request never waits for a
 * background warm to finish — it only translates its own missing items.
 *
 * @param {Array} programs Array of program objects
 * @param {string} targetLanguage ISO language code
 * @param {{ includeDescriptions?: boolean }} [options] When false (default for
 *   list views), descriptions are not sent to the AI provider, keeping the
 *   request fast; they are filled in by the background warm or the detail
 *   endpoint.
 */
async function translatePrograms(programs = [], targetLanguage = "en", options = {}) {
  const lang = String(targetLanguage || "en").toLowerCase().split("-")[0];
  if (!Array.isArray(programs) || programs.length === 0) {
    return programs;
  }
  // If target language is Korean, display original Korean
  if (lang === "ko") {
    return programs;
  }

  // Non-Korean option -> display in target language using Gemini API
  if (!isGeminiConfigured() && !process.env.OPENROUTER_API_KEY) {
    return programs;
  }

  const includeDescriptions = options.includeDescriptions === true;

  const langName = LANGUAGE_NAMES[lang] || "English";
  const cache = getProgramCache(lang);
  const now = Date.now();

  const isFresh = (entry) =>
    entry && now - entry.fetchedAt < PROGRAM_TRANSLATION_TTL_MS;

  const isReady = (entry) => {
    if (!isFresh(entry)) return false;
    const fields = entry.fields || {};
    if (includeDescriptions) return Boolean(fields.title) && Boolean(fields.description);
    return Boolean(fields.title || fields.category || fields.matchHint || fields.description);
  };

  const resolveMissing = () => programs.filter((p) => !isReady(cache.get(String(p.id))));

  let missing = resolveMissing();

  if (missing.length > 0) {
    await hydrateProgramTranslationsFromDb(missing.map((p) => p.id), cache, lang);
    missing = resolveMissing();
  }

  if (missing.length > 0) {
    const chunks = chunkArray(
      missing.map((p) => ({
        id: String(p.id),
        title: p.title || "",
        category: p.category || "",
        description: includeDescriptions ? p.description || "" : undefined,
        matchHint: p.matchHint || "",
      })),
      PROGRAM_TRANSLATION_BATCH_SIZE,
    );

    for (const chunk of chunks) {
      const chunkKey = `${lang}:${includeDescriptions ? "full" : "list"}:${chunk
        .map((i) => i.id)
        .sort()
        .join(",")}`;

      let inflight = programTranslationInflight.get(chunkKey);
      if (!inflight) {
        inflight = (async () => {
          const translations = await requestProgramTranslations(chunk, langName, includeDescriptions);
          for (const t of translations) {
            if (!t || !t.id) continue;
            cache.set(String(t.id), toProgramCacheEntry(t, includeDescriptions));
          }
          if (includeDescriptions) {
            await upsertProgramTranslations(translations, lang);
          }
        })().catch((error) => {
          console.warn("[geminiService] Program translation error:", error.message);
        }).finally(() => {
          programTranslationInflight.delete(chunkKey);
        });
        programTranslationInflight.set(chunkKey, inflight);
      }
      await inflight;
    }
  }

  return programs.map((p) => {
    const entry = cache.get(String(p.id));
    if (!isFresh(entry)) return p;
    const t = entry.data;
    return {
      ...p,
      title: t.title || p.title,
      category: t.category || p.category,
      description: t.description || p.description,
      matchHint: t.matchHint || p.matchHint,
    };
  });
}

const careerTranslationCache = new Map();

async function translateCareers(opportunities = [], targetLanguage = "en") {
  const lang = String(targetLanguage || "en").toLowerCase().split("-")[0];
  console.log(`[translateCareers] Called with ${opportunities.length} items, targetLanguage: ${targetLanguage}, resolved lang: ${lang}`);
  if (!Array.isArray(opportunities) || opportunities.length === 0) return opportunities;
  if (lang === "ko") return opportunities;
  if (!isGeminiConfigured() && !process.env.OPENROUTER_API_KEY) {
    console.log("[translateCareers] No API key configured, returning original.");
    return opportunities;
  }

  const langName =
    lang === "zh"
      ? "Chinese (Simplified)"
      : lang === "es"
        ? "Spanish"
        : lang === "my"
          ? "Burmese"
          : lang === "am"
            ? "Amharic"
            : "English";

  const cacheLang = lang;
  let cache = careerTranslationCache.get(cacheLang);
  if (!cache) {
    cache = new Map();
    careerTranslationCache.set(cacheLang, cache);
  }

  const missing = opportunities.filter((o) => !cache.has(String(o.id)));
  console.log(`[translateCareers] Cache missing for ${missing.length} items in ${langName}.`);

  if (missing.length > 0) {
    const chunks = chunkArray(missing, 20);
    for (const chunk of chunks) {
      const prompt = `
You are an expert translator for Pusan National University (PNU) career opportunities.
Translate each job/internship item from Korean into clear, high-quality ${langName}.
Return JSON ONLY matching this format:
{
  "translations": [
    {
      "id": "<exact string id>",
      "title": "<translated title in ${langName}>",
      "company": "<translated company name in ${langName}>",
      "matchReason": "<translated matchReason in ${langName} if present>"
    }
  ]
}

Items to translate:
${JSON.stringify(chunk.map(m => ({ id: m.id, title: m.title, company: m.company, matchReason: m.matchReason })), null, 2)}
`.trim();

      let jsonText = "";

      if (process.env.OPENROUTER_API_KEY) {
        const orUrl = "https://openrouter.ai/api/v1/chat/completions";
        const preferredModel = process.env.OPENROUTER_MODEL;
        const models = [
          ...(preferredModel ? [preferredModel] : []),
          "google/gemini-2.5-flash",
          "google/gemma-4-26b-a4b-it:free",
          "google/gemma-4-31b-it:free",
          "openrouter/free",
        ];

        for (const model of models) {
          try {
            const response = await fetch(orUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://localhost:3000",
                "X-Title": "Hey! PNU Career Translation",
              },
              body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
                max_tokens: 3000,
              }),
            });
            if (response.ok) {
              const data = await response.json();
              jsonText = data.choices?.[0]?.message?.content || "";
              if (jsonText) break;
            }
          } catch (err) {
            console.warn(`[geminiService] OpenRouter career translation failed on ${model}:`, err.message);
          }
        }
      }

      if (!jsonText && isGeminiConfigured()) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
            }),
          });
          if (response.ok) {
            const data = await response.json();
            jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          }
        } catch (_err) {
          // ignore
        }
      }

      if (jsonText) {
        const parsed = parseGeminiJson(jsonText);
        const list = Array.isArray(parsed) ? parsed : (parsed?.translations || []);
        console.log(`[translateCareers] Gemini returned ${list.length} translations`);
        for (const t of list) {
          if (t && t.id) {
            console.log(`[translateCareers] Saving cache for id: ${t.id}`);
            cache.set(String(t.id), {
              title: t.title,
              company: t.company,
              matchReason: t.matchReason
            });
          }
        }
      }
    }
  }

  return opportunities.map((p) => {
    const t = cache.get(String(p.id));
    if (!t) return p;
    return {
      ...p,
      title: t.title || p.title,
      company: t.company || p.company,
      matchReason: t.matchReason || p.matchReason,
    };
  });
}

module.exports = {
  isGeminiConfigured,
  generateGeminiChat,
  generateGeminiChatStream,
  generateGeminiMajorAnalysis,
  translateGeminiAnnouncement,
  translateCafeteriaMenus,
  preTranslateCafeteriaMenus,
  translatePrograms,
  translateCareers,
};

