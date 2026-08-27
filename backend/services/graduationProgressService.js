/**
 * Build graduation credit progress + grade summary from DB rows
 * (enrollments + academic_record summary).
 */

const DEFAULT_CREDIT_REQUIREMENTS = {
  generalRequired: 10,
  generalElective: 15,
  majorBasic: 25,
  majorRequired: 43,
  majorElective: 34,
  generalFree: 6,
};

function isCompletedEnrollmentStatus(status) {
  const s = String(status || "").toLowerCase();
  return s.includes("complete") || s.includes("passed") || s === "done";
}

function isActiveEnrollmentStatus(status) {
  const s = String(status || "").toLowerCase();
  if (isCompletedEnrollmentStatus(s)) return false;
  if (!s) return true;
  return (
    s.includes("enroll") ||
    s.includes("active") ||
    s.includes("progress") ||
    s.includes("register") ||
    s.includes("current")
  );
}

function earnedCreditsForEnrollment(enrollment) {
  const explicit = enrollment?.credits_earned;
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    const parsed = Number(explicit);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  const grade = String(enrollment?.final_grade || enrollment?.grade || "")
    .trim()
    .toUpperCase();
  if (!grade || ["F", "NP", "U"].includes(grade)) return 0;
  return Number(enrollment?.credit) || Number(enrollment?.credits) || 0;
}

function mapEnrollmentToCreditBucket(category) {
  const c = String(category || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (c.includes("교양필수") || c.includes("generalrequired")) {
    return "generalRequired";
  }
  if (
    c.includes("교양선택") ||
    c.includes("generalelective") ||
    c === "gened" ||
    c === "gen_ed" ||
    c === "general"
  ) {
    return "generalElective";
  }
  if (c.includes("전공기초") || c.includes("majorbasic")) return "majorBasic";
  if (c.includes("전공필수") || c === "required" || c.includes("majorrequired")) {
    return "majorRequired";
  }
  if (c.includes("전공선택") || c === "elective" || c.includes("majorelective")) {
    return "majorElective";
  }
  if (
    c.includes("일반선택") ||
    c.includes("generalfree") ||
    c.includes("freeelective")
  ) {
    return "generalFree";
  }
  if (c.includes("major") || c.includes("전공")) return "majorRequired";
  if (c.includes("gen") || c.includes("교양")) return "generalElective";
  return "generalFree";
}

function creditBucketForEnrollment(enrollment, studentMajorId = null) {
  const bucket = mapEnrollmentToCreditBucket(enrollment?.category);
  const courseMajorId = enrollment?.course_major_id;
  const isKnownOtherMajor = studentMajorId != null
    && courseMajorId != null
    && String(studentMajorId) !== String(courseMajorId);
  if (isKnownOtherMajor && ["majorBasic", "majorRequired", "majorElective"].includes(bucket)) {
    return "generalFree";
  }
  return bucket;
}

function emptyBreakdown(requirements = DEFAULT_CREDIT_REQUIREMENTS) {
  return {
    generalRequired: { completed: 0, required: requirements.generalRequired },
    generalElective: { completed: 0, required: requirements.generalElective },
    majorBasic: { completed: 0, required: requirements.majorBasic },
    majorRequired: { completed: 0, required: requirements.majorRequired },
    majorElective: { completed: 0, required: requirements.majorElective },
    generalFree: { completed: 0, required: requirements.generalFree },
  };
}

function distributeCompletedCredits(breakdown, totalCompleted) {
  const keys = Object.keys(DEFAULT_CREDIT_REQUIREMENTS);
  const reqSum = keys.reduce((sum, key) => sum + breakdown[key].required, 0);
  if (reqSum <= 0 || totalCompleted <= 0) return;

  let assigned = 0;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      breakdown[key].completed = Math.max(0, totalCompleted - assigned);
      return;
    }
    const share = Math.floor(
      (totalCompleted * breakdown[key].required) / reqSum,
    );
    breakdown[key].completed = Math.min(share, breakdown[key].required);
    assigned += breakdown[key].completed;
  });
}

