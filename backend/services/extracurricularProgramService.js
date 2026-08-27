/**
 * Manual Supabase catalog (program_id, name, category, deadline, source_url)
 * → AI-ranked recommendations for the Academic programs UI.
 */
const supabase = require('../supabaseClient');
const { recommendPrograms } = require('../ai/programRecommendationEngine');
const { translatePrograms } = require('./geminiService');

function normalizeTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/g, '');
}

function collectUserTags(...lists) {
  const tags = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const tag = normalizeTag(item);
      if (tag) tags.push(tag);
    }
  }
  return [...new Set(tags)];
}

function formatDeadline(value) {
  if (!value) return '';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, '.');
  }
  return String(value);
}

function startOfUtcDay(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseDateOnly(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Still open through tomorrow (or no deadline). */
function isOpenForApplication(row, now = new Date()) {
  const tomorrow = startOfUtcDay(now) + 24 * 60 * 60 * 1000;
  const deadline = parseDateOnly(row.deadline);
  if (deadline === null) return true;
  return deadline >= tomorrow;
}

function categoryTags(category) {
  const raw = String(category || '').trim();
  if (!raw) return [];
  const tags = [normalizeTag(raw)];
  for (const part of raw.split(/[\/|,·•]/)) {
    const tag = normalizeTag(part);
    if (tag) tags.push(tag);
  }
  return [...new Set(tags.filter(Boolean))];
}

function mapProgramRow(row, extras = {}) {
  return {
    id: String(row.program_id ?? row.id),
    title: row.name || 'Untitled program',
    description: row.description ? String(row.description) : '',
    date: formatDeadline(row.deadline),
    category: row.category || null,
    sourceUrl: row.source_url || null,
    score: extras.score,
    matchHint: extras.matchHint,
  };
}

function toEngineProgram(row) {
  return {
    id: String(row.program_id ?? row.id),
    title: row.name || 'Untitled program',
    description: row.description || row.category || '',
    date: row.deadline || '',
    category: row.category || null,
    tags: categoryTags(row.category),
    careerTags: categoryTags(row.category),
    eligibleMajors: [],
    languages: [],
    _row: row,
  };
}

async function fetchCatalogPrograms({ fetchLimit = 500 } = {}) {
  const { data, error } = await supabase
    .from('extracurricular_program')
    .select('*')
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(fetchLimit);

  if (error) throw error;
  return data || [];
}

async function fetchRecommendedPrograms({
  studentProfile = {},
  userTags = [],
  limit = 20,
  language = 'en',
  includeDescriptions = false,
} = {}) {
  const mapped = await rankPrograms({ studentProfile, userTags, limit });

  if (language && language !== 'ko' && mapped.length) {
    return translatePrograms(mapped, language, { includeDescriptions });
  }

  return mapped;
}

/**
 * Single-program lookup used by the detail page. Translates the full body
 * (including description) on demand, but only for the one requested program,
 * so the detail navigation stays cheap even on a cold cache.
 */
async function fetchProgramDetail({
  programId,
  studentProfile = {},
  userTags = [],
  limit = 500,
  language = 'en',
} = {}) {
  const mapped = await rankPrograms({ studentProfile, userTags, limit });
  const program = mapped.find((p) => String(p.id) === String(programId)) || null;
  if (!program) return null;

  if (language && language !== 'ko') {
    const [translated] = await translatePrograms([program], language, {
      includeDescriptions: true,
    });
    return translated || program;
  }

  return program;
}

async function rankPrograms({ studentProfile = {}, userTags = [], limit = 20 } = {}) {
  const tags = collectUserTags(userTags, studentProfile.interests, studentProfile.interestTags);
  const profile = {
    ...studentProfile,
    interests: tags.length ? tags : studentProfile.interests || [],
  };

  let openRows = [];
  try {
    openRows = await fetchCatalogPrograms();
  } catch (err) {
    console.error('[extracurricular] Failed to fetch programs from catalog table:', err.message);
  }

  if (!openRows.length) {
    try {
      const { data, error } = await supabase.rpc('recommended_programs', {
        user_tags: tags,
        result_limit: Math.max(limit, 100),
      });
      if (!error && Array.isArray(data)) {
        openRows = data.filter((row) => isOpenForApplication(row));
      }
    } catch (err) {
      openRows = [];
    }
  }

  if (!openRows.length) return [];

  const catalog = openRows.map(toEngineProgram);
  const openCatalog = catalog.filter((program) => isOpenForApplication(program._row));
  const ranked = recommendPrograms(profile, openCatalog, { limit: openCatalog.length });
  const rankedById = new Map(ranked.map((program) => [String(program.id), program]));
  const picked = catalog
    .map((program) => rankedById.get(String(program.id)) || {
      ...program,
      score: 0,
      matchHint: '',
    })
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)
      || String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.title || '').localeCompare(String(b.title || '')))
    .slice(0, limit);

  return picked.map((program) => {
    const row =
      program._row ||
      openRows.find((r) => String(r.program_id) === String(program.id));
    return mapProgramRow(row, {
      score: program.score,
      matchHint: program.matchHint,
    });
  });
}

/**
 * Pre-translates the full program catalog in the background so the first
 * Programs / dashboard request is served from the cache (memory + Supabase)
 * instead of blocking on the AI provider. Off the request path — never throws.
 */
async function warmProgramTranslations({ languages = ['en'] } = {}) {
  try {
    const openRows = await fetchCatalogPrograms();
    if (!openRows.length) return;

    const mapped = openRows.map((row) => mapProgramRow(row));
    for (const language of languages) {
      try {
        await translatePrograms(mapped, language, { includeDescriptions: true });
      } catch (err) {
        console.warn(
          `[extracurricular] Pre-translation for ${language} failed:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.warn('[extracurricular] Failed to warm program translations:', err.message);
  }
}

/**
 * Schedules recurring background pre-translation of programs.
 * Triggers once shortly after boot (matching the cafeteria pre-scrape pattern).
 */
function startProgramTranslationWarmSchedule(delayMs = 2000) {
  const timer = setTimeout(() => {
    warmProgramTranslations().catch(() => {});
  }, delayMs);
  if (timer.unref) {
    timer.unref();
  }
}

module.exports = {
  collectUserTags,
  rankPrograms,
  fetchRecommendedPrograms,
  fetchProgramDetail,
  warmProgramTranslations,
  startProgramTranslationWarmSchedule,
};

