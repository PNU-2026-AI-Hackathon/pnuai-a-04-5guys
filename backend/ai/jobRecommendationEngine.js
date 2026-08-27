// Scores real scraped job/internship postings against a student profile.
//
// careerRecommendationEngine.js also exists, but it scores against a small
// hand-curated catalog of career *archetypes* (2 entries: "AI Engineer",
// "Data Scientist"), each carrying rich tag fields (academicAreas,
// strengths, careerAreas, learningStyles) — that catalog is a career-path
// suggestion tool, not the live job/internship listings. Real scraped
// postings (career_opportunity table / JobKorea) only ever carry
// title/company/role/jobType/location/deadline — no tag fields — so they
// can't be scored by that engine. This one matches student profile tags
// against the free-text title/role/company instead.
const TAG_SOURCES = [
  { key: 'interests', weight: 10 },
  { key: 'careerAreas', weight: 8 },
  { key: 'academicAreas', weight: 6 },
];

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeadlineUrgency(deadline, asOfDate) {
  const deadlineDate = parseDate(deadline);
  const currentDate = parseDate(asOfDate);
  if (!deadlineDate || !currentDate) {
    return { expired: false, urgencyScore: 0 };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((deadlineDate.getTime() - currentDate.getTime()) / dayMs);

  if (daysRemaining < 0) return { expired: true, urgencyScore: 0 };
  if (daysRemaining <= 7) return { expired: false, urgencyScore: 20 };
  if (daysRemaining <= 30) return { expired: false, urgencyScore: 10 };
  return { expired: false, urgencyScore: 0 };
}

function scoreJob(studentProfile, job, asOfDate) {
  const haystack = normalizeText(`${job.title} ${job.role || ''} ${job.company || ''}`);
  const matchedTags = [];
  let score = 0;

  TAG_SOURCES.forEach(({ key, weight }) => {
    normalizeArray(studentProfile[key]).forEach((tag) => {
      const normalizedTag = normalizeText(tag);
      if (normalizedTag && haystack.includes(normalizedTag)) {
        score += weight;
        matchedTags.push(tag);
      }
    });
  });

  const { expired, urgencyScore } = getDeadlineUrgency(job.deadline, asOfDate);
  if (expired) {
    return { score: 0, matchReason: null };
  }
  score += urgencyScore;

  const matchReason = matchedTags.length
    ? `Matches your interests: ${matchedTags.slice(0, 2).join(', ')}`
    : urgencyScore >= 20
      ? 'Application deadline is approaching soon'
      : null;

  return { score, matchReason };
}

function compareJobs(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  return String(a.title || '').localeCompare(String(b.title || ''));
}

/**
 * Ranks real job/internship postings by relevance to the student profile.
 * Falls back to the soonest-deadline postings when nothing scores above 0
 * (e.g. a student with no interests/career-area tags set yet), so the
 * recommended section is never empty just because the profile is thin.
 */
function recommendJobs(studentProfile = {}, jobs = [], options = {}) {
  const asOfDate =
    typeof options.asOfDate === 'string'
      ? options.asOfDate
      : new Date().toISOString().slice(0, 10);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0 ? options.limit : normalizeArray(jobs).length;

  const scored = normalizeArray(jobs)
    .map((job) => ({ ...job, ...scoreJob(studentProfile, job, asOfDate) }))
    .filter((job) => !getDeadlineUrgency(job.deadline, asOfDate).expired);

  const relevant = scored.filter((job) => job.score > 0).sort(compareJobs);
  if (relevant.length > 0) {
    return relevant.slice(0, limit);
  }

  // Nothing matched the profile — fall back to soonest-deadline postings
  // rather than showing an empty recommended section.
  return scored
    .slice()
    .sort((a, b) => {
      const aDate = parseDate(a.deadline);
      const bDate = parseDate(b.deadline);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate.getTime() - bDate.getTime();
    })
    .slice(0, limit)
    .map((job) => ({ ...job, matchReason: job.matchReason || 'Upcoming opportunity' }));
}

module.exports = {
  recommendJobs,
};