function gpaToLetter(gpa, scale = 4.5) {
  if (!Number.isFinite(gpa)) return null;
  if (scale >= 4.5) {
    if (gpa >= 4.3) return "A+";
    if (gpa >= 4.0) return "A";
    if (gpa >= 3.7) return "A-";
    if (gpa >= 3.3) return "B+";
    if (gpa >= 3.0) return "B";
    if (gpa >= 2.7) return "B-";
    if (gpa >= 2.3) return "C+";
    if (gpa >= 2.0) return "C";
    if (gpa >= 1.7) return "C-";
    if (gpa >= 1.0) return "D";
    return "F";
  }
  if (gpa >= 3.7) return "A";
  if (gpa >= 3.3) return "A-";
  if (gpa >= 3.0) return "B+";
  if (gpa >= 2.7) return "B";
  if (gpa >= 2.3) return "B-";
  if (gpa >= 2.0) return "C+";
  if (gpa >= 1.7) return "C";
  if (gpa >= 1.0) return "D";
  return "F";
}

function letterToGradePoint(letter) {
  if (!letter || typeof letter !== "string") return null;
  const normalized = letter.trim().toUpperCase();
  const map = {
    "A+": 4.5,
    "A0": 4.0,
    "A": 4.0,
    "A-": 3.7,
    "B+": 3.5,
    "B0": 3.0,
    "B": 3.0,
    "B-": 2.7,
    "C+": 2.5,
    "C0": 2.0,
    "C": 2.0,
    "C-": 1.7,
    "D+": 1.5,
    "D0": 1.0,
    "D": 1.0,
    "D-": 0.7,
    "F": 0.0,
  };
  return map[normalized] !== undefined ? map[normalized] : null;
}

function isMajorCategory(enrollment, studentMajorId = null) {
  const bucket = creditBucketForEnrollment(enrollment, studentMajorId);
  return (
    bucket === "majorBasic" ||
    bucket === "majorRequired" ||
    bucket === "majorElective"
  );
}

function computeGpaFromEnrollments(enrollments = [], studentMajorId = null) {
  let totalGradePoints = 0;
  let totalGradedCredits = 0;

  let majorGradePoints = 0;
  let majorGradedCredits = 0;

  let totalCompletedCredits = 0;

  const semesterMap = new Map();

  for (const row of enrollments) {
    const isCompleted = isCompletedEnrollmentStatus(row.status);
    const attemptedCredits =
      Number(row.credit) ||
      Number(row.credits) ||
      Number(row.credits_earned) ||
      0;

    if (isCompleted) {
      totalCompletedCredits += earnedCreditsForEnrollment(row);
    }

    const gradePoint = letterToGradePoint(row.final_grade || row.grade);
    if (gradePoint !== null && attemptedCredits > 0) {
      totalGradePoints += gradePoint * attemptedCredits;
      totalGradedCredits += attemptedCredits;

      if (isMajorCategory(row, studentMajorId)) {
        majorGradePoints += gradePoint * attemptedCredits;
        majorGradedCredits += attemptedCredits;
      }

      const semKey = row.semester || "Other";
      if (!semesterMap.has(semKey)) {
        semesterMap.set(semKey, {
          gradePoints: 0,
          credits: 0,
          semester: semKey,
        });
      }
      const semEntry = semesterMap.get(semKey);
      semEntry.gradePoints += gradePoint * attemptedCredits;
      semEntry.credits += attemptedCredits;
    }
  }

  const overallGpa =
    totalGradedCredits > 0
      ? Number((totalGradePoints / totalGradedCredits).toFixed(2))
      : null;
  const majorGpa =
    majorGradedCredits > 0
      ? Number((majorGradePoints / majorGradedCredits).toFixed(2))
      : null;

  let standing = "Good";
  if (overallGpa !== null) {
    if (overallGpa >= 4.0) standing = "Dean's List";
    else if (overallGpa >= 2.0) standing = "Good";
    else standing = "Probation";
  }

  const semesters = Array.from(semesterMap.values()).map((sem, idx) => ({
    semester_label: sem.semester,
    gpa:
      sem.credits > 0
        ? Number((sem.gradePoints / sem.credits).toFixed(2))
        : 0,
    sort_order: idx + 1,
  }));

  return {
    overallGpa,
    majorGpa,
    gpaScale: 4.5,
    standing,
    totalCompletedCredits,
    semesters,
    hasGradedCourses: totalGradedCredits > 0,
  };
}

function sumSemesterCredits(enrollments) {
  const active = enrollments.filter((row) =>
    isActiveEnrollmentStatus(row.status),
  );
  const current =
    active.length > 0
      ? active
      : enrollments.filter((row) => !isCompletedEnrollmentStatus(row.status));
  const rows = current.length > 0 ? current : enrollments;
  return rows.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
}

/**
 * @param {object} params
 * @param {Array<object>} params.enrollments - flat enrollment rows with status/credit/category/final_grade
 * @param {object|null} params.academicSummary - legacy academic_record summary row (+ optional major_gpa)
 * @param {Array<object>} [params.semesters] - legacy academic_record semester rows
 */
function buildGraduationProgress({
  enrollments = [],
  academicSummary = null,
  semesters = [],
  catalogRequired = 0,
  studentMajorId = null,
} = {}) {
  const breakdown = emptyBreakdown();

  for (const enrollment of enrollments) {
    if (!isCompletedEnrollmentStatus(enrollment.status)) continue;
    const bucket = creditBucketForEnrollment(enrollment, studentMajorId);
    breakdown[bucket].completed += earnedCreditsForEnrollment(enrollment);
  }

  let totalCompleted = Object.values(breakdown).reduce(
    (sum, row) => sum + row.completed,
    0,
  );

  const requirementsTotal = Object.values(breakdown).reduce(
    (sum, row) => sum + row.required,
    0,
  );

  const summaryCompleted = Number(academicSummary?.completed_credits);

  // totalRequired is always derived from the graduation_requirement catalog.
  // Falls back to the breakdown bucket sum only if no catalog exists yet.
  const totalRequired = catalogRequired > 0 ? catalogRequired : requirementsTotal;

  if (
    totalCompleted === 0 &&
    Number.isFinite(summaryCompleted) &&
    summaryCompleted > 0
  ) {
    totalCompleted = summaryCompleted;
    distributeCompletedCredits(breakdown, totalCompleted);
  }

  const computed = computeGpaFromEnrollments(enrollments, studentMajorId);

  const hasCompletedCoursework =
    totalCompleted > 0 ||
    computed.hasGradedCourses ||
    (Number.isFinite(summaryCompleted) && summaryCompleted > 0) ||
    enrollments.some((row) => isCompletedEnrollmentStatus(row.status));

  // Compute GPA dynamically from enrollments first; fallback to legacy summary only if no graded enrollments
  let overallGpa = computed.overallGpa;
  let majorGpa = computed.majorGpa;
  let standing = computed.standing;
  let gpaScale = computed.gpaScale;

  if (overallGpa === null && academicSummary?.overall_gpa != null) {
    const rawOverall = Number(academicSummary.overall_gpa);
    if (Number.isFinite(rawOverall)) {
      overallGpa = rawOverall;
      const rawMajor = Number(academicSummary.major_gpa);
      majorGpa = Number.isFinite(rawMajor)
        ? rawMajor
        : semesters[0]
          ? Number(semesters[0].gpa)
          : overallGpa;
      standing = academicSummary.standing ?? standing;
      gpaScale = Number(academicSummary.gpa_scale) || 4.5;
    }
  }

  return {
    totalRequired,
    totalCompleted,
    breakdown,
    gradeSummary: {
      hasCompletedCoursework,
      overallGpa:
        hasCompletedCoursework && Number.isFinite(overallGpa)
          ? overallGpa
          : null,
      majorGpa:
        hasCompletedCoursework && Number.isFinite(majorGpa) ? majorGpa : null,
      gpaScale,
      averageLetter:
        hasCompletedCoursework && Number.isFinite(overallGpa)
          ? gpaToLetter(overallGpa, gpaScale)
          : null,
      semesterCredits: sumSemesterCredits(enrollments),
      standing: hasCompletedCoursework ? standing : null,
    },
  };
}

function toApiPayload(progress) {
  const { breakdown, gradeSummary, ...rest } = progress;
  return {
    total_required: rest.totalRequired,
    total_completed: rest.totalCompleted,
    breakdown: {
      general_required: breakdown.generalRequired,
      general_elective: breakdown.generalElective,
      major_basic: breakdown.majorBasic,
      major_required: breakdown.majorRequired,
      major_elective: breakdown.majorElective,
      general_free: breakdown.generalFree,
    },
    grade_summary: {
      has_completed_coursework: gradeSummary.hasCompletedCoursework,
      overall_gpa: gradeSummary.overallGpa,
      major_gpa: gradeSummary.majorGpa,
      gpa_scale: gradeSummary.gpaScale,
      average_letter: gradeSummary.averageLetter,
      semester_credits: gradeSummary.semesterCredits,
      standing: gradeSummary.standing,
    },
  };
}

module.exports = {
  DEFAULT_CREDIT_REQUIREMENTS,
  buildGraduationProgress,
  toApiPayload,
  isCompletedEnrollmentStatus,
  mapEnrollmentToCreditBucket,
  creditBucketForEnrollment,
  earnedCreditsForEnrollment,
  gpaToLetter,
  letterToGradePoint,
  computeGpaFromEnrollments,
};
