const supabase = require("../supabaseClient");
const jwt = require("jsonwebtoken");
const {
  getCareerOpportunitiesPage,
} = require("../services/jobKoreaScraperService");
const {
  fetchStoredCareerOpportunities,
} = require("../services/careerOpportunityRepository");
const { getEmergencyGuide } = require("../services/emergencyGuideService");
const { getCampusFacilities } = require("../services/campusFacilitiesService");
const communityService = require("../services/communityService");
const { localizeRow } = require("../middleware/languageMiddleware");
const {
  resolveLanguagePref,
  SUPPORTED_LANGUAGE_PREFS,
} = require("../middleware/supportedLanguages");
const {
  noticeSourceLabel,
  scrapeRecentNotices,
} = require("../services/pnuNoticeScraperService");
const {
  synchronizeNotices,
} = require("../services/noticeSyncService");
const {
  fetchAllNotices,
} = require("../ai/supabaseDataRepository");
const { translateNotices } = require("../services/noticeTranslationService");
const { extractNoticeInfo } = require("../services/noticeExtractionService");
const { recommendJobs } = require("../ai/jobRecommendationEngine");
const { adaptStudentProfile } = require("../ai/studentProfileAdapter");
const { fetchStudentContext } = require("./aiController");
const supabaseAuth = require("../supabaseAuthClient");
const crypto = require("crypto");
const {
  verifyStudentPassword,
  setStudentPassword,
  findAuthUserByEmail,
  deleteAuthUserByEmail,
  SUPABASE_AUTH_MARKER,
} = require("../services/studentAuthService");
const {
  normalizeEmail,
  createLoginChallenge,
  consumeLoginChallenge,
  createPendingSignup,
  consumePendingSignup,
} = require("../services/loginChallengeService");
const { sendPasswordResetEmail } = require("../services/otpEmailService");
const { translateCareers } = require("../services/geminiService");
const {
  buildGraduationProgress,
  computeGpaFromEnrollments,
  toApiPayload: toGraduationApiPayload,
} = require("../services/graduationProgressService");
const {
  isCsGraduationTaskName,
  ensureGraduationRequirements,
  updateStudentGraduationRequirement,
} = require("../services/graduationRequirementService");
const {
  getChecklistForStudent,
  shouldShowChecklist,
  gradeFromYearChoice,
  studentTypeFromGrade,
  normalizeGrade,
  updateStudentChecklistStatus,
} = require("../services/semesterChecklistService");

const { JWT_SECRET } = require("../jwtConfig");

function displayNameFromEmail(email) {
  const local = String(email).split("@")[0] || "Student";
  return local.replace(/[._]+/g, " ").trim() || "Student";
}

/**
 * Domains PNU issues addresses on. pusan.ac.kr is the one almost everyone has;
 * the rest are live aliases the university also hands out.
 *
 * Deliberately absent, and worth naming so nobody adds them back:
 *   pusan.ac.kr.test-google-a.com — a Google Workspace verification artifact.
 *     It is a .com owned by Google, not by PNU, and it is exactly why the check
 *     below compares the domain rather than searching for a substring: an
 *     address at that domain *contains* "pusan.ac.kr" and would sail through a
 *     naive test, as would anything an attacker registers ending .evil.com.
 *   pusan.myplug.kr — a third-party mail relay, not a university identity.
 *
 * Override with SIGNUP_ALLOWED_EMAIL_DOMAINS (comma separated) to widen this
 * temporarily — for a demo from a personal address, say — without a code change.
 */
const DEFAULT_SCHOOL_EMAIL_DOMAINS = [
  "pusan.ac.kr",
  "pnu.ac.kr",
  "pnu.edu",
  "pnu.kr",
  "bnu.ac.kr",
  "bnu.kr",
  "busan.ac.kr",
];

function schoolEmailDomains() {
  const configured = String(process.env.SIGNUP_ALLOWED_EMAIL_DOMAINS || "").trim();
  if (!configured) return DEFAULT_SCHOOL_EMAIL_DOMAINS;
  return configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when the address sits on a university domain, or a subdomain of one.
 *
 * The domain is taken from the LAST "@" and compared whole — equal to an allowed
 * domain, or ending in "." plus one. Substring matching would accept
 * anything@pusan.ac.kr.attacker.com; a bare endsWith without the dot would
 * accept anything@notpusan.ac.kr.
 */
function isSchoolEmail(email) {
  const address = String(email ?? "").trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1) return false;

  const domain = address.slice(at + 1);
  return schoolEmailDomains().some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
}

/**
 * PostgREST treats `%` and `_` as wildcards inside .ilike(), and a raw address
 * goes straight in. Real PNU local parts routinely contain underscores —
 * htet_kaung_san@pusan.ac.kr — so an unescaped lookup can match a row that is
 * not the one asked for, and a pattern like "%@pusan.ac.kr" matches many, which
 * .maybeSingle() reports as an error the callers discard. The duplicate-account
 * guard then fails open.
 */
function escapeLikePattern(value) {
  return String(value ?? "").replace(/([\\%_])/g, "\\$1");
}

/** An account that never reached the nationality step, so it can be reclaimed. */
function isUnfinishedSignup(row) {
  const nationality = String(row?.nationality ?? "").trim().toLowerCase();
  return !nationality || nationality === "unknown";
}

function studentIdFromEmail(email) {
  const local = String(email).split("@")[0] || "";
  if (/^\d{8,9}$/.test(local)) {
    const asNumber = Number(local);
    if (Number.isSafeInteger(asNumber) && asNumber <= 2147483647) {
      return String(asNumber);
    }
  }
  const digest = crypto
    .createHash("sha256")
    .update(normalizeEmail(email))
    .digest();
  return String(1_000_000_000 + (digest.readUInt32BE(0) % 1_147_483_647));
}

async function reserveUnusedStudentId(email) {
  const candidates = [studentIdFromEmail(email)];
  for (let i = 1; i <= 8; i += 1) {
    // The salt goes BEFORE the address. studentIdFromEmail returns the local
    // part verbatim when it is 8-9 digits, and appending ":1" after the domain
    // leaves that local part unchanged — so every retry produced the same id and
    // the loop could never find a free one. Any student whose address is
    // <studentnumber>@pusan.ac.kr, which is the ordinary PNU format, hit a 500
    // the moment that id was already taken.
    candidates.push(studentIdFromEmail(`${i}:${email}`));
  }
  for (const candidate of candidates) {
    const { data } = await supabase
      .from("student")
      .select("student_id")
      .eq("student_id", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error("Could not allocate a student ID");
}

async function insertStudentAfterSignup({
  studentId,
  email,
  name,
  languagePref,
  nationality,
  majorId,
  grade,
  studentType,
}) {
  const insertPayload = {
    student_id: String(studentId),
    name: name || displayNameFromEmail(email),
    nationality: nationality || "Unknown",
    major_id: majorId || 1,
    student_type: studentType || "Current",
    visa_status: "None",
    password: SUPABASE_AUTH_MARKER,
    language_pref: languagePref || "en",
    is_in_korea: true,
    email,
    phone: "010-0000-0000",
    completed_courses: [],
    intake_term: "March",
  };
  if (grade !== undefined && grade !== null) {
    insertPayload.grade = grade;
  }

  const firstTry = await supabase
    .from("student")
    .insert(insertPayload)
    .select(
      `
        *,
        major:major_id (
          major_name,
          department
        )
      `,
    )
    .single();

  if (!firstTry.error) {
    return firstTry;
  }

  const errMsg = firstTry.error.message || "";
  const isColumnErr =
    errMsg.includes("is_in_korea") ||
    errMsg.includes("completed_courses") ||
    errMsg.includes("intake_term") ||
    firstTry.error.code === "42703";

  if (!isColumnErr) {
    return firstTry;
  }

  return supabase
    .from("student")
    .insert({
      student_id: String(studentId),
      name: name || displayNameFromEmail(email),
      nationality: nationality || "Unknown",
      major_id: majorId || 1,
      student_type: studentType || "Current",
      visa_status: "None",
      password: SUPABASE_AUTH_MARKER,
      language_pref: languagePref || "en",
      email,
      phone: "010-0000-0000",
    })
    .select(
      `
        *,
        major:major_id (
          major_name,
          department
        )
      `,
    )
    .single();
}

function buildAuthResponse(data) {
  const { major, password: _storedPassword, ...studentProfile } = data;
  const token = jwt.sign({ student_id: data.student_id }, JWT_SECRET, {
    expiresIn: "7d",
  });

  return {
    success: true,
    token,
    data: {
      ...studentProfile,
      major_name: major?.major_name ?? null,
      department: major?.department ?? null,
      token,
    },
  };
}

async function fetchStudentAuthRow({ email, studentId }) {
  const selection = `
        *,
        major:major_id (
          major_name,
          department
        )
      `;
  const query = supabase.from("student").select(selection);

  if (email) {
    return query.ilike("email", email).maybeSingle();
  }

  return query.eq("student_id", studentId).maybeSingle();
}

function formatScholarshipDeadline(deadline) {
  if (!deadline) {
    return "";
  }

  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) {
    return String(deadline);
  }

  const days = Math.ceil(
    (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (days >= 0) {
    return `D-${days}`;
  }

  return parsed.toISOString().slice(0, 10);
}

function mapScholarshipRow(row, language = "en") {
  const title =
    row.name ||
    row.title ||
    row.scholarship_name ||
    row.scholarship_title ||
    row.title_en ||
    row.name_en ||
    "Scholarship";

  const description =
    row.description ||
    row.content ||
    row.description_en ||
    row.summary ||
    "";

  const deadline = row.deadline || row.deadline_at || row.application_deadline || "";

  return {
    id: String(row.scholarship_id ?? row.id),
    title,
    description,
    deadline: deadline || "",
    eligibility: row.eligibility || row.requirements || "",
    amount: row.amount ?? null,
    provider: row.provider || row.organization || row.office || "PNU Scholarship Office",
    category: row.category ?? null,
    tag: row.tag ?? null,
    deadlineAt: row.deadline_at ?? row.deadlineAt ?? null,
    sourceUrl: row.source_url ?? row.sourceUrl ?? null,
  };
}

function isMissingTableError(error) {
  return error?.code === "PGRST205" || /could not find the table/i.test(error?.message || "");
}

function isScholarshipNotice(row) {
  return /장학|scholarship|학자금|등록금\s*지원/i.test(
    `${row?.title || ""} ${row?.content || ""}`,
  );
}

function mapScholarshipNotice(row, language = "en") {
  const localized = localizeRow(row, language, ["title", "content"]);
  return mapScholarshipRow(
    {
      id: `notice-${row.notice_id}`,
      title: localized.title || row.title,
      content: localized.content || row.content || "",
      provider: noticeSourceLabel(row.source) || "PNU",
      eligibility: "See the official notice for eligibility and application requirements.",
      category: row.source === "cse" ? "department" : "other",
      source_url: row.source_url,
    },
    language,
  );
}

function normalizeSearchText(value) {
  return String(value ?? "").toLowerCase().trim();
}

function getSearchTerms(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);
}

function calculateSearchScore(item, queryTerms) {
  const title = normalizeSearchText(item.title || item.course_name || item.name || item.major_name || item.program_name || item.scholarship_name || item.notice_title || item.label || "");
  const content = normalizeSearchText(
    item.content || item.description || item.summary || item.eligibility || item.department || item.provider || item.classroom || item.location || "",
  );
  const haystack = `${title} ${content}`;

  if (!haystack) return 0;

  let score = 0;
  if (queryTerms.length === 0) return score;

  const normalizedQuery = normalizeSearchText(queryTerms.join(" "));
  if (haystack.includes(normalizedQuery)) score += 25;

  queryTerms.forEach((term) => {
    if (title.includes(term)) score += 10;
    if (content.includes(term)) score += 4;
    if (haystack.includes(term)) score += 2;
  });

  return score;
}

function rankSearchItems(items, query) {
  const queryTerms = getSearchTerms(query);
  return items
    .map((item) => ({ ...item, _score: calculateSearchScore(item, queryTerms) }))
    .filter((item) => item._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 6)
    .map(({ _score, ...rest }) => rest);
}

async function fetchSearchTable(tableName, selectColumns = "*") {
  try {
    const { data, error } = await supabase.from(tableName).select(selectColumns);
    if (error) {
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

const testConnection = async (req, res) => {
  try {
    const { data, error } = await supabase.from("major").select("*").limit(1);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to query MAJOR table",
        error: error.message,
      });
    }

    res.json({
      success: true,
      message: "Database connection successful",
      count: data.length,
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getAllMajors = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("major")
      .select("*")
      .order("department", { ascending: true })
      .order("major_name", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch majors",
        error: error.message,
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const loginStudent = async (req, res) => {
  try {
    const { student_id, email, identifier, password } = req.body;
    const supplied = String(identifier ?? email ?? student_id ?? "").trim();

    if (!supplied) {
      return res.status(400).json({
        success: false,
        message: "Missing email or student ID",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Missing password",
      });
    }

    const isEmail = supplied.includes("@");
    const { data, error } = await fetchStudentAuthRow({
      email: isEmail ? normalizeEmail(supplied) : null,
      studentId: isEmail ? null : supplied,
    });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch student profile",
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: isEmail ? "Email not registered" : "Student ID not registered",
      });
    }

    const { ok } = await verifyStudentPassword({
      studentId: data.student_id,
      email: data.email,
      storedPassword: data.password,
      password,
    });

    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    if (!data.email) {
      return res.status(400).json({
        success: false,
        message: "Student has no email on file; cannot send verification code",
      });
    }

    let challenge;
    try {
      challenge = await createLoginChallenge({
        studentId: data.student_id,
        email: data.email,
      });
    } catch (challengeError) {
      if (challengeError.code === "OTP_DELIVERY_FAILED") {
        // Surfaced rather than swallowed. Returning a challengeId for a code
        // that was never sent puts the student on a verification screen that
        // can never succeed, with no way to tell why.
        console.error("[login-otp] delivery failed:", challengeError.message);
        return res.status(502).json({
          success: false,
          message: "We could not send your verification code. Please try again in a moment.",
          error: { status: 502, code: "OTP_DELIVERY_FAILED" },
        });
      }
      throw challengeError;
    }

    const payload = {
      success: true,
      requiresVerification: true,
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      message: "Verification code sent",
    };

    if (process.env.NODE_ENV === "test" || process.env.LOGIN_OTP_IN_RESPONSE === "1") {
      payload.debugCode = challenge.debugCode;
    }

    return res.json(payload);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const verifyLoginStudent = async (req, res) => {
  try {
    const { challengeId, code } = req.body;

    if (!challengeId || !code) {
      return res.status(400).json({
        success: false,
        message: "Missing challengeId or code",
      });
    }

    const result = consumeLoginChallenge({ challengeId, code });
    if (!result.ok) {
      const status =
        result.reason === "too_many_attempts"
          ? 429
          : result.reason === "invalid_code"
            ? 401
            : 400;
      const message =
        result.reason === "too_many_attempts"
          ? "Too many verification attempts"
          : result.reason === "invalid_code"
            ? "Invalid verification code"
            : "Verification challenge invalid or expired";

      return res.status(status).json({
        success: false,
        message,
      });
    }

    if (result.purpose === "signup") {
      return res.status(400).json({
        success: false,
        message: "Verification challenge invalid or expired",
      });
    }

    let { data, error } = await fetchStudentAuthRow({
      studentId: result.studentId,
    });

    if (!data && result.email) {
      const byEmail = await fetchStudentAuthRow({ email: result.email });
      data = byEmail.data;
      error = byEmail.error;
    }

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch student profile",
        error: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Email not registered",
      });
    }

    return res.json(buildAuthResponse(data));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const CURRENT_TERM = "2026-Fall";

const getStudentChecklist = async (req, res) => {
  try {
    const { student_id } = req.params;

    const { data: student, error: studentError } = await supabase
      .from("student")
      .select("grade, student_type, major_id, major:major_id(major_name)")
      .eq("student_id", student_id)
      .single();

    if (studentError || !student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
        error: studentError?.message,
      });
    }

    const grade = normalizeGrade(student.grade);
    const majorId = student.major_id;

    // Keep CS graduation milestones out of checklist_item.
    try {
      await ensureGraduationRequirements(supabase, student_id, majorId);
    } catch (ensureErr) {
      console.warn(
        "graduation_requirement ensure (from checklist) failed:",
        ensureErr.message || ensureErr,
      );
    }

    if (!shouldShowChecklist(grade)) {
      return res.json({
        success: true,
        is_new_fresher: false,
        checklist_eligible: false,
        grade,
        data: {},
      });
    }

    const { items, semester } = await getChecklistForStudent(
      supabase,
      student_id,
      grade,
    );

    const language = req.language || "en";
    const localizedItems = items
      .filter((item) => !isCsGraduationTaskName(item.task_name))
      .map((row) => {
        const localized = localizeRow(row, language, [
          "title",
          "description",
          "task_name",
        ]);
        return {
          ...row,
          title: localized.title ?? localized.task_name ?? row.title,
          description: localized.description ?? row.description,
          task_name: localized.task_name ?? row.task_name,
        };
      });

    const groupedChecklist = {
      [semester || CURRENT_TERM]: localizedItems,
    };

    return res.json({
      success: true,
      is_new_fresher: true,
      checklist_eligible: true,
      grade,
      data: groupedChecklist,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};


const updateChecklistItem = async (req, res) => {
  try {
    const { checklist_id } = req.params;
    const student_id = req.user?.student_id;
    let { status } = req.body;

    if (!student_id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Live DB constraint: Not Started | In Progress | Completed
    if (status === "Pending" || status === "pending") {
      status = "Not Started";
    }

    let data;
    try {
      data = await updateStudentChecklistStatus(
        supabase,
        student_id,
        checklist_id,
        status,
      );
    } catch (updateErr) {
      return res.status(404).json({
        success: false,
        message: "Checklist item not found",
        error: updateErr.message,
      });
    }

    const language = req.language || "en";
    const localized = localizeRow(data, language, [
      "title",
      "description",
      "task_name",
    ]);

    res.json({
      success: true,
      data: {
        ...data,
        title: localized.title ?? localized.task_name ?? data.title,
        description: localized.description ?? data.description,
        task_name: localized.task_name ?? data.task_name,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getAllScholarships = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("scholarship")
      .select("*")
      .order("deadline", { ascending: true });

    if (error && !isMissingTableError(error)) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch scholarships",
        error: error.message,
      });
    }

    // Some deployments have the legacy table but no rows. In that case the
    // verified PNU scholarship notices are still the best available source.
    if (isMissingTableError(error) || !Array.isArray(data) || data.length === 0) {
      const { data: notices, error: noticeError } = await supabase
        .from("notice")
        .select("notice_id,title,content,posted_date,source,source_url")
        .order("posted_date", { ascending: false })
        .limit(500);
      if (noticeError) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch scholarship notices",
          error: noticeError.message,
        });
      }
      const language = req.language || "en";
      return res.json({
        success: true,
        data: (notices || [])
          .filter(isScholarshipNotice)
          .map((row) => mapScholarshipNotice(row, language)),
        metadata: { source: "notice", verifiedOnly: true },
      });
    }

    const language = req.language || "en";
    res.json({
      success: true,
      data: (data || []).map((row) => mapScholarshipRow(row, language)),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const applyForScholarship = async (req, res) => {
  try {
    const { student_id, scholarship_id } = req.body;

    const { data, error } = await supabase
      .from("scholarship_application")
      .insert({
        student_id,
        scholarship_id,
        status: "Pending",
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to submit scholarship application",
        error: error.message,
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const signupStudent = async (req, res) => {
  try {
    const {
      student_id,
      name,
      nationality,
      major_name,
      student_type,
      visa_status,
      password,
      language_pref,
      is_in_korea,
      mbti,
      d2_semester,
      completed_courses,
      intake_term,
      email,
    } = req.body;

    const emailToUse = normalizeEmail(email);
    if (!emailToUse || !emailToUse.includes("@")) {
      return res.status(400).json({
        success: false,
        message: "An email address is required to create an account.",
        error: { status: 400, code: "EMAIL_REQUIRED" },
      });
    }

    // Checked before the code is sent, so a personal address fails immediately
    // rather than burning a send and leaving someone waiting on mail that could
    // never let them in.
    //
    // Signup only — never on the login path. Accounts that predate this rule
    // include one on gmail, and enforcing at login would lock that person out
    // of an account they already have.
    if (!isSchoolEmail(emailToUse)) {
      return res.status(400).json({
        success: false,
        message: "Sign up with your PNU school email (for example, @pusan.ac.kr).",
        error: { status: 400, code: "EMAIL_DOMAIN_NOT_ALLOWED" },
      });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const resolvedName = name
      ? String(name).trim()
      : displayNameFromEmail(emailToUse);

    if (!resolvedName) {
      return res.status(400).json({
        success: false,
        message: "Could not create an account from this email",
      });
    }

    // Nothing is deleted here. This endpoint is public and unauthenticated, and
    // it runs before any code is sent, so whoever typed the address has proved
    // nothing about owning it. Clearing an existing account at this point let
    // anyone destroy a stranger's profile — and, because every foreign key to
    // student cascades, their checklist, records, timetable and posts with it —
    // simply by typing their address into the signup form.
    //
    // A half-finished signup is still restartable: the cleanup moved to
    // completeSignupStudent, which only runs once the OTP has proved ownership.
    const { data: existingEmail } = await supabase
      .from("student")
      .select("student_id, nationality")
      .ilike("email", escapeLikePattern(emailToUse))
      .maybeSingle();

    if (existingEmail && !isUnfinishedSignup(existingEmail)) {
      return res.status(400).json({
        success: false,
        message: "Email already registered. Please log in instead.",
      });
    }

    let resolvedStudentId;
    try {
      resolvedStudentId = student_id
        ? String(student_id).trim()
        : await reserveUnusedStudentId(emailToUse);
    } catch (allocateError) {
      return res.status(500).json({
        success: false,
        message: allocateError.message,
      });
    }

    if (student_id) {
      const { data: existingStudent } = await supabase
        .from("student")
        .select("student_id")
        .eq("student_id", resolvedStudentId)
        .maybeSingle();

      if (existingStudent) {
        return res.status(400).json({
          success: false,
          message: "Student ID already registered",
        });
      }
    }

    let resolvedSignupLanguage = "en";
    if (language_pref) {
      const resolved = resolveLanguagePref(language_pref);
      if (!resolved) {
        return res.status(400).json({
          success: false,
          message: `Unsupported language_pref. Use one of: ${SUPPORTED_LANGUAGE_PREFS.join(", ")}`,
          error: { status: 400, code: "UNSUPPORTED_LANGUAGE" },
        });
      }
      resolvedSignupLanguage = resolved;
    }

    let challenge;
    try {
      challenge = await createLoginChallenge({
        studentId: resolvedStudentId,
        email: emailToUse,
        languagePref: resolvedSignupLanguage,
        purpose: "signup",
        password: String(password),
      });
    } catch (challengeError) {
      if (challengeError.code === "OTP_DELIVERY_FAILED") {
        console.error("[signup-otp] delivery failed:", challengeError.message);
        return res.status(502).json({
          success: false,
          message: "We could not send your verification code. Please try again in a moment.",
          error: { status: 502, code: "OTP_DELIVERY_FAILED" },
        });
      }
      throw challengeError;
    }

    const payload = {
      success: true,
      requiresVerification: true,
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      message: "Verification code sent",
    };

    if (process.env.NODE_ENV === "test" || process.env.LOGIN_OTP_IN_RESPONSE === "1") {
      payload.debugCode = challenge.debugCode;
    }

    return res.json(payload);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const verifySignupStudent = async (req, res) => {
  try {
    const { challengeId, code } = req.body;

    if (!challengeId || !code) {
      return res.status(400).json({
        success: false,
        message: "Missing challengeId or code",
      });
    }

    const result = consumeLoginChallenge({ challengeId, code });
    if (!result.ok || result.purpose !== "signup") {
      const status =
        result.reason === "too_many_attempts"
          ? 429
          : result.reason === "invalid_code"
            ? 401
            : 400;
      const message =
        result.reason === "too_many_attempts"
          ? "Too many verification attempts"
          : result.reason === "invalid_code"
            ? "Invalid verification code"
            : "Verification challenge invalid or expired";

      return res.status(status).json({
        success: false,
        message,
      });
    }

    const signupToken = createPendingSignup({
      email: result.email,
      password: result.password,
      studentId: result.studentId,
      languagePref: result.languagePref,
    });

    return res.json({
      success: true,
      requiresOnboarding: true,
      signupToken,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

async function createConfirmedAuthUser(email, password) {
  const { error } = await supabaseAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error) return { ok: true };

  const already = /already been registered|already registered|already exists|duplicate/i.test(
    error.message || "",
  );
  if (!already) {
    return {
      ok: false,
      message: error.message || "Failed to register user in Supabase Auth",
    };
  }

  const removed = await deleteAuthUserByEmail(email);
  if (!removed.ok) {
    return {
      ok: false,
      message: "Email already registered. Please log in instead.",
    };
  }

  const retry = await supabaseAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (retry.error) {
    return {
      ok: false,
      message: retry.error.message || "Failed to register user in Supabase Auth",
    };
  }
  return { ok: true };
}

const completeSignupStudent = async (req, res) => {
  try {
    const { signupToken, major, year, nationality, language_pref } = req.body;
    if (!signupToken) {
      return res.status(400).json({
        success: false,
        message: "Missing signupToken",
      });
    }
    if (!major || !year || !nationality) {
      return res.status(400).json({
        success: false,
        message: "Major, year, and nationality are required",
      });
    }

    const pending = consumePendingSignup(signupToken);
    if (!pending) {
      return res.status(400).json({
        success: false,
        message: "Signup session invalid or expired. Please start again.",
      });
    }

    // The OTP has proved ownership by this point, so clearing an abandoned
    // attempt at this address is safe — this is where /signup used to do it,
    // before anyone had proved anything.
    const { data: existingEmail } = await supabase
      .from("student")
      .select("student_id, nationality")
      .ilike("email", escapeLikePattern(pending.email))
      .maybeSingle();

    if (existingEmail) {
      if (!isUnfinishedSignup(existingEmail)) {
        return res.status(400).json({
          success: false,
          message: "Email already registered. Please log in instead.",
        });
      }
      const { error: cleanupError } = await supabase
        .from("student")
        .delete()
        .eq("student_id", existingEmail.student_id);
      if (cleanupError) {
        // Left unchecked, a failed delete fell through to an insert that could
        // only collide, so the student saw a 500 with no way forward.
        return res.status(500).json({
          success: false,
          message: "Could not clear the previous signup attempt. Please try again.",
        });
      }
    }

    const { data: matchedMajor } = await supabase
      .from("major")
      .select("major_id, major_name")
      .ilike("major_name", String(major).trim())
      .maybeSingle();
    if (!matchedMajor) {
      return res.status(400).json({
        success: false,
        message: "Unknown major",
      });
    }

    const resolvedGrade = gradeFromYearChoice(year);
    if (resolvedGrade === null) {
      return res.status(400).json({
        success: false,
        message: "year must be 1, 2, 3, 4, or exchange",
      });
    }

    let resolvedLanguage = pending.languagePref || "en";
    if (language_pref) {
      const resolved = resolveLanguagePref(language_pref);
      if (!resolved) {
        return res.status(400).json({
          success: false,
          message: `Unsupported language_pref. Use one of: ${SUPPORTED_LANGUAGE_PREFS.join(", ")}`,
          error: { status: 400, code: "UNSUPPORTED_LANGUAGE" },
        });
      }
      resolvedLanguage = resolved;
    }

    const createdAuth = await createConfirmedAuthUser(
      pending.email,
      pending.password,
    );
    if (!createdAuth.ok) {
      return res.status(400).json({
        success: false,
        message: createdAuth.message,
      });
    }

    const created = await insertStudentAfterSignup({
      studentId: pending.studentId,
      email: pending.email,
      languagePref: resolvedLanguage,
      nationality: String(nationality).trim(),
      majorId: matchedMajor.major_id,
      grade: resolvedGrade,
      studentType: studentTypeFromGrade(resolvedGrade),
    });
    if (created.error || !created.data) {
      return res.status(500).json({
        success: false,
        message: "Failed to register student after verification",
        error: created.error?.message,
      });
    }

    return res.json(buildAuthResponse(created.data));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getStudentProfile = async (req, res) => {
  try {
    const { student_id } = req.params;

    // A student may only read their own profile. Admins list students via GET /.
    if (String(req.user?.student_id) !== String(student_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only view your own profile.",
        error: { status: 403, code: "FORBIDDEN" },
      });
    }

    const { data, error } = await supabase
      .from("student")
      .select(
        `
        *,
        major:major_id (
          major_name,
          department
        )
      `,
      )
      .eq("student_id", student_id)
      .single();

    if (error || !data) {
      if (error?.code === "PGRST116" || !data) {
        return res.status(404).json({
          success: false,
          message: "Student not found",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to fetch student profile",
        error: error.message,
      });
    }

    // `password` holds a bcrypt hash or the [SUPABASE_AUTH] marker and must
    // never leave the server, even on an authorised self-read.
    const { major, password, ...studentProfile } = data;

    res.json({
      success: true,
      data: {
        ...studentProfile,
        major_name: major?.major_name ?? null,
        department: major?.department ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

/**
 * Move a student's Supabase Auth login address to match their profile email.
 *
 * The app keeps two user stores: public.student holds the profile, auth.users
 * holds the credential. Login and password reset both look up auth.users by the
 * PROFILE email, so the moment the two disagree the account can neither sign in
 * nor reset — silently, because the lookup simply finds nothing. One real
 * account was locked out of both this way.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: string, message: string}>}
 */
async function syncAuthEmail({ currentEmail, nextEmail }) {
  const from = normalizeEmail(currentEmail);
  const to = normalizeEmail(nextEmail);
  if (!to || from === to) return { ok: true };

  const { data: list, error: listError } = await supabaseAuth.auth.admin.listUsers();
  if (listError) {
    return {
      ok: false,
      reason: "AUTH_LOOKUP_FAILED",
      message: "Could not reach the account service. Your email was not changed.",
    };
  }

  const users = list?.users || [];
  if (users.some((user) => normalizeEmail(user.email) === to)) {
    return {
      ok: false,
      reason: "EMAIL_TAKEN",
      message: "That email is already used by another account.",
    };
  }

  const authUser = users.find((user) => normalizeEmail(user.email) === from);
  if (!authUser) {
    // Nothing to move. Left alone deliberately rather than created here: a
    // missing auth user means this profile predates the fix or was repaired by
    // hand, and inventing a credential is how the drift started.
    return { ok: true };
  }

  const { error: updateError } = await supabaseAuth.auth.admin.updateUserById(
    authUser.id,
    { email: to, email_confirm: true },
  );
  if (updateError) {
    return {
      ok: false,
      reason: "AUTH_UPDATE_FAILED",
      message: "Could not update your sign-in email. Nothing was changed.",
    };
  }

  return { ok: true };
}

const updateStudentProfile = async (req, res) => {
  try {
    // PUT /profile uses JWT; PATCH /:student_id uses route param
    const student_id = req.params.student_id || req.user?.student_id;
    if (!student_id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to update profile",
        error: { status: 401, code: "UNAUTHORIZED" },
      });
    }

    if (
      req.user?.student_id &&
      req.params.student_id &&
      String(req.user.student_id) !== String(req.params.student_id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only update your own profile.",
        error: { status: 403, code: "FORBIDDEN" },
      });
    }

    const {
      name,
      nationality,
      major_name,
      major: majorFromBody,
      email,
      phone,
      visa_status,
      language_pref,
      interests,
      new_password,
      is_in_korea,
      mbti,
      d2_semester,
      completed_courses,
      intake_term,
      grade,
      year,
      academic_year,
    } = req.body;

    const resolvedMajorName = major_name || majorFromBody;

    let major_id;
    if (resolvedMajorName) {
      const { data: majors } = await supabase.from("major").select("*");
      const matchedMajor = majors?.find(
        (m) =>
          m.major_name.toLowerCase() === String(resolvedMajorName).toLowerCase(),
      );
      if (matchedMajor) {
        major_id = matchedMajor.major_id;
      }
    }

    const yearChoice = year ?? academic_year ?? grade;
    const resolvedGrade =
      yearChoice === undefined || yearChoice === null || yearChoice === ""
        ? undefined
        : gradeFromYearChoice(yearChoice) ?? normalizeGrade(yearChoice);

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (nationality !== undefined) updateData.nationality = nationality;
    if (major_id !== undefined) updateData.major_id = major_id;
    if (email !== undefined) {
      // Move the credential before the profile. If this fails the two stores
      // stay consistent and the student keeps the login they had; writing the
      // profile first is what allowed them to drift apart.
      const { data: existing } = await supabase
        .from("student")
        .select("email")
        .eq("student_id", String(student_id))
        .maybeSingle();

      const synced = await syncAuthEmail({
        currentEmail: existing?.email,
        nextEmail: email,
      });
      if (!synced.ok) {
        return res.status(synced.reason === "EMAIL_TAKEN" ? 409 : 502).json({
          success: false,
          message: synced.message,
          error: {
            status: synced.reason === "EMAIL_TAKEN" ? 409 : 502,
            code: synced.reason,
          },
        });
      }
      updateData.email = email;
    }
    if (phone !== undefined) updateData.phone = phone;
    if (visa_status !== undefined) updateData.visa_status = visa_status;
    if (language_pref !== undefined) {
      const normalizedLanguagePref = resolveLanguagePref(language_pref);
      if (!normalizedLanguagePref) {
        return res.status(400).json({
          success: false,
          message: `Unsupported language_pref. Use one of: ${SUPPORTED_LANGUAGE_PREFS.join(", ")}`,
          error: { status: 400, code: "UNSUPPORTED_LANGUAGE" },
        });
      }
      updateData.language_pref = normalizedLanguagePref;
    }
    // `interests` is accepted by the API contract / UI but is not a student column yet
    if (interests !== undefined && !Array.isArray(interests)) {
      return res.status(400).json({
        success: false,
        message: "interests must be an array of strings",
        error: { status: 400, code: "VALIDATION_ERROR" },
      });
    }
    if (is_in_korea !== undefined) updateData.is_in_korea = is_in_korea;
    if (mbti !== undefined) updateData.mbti = mbti;
    if (d2_semester !== undefined) updateData.d2_semester = d2_semester;
    if (completed_courses !== undefined) updateData.completed_courses = completed_courses;
    if (intake_term !== undefined) updateData.intake_term = intake_term;
    if (resolvedGrade !== undefined) {
      if (resolvedGrade === null) {
        return res.status(400).json({
          success: false,
          message: "year must be 1, 2, 3, 4, or exchange",
          error: { status: 400, code: "VALIDATION_ERROR" },
        });
      }
      updateData.grade = resolvedGrade;
      updateData.student_type = studentTypeFromGrade(resolvedGrade);
    }

    if (new_password) {
      const { current_password } = req.body;
      if (!current_password) {
        return res.status(400).json({
          success: false,
          message: "Current password is required to set a new password.",
        });
      }

      const { data: studentRecord } = await supabase
        .from("student")
        .select("password, email")
        .eq("student_id", student_id)
        .single();
      if (!studentRecord) {
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }

      // Same verification path as login, so this works whether the student has
      // already moved to Supabase Auth or still carries a legacy bcrypt hash.
      const { ok } = await verifyStudentPassword({
        studentId: student_id,
        email: studentRecord.email,
        storedPassword: studentRecord.password,
        password: current_password,
      });

      if (!ok) {
        return res.status(400).json({
          success: false,
          message: "Current password does not match.",
        });
      }

      try {
        updateData.password = await setStudentPassword({
          email: studentRecord.email,
          newPassword: new_password,
        });
      } catch (passwordErr) {
        return res.status(500).json({
          success: false,
          message: "Failed to update password.",
          error: passwordErr.message,
        });
      }
    }

    const { data, error } = await supabase
      .from("student")
      .update(updateData)
      .eq("student_id", student_id)
      .select(
        `
        *,
        major:major_id (
          major_name,
          department
        )
      `,
      )
      .single();

    if (error || !data) {
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
        error: error?.message || "Error occurred",
      });
    }

    // `password` holds a bcrypt hash or the [SUPABASE_AUTH] marker and must
    // never leave the server, even on an authorised self-read.
    const { major, password, ...studentProfile } = data;

    res.json({
      success: true,
      data: {
        ...studentProfile,
        major_name: major?.major_name ?? null,
        department: major?.department ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

// Where Supabase sends students after they click the recovery email. Must be
// listed under Authentication → URL Configuration in the Supabase dashboard.
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:5173";

// The password-reset link lands the student here. If this is a localhost value
// on a deployed server the emailed link is dead for everyone, so say so loudly
// at boot rather than discovering it from a user's spam folder.
//
// IMPORTANT: setting APP_BASE_URL correctly is necessary but NOT sufficient.
// Supabase only honours generateLink's redirectTo if the exact URL is on the
// project's Redirect URLs allow list (Auth > URL Configuration). If it is not,
// Supabase silently substitutes the project Site URL and DROPS the path — which
// is why a reset mail can arrive pointing at "http://localhost:3000" with no
// /update-password, even when this value is correct. Both must be set:
//   - Site URL:        https://<web-host>
//   - Redirect URLs:   https://<web-host>/update-password
if (
  process.env.NODE_ENV === "production" &&
  /localhost|127\.0\.0\.1/.test(APP_BASE_URL)
) {
  console.warn(
    `[password-reset] APP_BASE_URL is "${APP_BASE_URL}" in production — reset ` +
      "links will point at localhost and fail. Set it to the deployed site URL.",
  );
}

const forgotPassword = async (req, res) => {
  try {
    // Accepts the same three shapes as loginStudent. Students sign in with
    // their school email now, so asking for a student ID here was the one
    // screen still demanding the old identifier. Older clients that still send
    // student_id keep working.
    const { student_id, email: suppliedEmail, identifier } = req.body;
    const supplied = String(identifier ?? suppliedEmail ?? student_id ?? "").trim();

    if (!supplied) {
      return res.status(400).json({
        success: false,
        message: "Enter your school email or student ID",
      });
    }

    const isEmail = supplied.includes("@");
    const lookup = supabase.from("student").select("student_id, email");
    const { data, error } = isEmail
      ? await lookup.ilike("email", supplied).maybeSingle()
      : await lookup.eq("student_id", supplied).maybeSingle();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: isEmail ? "Email not registered" : "Student ID not registered",
      });
    }

    // No fallback to a derived address. Sending a reset link to an inbox the
    // student never confirmed is worse than telling them we cannot.
    const email = String(data.email || "").trim();
    if (!email) {
      return res.status(409).json({
        success: false,
        message:
          "This account has no email address on file, so a reset link cannot be sent. Please contact support.",
        error: { status: 409, code: "NO_EMAIL_ON_FILE" },
      });
    }

    // Supabase still mints the recovery token and owns the reset session — this
    // only takes over delivery. generateLink returns the link WITHOUT emailing
    // it, so nothing about the security model changes; the app simply stops
    // depending on Supabase's built-in mailer, which is rate limited to a
    // handful of messages an hour and is not intended for production. One
    // provider now sends every user-facing email.
    const { data: linkData, error: linkError } =
      await supabaseAuth.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${APP_BASE_URL}/update-password` },
      });

    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        "[password-reset] could not generate recovery link:",
        linkError?.message || "no action_link returned",
      );
      return res.status(500).json({
        success: false,
        message: "We could not start the password reset. Please try again.",
        error: { status: 500, code: "RESET_LINK_FAILED" },
      });
    }

    try {
      await sendPasswordResetEmail({
        to: email,
        actionLink: linkData.properties.action_link,
      });
    } catch (deliveryError) {
      // The link exists but never reached the student, so say so rather than
      // reporting success and leaving them waiting for mail that is not coming.
      console.error("[password-reset] delivery failed:", deliveryError.message);
      return res.status(502).json({
        success: false,
        message: "We could not send the reset email. Please try again in a moment.",
        error: { status: 502, code: "RESET_EMAIL_DELIVERY_FAILED" },
      });
    }

    // Mask the email (e.g. htet_kaung_san@pusan.ac.kr -> ht**@pusan.ac.kr)
    const [localPart, domain] = email.split("@");
    let maskedLocal = localPart;
    if (localPart.length > 2) {
      maskedLocal =
        localPart.substring(0, 2) +
        "*".repeat(Math.min(8, localPart.length - 2));
    } else {
      maskedLocal = localPart.substring(0, 1) + "*";
    }
    const maskedEmail = `${maskedLocal}@${domain}`;

    res.json({
      success: true,
      message: "Recovery code generated successfully",
      maskedEmail,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { access_token, new_password } = req.body;
    if (!access_token || !new_password) {
      return res.status(400).json({
        success: false,
        message: "Missing access_token or new_password",
      });
    }

    const { data: userData, error: userError } =
      await supabaseAuth.auth.getUser(access_token);

    if (userError || !userData.user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired access token",
        error: userError?.message
      });
    }

    const { error: updateError } = await supabaseAuth.auth.admin.updateUserById(
      userData.user.id,
      { password: new_password },
    );

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Failed to update password in Supabase Auth",
        error: updateError.message,
      });
    }

    // Supabase Auth is now authoritative for this account. Clear any legacy
    // bcrypt hash so a stale credential isn't left sitting in the table.
    if (userData.user.email) {
      const { error: markError } = await supabase
        .from("student")
        .update({ password: SUPABASE_AUTH_MARKER })
        .eq("email", userData.user.email);

      if (markError) {
        console.warn(
          "[auth] password reset succeeded but marking the row failed:",
          markError.message,
        );
      }
    }

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getAllBoards = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("board")
      .select("*")
      .order("board_id", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch boards",
        error: error.message,
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getBoardPosts = async (req, res) => {
  try {
    const { board_id } = req.params;

    const { data, error } = await supabase
      .from("post")
      .select(
        `
        *,
        student (
          name
        )
      `,
      )
      .eq("board_id", Number(board_id))
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch posts for board",
        error: error.message,
      });
    }

    const posts = (data || [])
      .map((p) => {
        const { student, ...rest } = p;
        return {
          ...rest,
          likes_count: p.likes_count || 0,
          liked_by: p.liked_by || [],
          reported: Boolean(p.reported),
          student_name: student?.name ?? "Unknown Student",
        };
      })
      .filter((p) => !p.reported);

    res.json({
      success: true,
      data: posts,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const createPost = async (req, res) => {
  try {
    const { board_id, student_id, title, content } = req.body;

    if (!board_id || !student_id || !title || !content) {
      return res.status(400).json({
        success: false,
        message: "Missing board_id, student_id, title, or content",
      });
    }

    const { data, error } = await supabase
      .from("post")
      .insert({
        board_id: Number(board_id),
        student_id: String(student_id),
        title,
        content,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to create post",
        error: error.message,
      });
    }

    res.status(201).json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getFacilities = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("facility")
      .select("*")
      .order("name", { ascending: true });
    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to fetch facilities",
        error: error.message,
      });
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getPnuContacts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pnu_contact")
      .select("contact_id, slug, name, place, hours, phone, email, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch PNU contacts",
        error: error.message,
      });
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getFaqItems = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("faq_item")
      .select("faq_id, slug, question, answer, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch FAQ items",
        error: error.message,
      });
    }

    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getFacilityById = async (req, res) => {
  try {
    const { facility_id } = req.params;

    const { data, error } = await supabase
      .from("facility")
      .select("*")
      .eq("facility_id", facility_id)
      .single();

    if (error || !data) {
      if (error?.code === "PGRST116" || !data) {
        return res.status(404).json({
          success: false,
          message: "Facility not found",
        });
      }
      return res.status(500).json({
        success: false,
        message: "Failed to fetch facility",
        error: error.message,
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getAcademicRecords = async (req, res) => {
  try {
    const { student_id } = req.params;
    const requesterId = String(req.user?.student_id ?? "");

    if (requesterId && requesterId !== String(student_id) && !req.user?.is_admin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const [
      { data: enrollmentRows, error: enrollmentError },
      { data: studentRow },
      { data: recordRows },
    ] = await Promise.all([
      supabase
        .from("enrollment")
        .select(
          `
            *,
            course:course_id (
              credit,
              category,
              course_code,
              major_id
            )
          `,
        )
        .eq("student_id", student_id),
      supabase
        .from("student")
        .select("major_id")
        .eq("student_id", student_id)
        .maybeSingle(),
      supabase
        .from("academic_record")
        .select("*")
        .eq("student_id", student_id)
        .order("sort_order", { ascending: true })
        .catch?.(() => ({ data: [] })) || { data: [] },
    ]);

    if (enrollmentError) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch enrollments",
        error: enrollmentError.message,
      });
    }

    const enrollments = (enrollmentRows || []).map((item) => {
      const { course, ...rest } = item;
      return {
        ...rest,
        credit: course?.credit ?? rest.credit ?? 0,
        category: course?.category ?? rest.category ?? "GEN_ED",
        course_major_id: course?.major_id ?? null,
        official_course_number: course?.course_code ?? null,
      };
    });

    const computed = computeGpaFromEnrollments(enrollments, studentRow?.major_id ?? null);

    // Sum required credits from catalog for student's major
    let requiredCredits = 130;
    if (studentRow?.major_id) {
      const { data: catalogRows } = await supabase
        .from("graduation_requirement")
        .select("target_value")
        .eq("major_id", studentRow.major_id)
        .eq("requirement_type", "CREDIT");
      if (catalogRows && catalogRows.length > 0) {
        requiredCredits = catalogRows.reduce(
          (sum, row) => sum + (Number(row.target_value) || 0),
          0,
        );
      }
    }

    // Check legacy academic_record fallback only if no graded enrollments
    const summary = (recordRows || []).find((row) => row.record_type === "summary");
    const legacySemesters = (recordRows || []).filter((row) => row.record_type === "semester");

    let overallGpa = computed.overallGpa;
    let gpaScale = computed.gpaScale;
    let standing = computed.standing;
    let completedCredits = computed.totalCompletedCredits;
    let semesters = computed.semesters;

    if (!computed.hasGradedCourses && summary) {
      overallGpa = Number(summary.overall_gpa) || 0;
      gpaScale = Number(summary.gpa_scale) || 4.5;
      standing = summary.standing || standing;
      completedCredits = Number(summary.completed_credits) || completedCredits;
      if (semesters.length === 0 && legacySemesters.length > 0) {
        semesters = legacySemesters.map((row) => ({
          semester_label: row.semester_label,
          gpa: Number(row.gpa) || 0,
          sort_order: row.sort_order,
        }));
      }
    }

    if (!computed.hasGradedCourses && !summary && completedCredits === 0) {
      // Empty state for brand new student
      return res.json({ success: true, data: null });
    }

    res.json({
      success: true,
      data: {
        student_id,
        overall_gpa: overallGpa ?? 0,
        gpa_scale: gpaScale,
        standing,
        completed_credits: completedCredits,
        required_credits: requiredCredits,
        semesters,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getGraduationProgress = async (req, res) => {
  try {
    const student_id = req.params.student_id || req.user?.student_id;
    if (!student_id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (
      req.user?.student_id &&
      String(req.user.student_id) !== String(student_id) &&
      !req.user?.is_admin
    ) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    const [
      { data: recordRows },
      { data: enrollmentRows, error: enrollmentError },
      { data: studentRow, error: studentError },
    ] = await Promise.all([
      supabase
        .from("academic_record")
        .select("*")
        .eq("student_id", student_id)
        .order("sort_order", { ascending: true })
        .catch?.(() => ({ data: [] })) || { data: [] },
      supabase
        .from("enrollment")
        .select(
          `
            *,
            course:course_id (
              credit,
              category,
              course_code,
              major_id
            )
          `,
        )
        .eq("student_id", student_id),
      supabase
        .from("student")
        .select("major_id, major:major_id(major_name)")
        .eq("student_id", student_id)
        .single(),
    ]);

    if (enrollmentError) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch enrollments",
        error: enrollmentError.message,
      });
    }

    const summary =
      (recordRows || []).find((row) => row.record_type === "summary") || null;
    const semesters = (recordRows || []).filter(
      (row) => row.record_type === "semester",
    );

    const enrollments = (enrollmentRows || []).map((item) => {
      const { course, ...rest } = item;
      return {
        ...rest,
        credit: course?.credit ?? rest.credit ?? 0,
        category: course?.category ?? rest.category ?? "GEN_ED",
        course_major_id: course?.major_id ?? null,
        official_course_number: course?.course_code ?? null,
      };
    });

    // Sum target_value of CREDIT requirements for this major to get the
    // authoritative total required credits.
    const majorId = studentError ? null : studentRow?.major_id;
    let catalogRequired = 0;
    if (majorId) {
      const { data: catalogRows } = await supabase
        .from("graduation_requirement")
        .select("target_value, requirement_type")
        .eq("major_id", majorId)
        .eq("requirement_type", "CREDIT");
      catalogRequired = (catalogRows || []).reduce(
        (sum, row) => sum + (Number(row.target_value) || 0),
        0,
      );
    }

    const progress = buildGraduationProgress({
      enrollments,
      academicSummary: summary,
      semesters,
      catalogRequired,
      studentMajorId: majorId,
    });

    let requirements = [];
    try {
      requirements = await ensureGraduationRequirements(
        supabase,
        student_id,
        majorId,
      );
    } catch (ensureErr) {
      console.warn(
        "graduation_requirement ensure failed:",
        ensureErr.message || ensureErr,
      );
    }

    const language = req.language || "en";
    const localizedRequirements = requirements.map((row) => {
      const localized = localizeRow(row, language, [
        "title",
        "description",
        "task_name",
      ]);
      return {
        ...row,
        title: localized.title ?? localized.task_name ?? row.task_name,
        description: localized.description ?? row.description,
        task_name: localized.task_name ?? row.task_name,
      };
    });

    return res.json({
      success: true,
      data: {
        ...toGraduationApiPayload(progress),
        requirements: localizedRequirements,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const updateGraduationRequirement = async (req, res) => {
  try {
    const { requirement_id } = req.params;
    const student_id = req.user?.student_id;
    let { status } = req.body;

    if (!student_id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (status === "Pending" || status === "pending") {
      status = "Not Started";
    }

    const { data: catalog, error: catalogError } = await supabase
      .from("graduation_requirement")
      .select("req_id, major_id")
      .eq("req_id", requirement_id)
      .single();

    if (catalogError || !catalog) {
      return res.status(404).json({
        success: false,
        message: "Graduation requirement not found",
      });
    }

    const { data: student, error: studentError } = await supabase
      .from("student")
      .select("major_id")
      .eq("student_id", student_id)
      .single();

    if (studentError || !student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    if (Number(student.major_id) !== Number(catalog.major_id) && !req.user?.is_admin) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    let data;
    try {
      data = await updateStudentGraduationRequirement(
        supabase,
        student_id,
        requirement_id,
        status,
      );
    } catch (updateErr) {
      return res.status(500).json({
        success: false,
        message: "Failed to update graduation requirement",
        error: updateErr.message,
      });
    }

    const language = req.language || "en";
    const localized = localizeRow(data, language, [
      "title",
      "description",
      "task_name",
    ]);

    return res.json({
      success: true,
      data: {
        ...data,
        title: localized.title ?? localized.task_name ?? data.task_name,
        description: localized.description ?? data.description,
        task_name: localized.task_name ?? data.task_name,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

function publicNoticeSource(source) {
  return noticeSourceLabel(source);
}

function publicNoticeChannel(source) {
  if (source === "international") return "international";
  if (source === "cse") return "department";
  return "general";
}

function mapPublicNotice(notice) {
  return {
    id: notice.id,
    kind: "NOTICE",
    title: notice.title,
    body: notice.body,
    date: notice.deadline ?? notice.postedDate ?? null,
    postedDate: notice.postedDate,
    deadline: notice.deadline,
    languages: notice.languages,
    category: notice.category,
    priority: notice.priority,
    source: publicNoticeSource(notice.source),
    channel: publicNoticeChannel(notice.source),
    sourceUrl: notice.sourceUrl,
    read: false,
  };
}

const getNotices = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { q, limit = 20 } = req.query;
    const notices = (await fetchAllNotices(supabase, {
      language: req.language || "en",
    }))
      .sort((a, b) => {
        const aTime = new Date(a.postedDate || 0).getTime();
        const bTime = new Date(b.postedDate || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return String(a.id).localeCompare(String(b.id));
      })
      .map(mapPublicNotice);
    const query = String(q || "").trim();
    const filtered = !query
      ? notices
      : rankSearchItems(
          notices.map((item) => ({
            ...item,
            title: item.title || "",
            content: item.body || "",
          })),
          query,
        );

    const requestedLimit = Number(limit);
    const limitValue =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 20;
    const sliced = filtered.slice(0, limitValue);
    // Independent AI calls — extraction reads original Korean text
    // regardless of the requested display language, so it doesn't need to
    // wait on translation to finish.
    const [localized, extracted] = await Promise.all([
      translateNotices(sliced, req.language || "en"),
      extractNoticeInfo(sliced),
    ]);
    const enriched = localized.map((notice, index) => ({
      ...notice,
      deadline: notice.deadline || extracted[index]?.deadline || null,
      eligibility: extracted[index]?.eligibility ?? null,
      requiredDocuments: extracted[index]?.requiredDocuments ?? [],
    }));

    res.json({
      success: true,
      data: enriched,
      meta: { query, total: enriched.length },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Failed to fetch notices",
      error: err.message,
    });
  }
};

const syncNotices = async (req, res) => {
  try {
    const result = await synchronizeNotices({
      supabaseClient: supabase,
      scrapeNotices: scrapeRecentNotices,
    });
    const scraped = result.scraped;
    res.json({
      success: true,
      data: {
        scraped: scraped.length,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
        bySource: scraped.reduce((acc, item) => {
          acc[item.source] = (acc[item.source] || 0) + 1;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message:
        err.message?.includes("source_url")
          ? "Run backend/supabase/notice_source.sql in Supabase SQL Editor first"
          : "Failed to sync notices",
      error: err.message,
    });
  }
};

const getNotifications = async (req, res) => {
  try {
    const authenticatedStudentId = req.user?.student_id;
    const requestedStudentId = req.params.student_id;

    if (!authenticatedStudentId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (requestedStudentId !== authenticatedStudentId) {
      return res.status(403).json({
        success: false,
        message: "You may only access your own notifications",
      });
    }

    const { data, error } = await supabase
      .from("notification")
      .select("*")
      .eq("student_id", authenticatedStudentId)
      .order("scheduled_time", { ascending: false });
    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to fetch notifications",
        error: error.message,
      });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getCourses = async (req, res) => {
  try {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("course")
        .select("*")
        .order("course_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        return res.status(500).json({
          success: false,
          message: "Failed to fetch courses",
          error: error.message,
        });
      }
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    rows.sort((a, b) => String(a.course_name).localeCompare(String(b.course_name)));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getEnrollments = async (req, res) => {
  try {
    const { student_id } = req.params;

    // A student may only read their own enrollments.
    if (String(req.user?.student_id) !== String(student_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only view your own enrollments.",
        error: { status: 403, code: "FORBIDDEN" },
      });
    }

    const { data, error } = await supabase
      .from("enrollment")
      .select(
        `
        *,
        course:course_id (
          *
        )
      `,
      )
      .eq("student_id", student_id);

    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to fetch enrollments",
        error: error.message,
      });

    const courseNames = [...new Set((data || []).map((item) => item.course?.course_name).filter(Boolean))];
    let duplicateCourses = [];
    if (courseNames.length > 0) {
      try {
        const duplicateResult = await supabase
          .from("course")
          .select("course_id,course_name,course_name_en,official_course_number,major_id")
          .in("course_name", courseNames);
        if (!duplicateResult.error) duplicateCourses = duplicateResult.data || [];
      } catch (_error) {
        duplicateCourses = [];
      }
    }
    const officialByName = new Map();
    for (const candidate of duplicateCourses) {
      if (!candidate.official_course_number) continue;
      if (!officialByName.has(candidate.course_name)) {
        officialByName.set(candidate.course_name, candidate);
      }
    }
    const officialCourseIds = [...officialByName.values()].map((row) => row.course_id);
    let offeringRows = [];
    if (officialCourseIds.length > 0) {
      try {
        const offeringResult = await supabase
          .from("course_offering")
          .select("course_id,official_course_number,academic_year,semester,professor,schedule,classroom")
          .in("course_id", officialCourseIds)
          .order("academic_year", { ascending: false });
        if (!offeringResult.error) offeringRows = offeringResult.data || [];
      } catch (_error) {
        offeringRows = [];
      }
    }
    const offeringsByCourseId = new Map();
    for (const offering of offeringRows) {
      const key = String(offering.course_id);
      if (!offeringsByCourseId.has(key)) offeringsByCourseId.set(key, []);
      offeringsByCourseId.get(key).push(offering);
    }

    // Flat map course values and enrich legacy rows only with verified matches.
    const list = (data || []).map((item) => {
      const { course, ...rest } = item;
      const officialMatch = officialByName.get(course?.course_name);
      const termMatch = String(item.semester || "").match(/^(\d{4})-(Spring|Summer|Fall|Winter)$/i);
      const termSemester = termMatch
        ? ({ spring: "1", summer: "SUMMER", fall: "2", winter: "WINTER" })[termMatch[2].toLowerCase()]
        : null;
      const offerings = offeringsByCourseId.get(String(officialMatch?.course_id)) || [];
      const offering = offerings.find((row) =>
        Number(row.academic_year) === Number(termMatch?.[1])
        && String(row.semester).toUpperCase() === String(termSemester).toUpperCase(),
      ) || offerings[0] || null;
      // Same guard as mapCourseRow in ai/supabaseDataRepository.js: only treat a
      // trailing parenthetical as the Korean name when it contains Hangul, or
      // 재무회계(I) yields course_name_ko "I".
      const bilingualMatch = String(course?.course_name || "").match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      const bilingual =
        bilingualMatch && /[가-힣]/.test(bilingualMatch[2]) ? bilingualMatch : null;
      return {
        ...rest,
        course_name: course?.course_name ?? "Unknown Course",
        course_name_en: course?.course_name_en ?? bilingual?.[1]?.trim() ?? null,
        course_name_ko: bilingual?.[2]?.trim() ?? null,
        official_course_number:
          course?.official_course_number
          ?? officialMatch?.official_course_number
          ?? offering?.official_course_number
          ?? null,
        catalog_course_id: officialMatch?.course_id ?? course?.course_id ?? item.course_id,
        credit: course?.credit ?? 0,
        category: course?.category ?? "GEN_ED",
        professor: offering?.professor ?? null,
        schedule: offering?.schedule ?? null,
        classroom: offering?.classroom ?? course?.classroom ?? null,
        day_of_week: course?.day_of_week ?? null,
        start_time: course?.start_time ?? null,
        end_time: course?.end_time ?? null,
        final_grade: item.final_grade ?? null,
        credits_earned: item.credits_earned == null ? null : Number(item.credits_earned),
      };
    });

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const createEnrollment = async (req, res) => {
  try {
    // Enrollment ownership always comes from the authenticated token.
    const student_id = req.user?.student_id;
    const course_id = req.body.course_id || req.body.courseId;
    const requestedStatus = String(req.body.status || "Enrolled");
    const status = requestedStatus.toLowerCase() === "completed" ? "Completed" : "Enrolled";
    const now = new Date();
    const currentSemester = `${now.getFullYear()}-${now.getMonth() + 1 >= 7 ? "Fall" : "Spring"}`;
    const semester = String(req.body.semester || currentSemester);
    const finalGradeValue = req.body.final_grade ?? req.body.finalGrade;
    const creditsEarnedValue = req.body.credits_earned ?? req.body.creditsEarned;
    const finalGrade = finalGradeValue == null || String(finalGradeValue).trim() === ""
      ? null
      : String(finalGradeValue).trim().toUpperCase();
    const creditsEarned = creditsEarnedValue == null || String(creditsEarnedValue).trim() === ""
      ? null
      : Number(creditsEarnedValue);

    if (!student_id || !course_id) {
      return res
        .status(400)
        .json({ 
          success: false, 
          message: `Missing student_id or course_id (Received student_id: ${student_id}, course_id: ${course_id})`,
          received: { student_id, course_id, body: req.body }
        });
    }

    if (!/^\d{4}-(Spring|Summer|Fall|Winter)$/.test(semester)) {
      return res.status(400).json({
        success: false,
        message: "Semester must use YYYY-Spring, YYYY-Summer, YYYY-Fall, or YYYY-Winter.",
      });
    }
    if (status === "Completed") {
      const [, yearText, termText] = semester.match(/^(\d{4})-(Spring|Summer|Fall|Winter)$/);
      const termOrder = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };
      const requestedRank = Number(yearText) * 10 + termOrder[termText];
      const now = new Date();
      const currentTerm = now.getMonth() + 1 >= 7 ? 3 : 1;
      const currentRank = now.getFullYear() * 10 + currentTerm;
      if (requestedRank >= currentRank) {
        return res.status(400).json({
          success: false,
          message: "A past course must be from an earlier academic term.",
        });
      }
      if (finalGrade && !/^(A\+|A0|B\+|B0|C\+|C0|D\+|D0|F|P|NP|S|U)$/.test(finalGrade)) {
        return res.status(400).json({ success: false, message: "Unsupported final grade." });
      }
      if (creditsEarned !== null && (!Number.isFinite(creditsEarned) || creditsEarned < 0)) {
        return res.status(400).json({ success: false, message: "Credits earned must be zero or greater." });
      }
    }

    // Check if already enrolled
    const { data: existing } = await supabase
      .from("enrollment")
      .select("*")
      .eq("student_id", student_id)
      .eq("course_id", Number(course_id))
      .eq("semester", semester);

    if (existing && existing.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Already enrolled in this course" });
    }

    // Fetch target course details
    const { data: targetCourse, error: targetError } = await supabase
      .from("course")
      .select("*")
      .eq("course_id", Number(course_id))
      .single();

    if (targetError || !targetCourse) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }
    if (creditsEarned !== null && creditsEarned > Number(targetCourse.credit || 0)) {
      return res.status(400).json({
        success: false,
        message: "Credits earned cannot exceed the course credits.",
      });
    }

    if (status === "Enrolled") {
      // Official/current enrollment keeps the legacy schedule-conflict guard.
      const { data: currentEnrollments, error: enrollError } = await supabase
        .from("enrollment")
        .select(`
          *,
          course:course_id (
            *
          )
        `)
        .eq("student_id", student_id);

      if (enrollError) {
        return res.status(500).json({
          success: false,
          message: "Failed to verify schedule conflicts",
          error: enrollError.message,
        });
      }

      if (targetCourse.day_of_week && targetCourse.start_time && targetCourse.end_time) {
        for (const en of (currentEnrollments || [])) {
          const c = en.course;
          if (c && c.day_of_week === targetCourse.day_of_week) {
            if (targetCourse.start_time < c.end_time && c.start_time < targetCourse.end_time) {
              return res.status(400).json({
                success: false,
                message: `Schedule Conflict: Overlaps with ${c.course_name || "Enrolled Course"} (${c.day_of_week} ${c.start_time}-${c.end_time})`,
              });
            }
          }
        }
      }
    }

    const enrollmentInsert = {
      student_id: Number(student_id),
      course_id: Number(course_id),
      semester,
      status,
    };
    if (status === "Completed" && finalGrade !== null) enrollmentInsert.final_grade = finalGrade;
    if (status === "Completed" && creditsEarned !== null) enrollmentInsert.credits_earned = creditsEarned;

    const { data, error } = await supabase
      .from("enrollment")
      .insert(enrollmentInsert)
      .select()
      .single();

    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to enroll course",
        error: error.message,
      });

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const updateEnrollment = async (req, res) => {
  try {
    const enrollmentId = Number(req.params.enrollment_id);
    const studentId = Number(req.user?.student_id);
    if (!Number.isInteger(enrollmentId) || !Number.isInteger(studentId)) {
      return res.status(400).json({ success: false, message: "Invalid enrollment." });
    }
    const { data: existing, error: lookupError } = await supabase
      .from("enrollment")
      .select("enrollment_id,student_id,course_id,status,semester")
      .eq("enrollment_id", enrollmentId)
      .maybeSingle();
    if (lookupError) return res.status(500).json({ success: false, message: "Failed to find course record" });
    if (!existing) return res.status(404).json({ success: false, message: "Course record not found" });
    if (Number(existing.student_id) !== studentId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const semester = String(req.body.semester || existing.semester);
    if (!/^\d{4}-(Spring|Summer|Fall|Winter)$/.test(semester)) {
      return res.status(400).json({ success: false, message: "Invalid semester." });
    }

    const finalGradeValue = req.body.final_grade ?? req.body.finalGrade;
    const finalGrade = finalGradeValue == null || String(finalGradeValue).trim() === ""
      ? null
      : String(finalGradeValue).trim().toUpperCase();
    if (finalGrade && !/^(A\+|A0|B\+|B0|C\+|C0|D\+|D0|F|P|NP|S|U)$/.test(finalGrade)) {
      return res.status(400).json({ success: false, message: "Unsupported final grade." });
    }

    const { data: course, error: courseError } = await supabase
      .from("course")
      .select("credit")
      .eq("course_id", Number(existing.course_id))
      .single();
    if (courseError || !course) return res.status(404).json({ success: false, message: "Course not found" });

    const courseCredits = Number(course.credit) || 0;
    const isFailing = finalGrade === "F" || finalGrade === "NP" || finalGrade === "U";

    const creditsEarnedValue = req.body.credits_earned ?? req.body.creditsEarned;
    let creditsEarned =
      creditsEarnedValue == null || String(creditsEarnedValue).trim() === ""
        ? (finalGrade ? (isFailing ? 0 : courseCredits) : null)
        : Number(creditsEarnedValue);

    if (creditsEarned !== null && (!Number.isFinite(creditsEarned)
      || creditsEarned < 0 || creditsEarned > courseCredits)) {
      return res.status(400).json({ success: false, message: "Invalid credits earned." });
    }

    const status = req.body.status || (finalGrade ? "Completed" : existing.status || "Completed");

    const { data, error } = await supabase
      .from("enrollment")
      .update({
        semester,
        status,
        final_grade: finalGrade,
        credits_earned: creditsEarned,
      })
      .eq("enrollment_id", enrollmentId)
      .eq("student_id", studentId)
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, message: "Failed to update course history", error: error.message });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Unexpected server error", error: err.message });
  }
};

const deleteEnrollment = async (req, res) => {
  try {
    const { enrollment_id } = req.params;
    const studentId = Number(req.user?.student_id);
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { data: enrollment, error: lookupError } = await supabase
      .from("enrollment")
      .select("enrollment_id,student_id,course_id")
      .eq("enrollment_id", Number(enrollment_id))
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ success: false, message: "Failed to find course record" });
    }
    if (!enrollment) {
      return res.status(404).json({ success: false, message: "Course record not found" });
    }
    if (Number(enrollment.student_id) !== studentId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // 1. Unconditionally guarantee associated timetable entry is deleted
    if (enrollment.course_id) {
      await supabase
        .from("student_timetable_entry")
        .delete()
        .eq("student_id", studentId)
        .eq("course_id", Number(enrollment.course_id));
    }

    // 2. Attempt the atomic drop_student_course_plan RPC
    const { error: rpcError } = await supabase.rpc("drop_student_course_plan", {
      p_student_id: studentId,
      p_enrollment_id: Number(enrollment_id),
    });

    if (!rpcError) {
      return res.json({
        success: true,
        data: { enrollment_id: Number(enrollment_id) },
        message: "Successfully dropped course",
      });
    }

    // 3. Fallback: If RPC is not available in Supabase, execute direct enrollment deletion
    const { error: deleteError } = await supabase
      .from("enrollment")
      .delete()
      .eq("enrollment_id", Number(enrollment_id))
      .eq("student_id", enrollment.student_id);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        message: "Failed to drop course",
        error: deleteError.message,
      });
    }

    return res.json({
      success: true,
      data: { enrollment_id: Number(enrollment_id) },
      message: "Successfully dropped course",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getPostComments = async (req, res) => {
  try {
    const { post_id } = req.params;
    const { data: comments, error } = await supabase
      .from("comment")
      .select("*")
      .eq("post_id", Number(post_id))
      .order("created_at", { ascending: true });

    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to fetch comments",
        error: error.message,
      });

    // Manual join to bypass PostgREST schema caching issues
    const studentIds = [...new Set((comments || []).map(c => c.student_id).filter(Boolean))];
    const studentNameMap = {};

    if (studentIds.length > 0) {
      const { data: students } = await supabase
        .from("student")
        .select("student_id, name")
        .in("student_id", studentIds);

      (students || []).forEach(s => {
        studentNameMap[s.student_id] = s.name;
      });
    }

    const list = (comments || []).map((item) => {
      return {
        ...item,
        student_name: studentNameMap[item.student_id] || "Unknown Student",
      };
    });

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const createComment = async (req, res) => {
  try {
    const post_id = req.body.post_id || req.params.post_id;
    const { student_id, content } = req.body;
    if (!post_id || !student_id || !content) {
      return res.status(400).json({
        success: false,
        message: "Missing post_id, student_id, or content",
      });
    }

    const { data, error } = await supabase
      .from("comment")
      .insert({
        post_id: Number(post_id),
        student_id: String(student_id),
        content,
      })
      .select()
      .single();

    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to add comment",
        error: error.message,
      });

    // Fetch student name
    const { data: student } = await supabase
      .from("student")
      .select("name")
      .eq("student_id", String(student_id))
      .single();

    res.status(201).json({
      success: true,
      data: {
        ...data,
        student_name: student?.name ?? "Unknown Student",
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const updateLanguagePreference = async (req, res) => {
  try {
    const { student_id } = req.params;
    const { language_pref } = req.body;

    if (!language_pref) {
      return res
        .status(400)
        .json({ success: false, message: "Missing language_pref" });
    }

    const resolved = resolveLanguagePref(language_pref);
    if (!resolved) {
      return res.status(400).json({
        success: false,
        message: `Unsupported language_pref. Use one of: ${SUPPORTED_LANGUAGE_PREFS.join(", ")}`,
        error: { status: 400, code: "UNSUPPORTED_LANGUAGE" },
      });
    }

    const { data, error } = await supabase
      .from("student")
      .update({ language_pref: resolved })
      .eq("student_id", student_id)
      .select()
      .single();

    if (error)
      return res.status(500).json({
        success: false,
        message: "Failed to update language preference",
        error: error.message,
      });

    // A bare .select() expands to "*", so this row still holds the password.
    const { password, ...safeStudent } = data ?? {};
    res.json({ success: true, data: safeStudent });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const globalSearch = async (req, res) => {
  try {
    const { q } = req.query;
    const query = String(q || "").trim();

    if (!query) {
      return res.json({
        success: true,
        data: {
          query: "",
          courses: [],
          notices: [],
          scholarships: [],
          programs: [],
          majors: [],
          documents: [],
          facilities: [],
          posts: [],
        },
      });
    }

    const [courses, notices, scholarships, programs, majors, documents, facilities, posts] = await Promise.all([
      fetchSearchTable("course"),
      fetchAllNotices(supabase, { language: req.language || "en" }),
      fetchSearchTable("scholarship"),
      fetchSearchTable("extracurricular_program"),
      fetchSearchTable("major"),
      fetchSearchTable("kb_document"),
      fetchSearchTable("facility"),
      fetchSearchTable("post"),
    ]);

    const matchedCourses = rankSearchItems(
      courses.map((course) => ({
        ...course,
        title: course.course_name || course.course_name_en || course.name || "",
        content: course.description || course.department || course.classroom || "",
      })),
      query,
    );

    const matchedNotices = rankSearchItems(
      notices.map((notice) => ({
        ...notice,
        title: notice.title || notice.notice_title || notice.name || "",
        content:
          notice.body ||
          notice.content ||
          notice.description ||
          notice.department ||
          "",
      })),
      query,
    );

    const matchedScholarships = rankSearchItems(
      scholarships.map((scholarship) => ({
        ...scholarship,
        title: scholarship.title || scholarship.name || scholarship.scholarship_name || "",
        content: scholarship.description || scholarship.eligibility || scholarship.provider || "",
      })),
      query,
    );

    const matchedPrograms = rankSearchItems(
      programs.map((program) => ({
        ...program,
        title: program.program_name || program.title || program.name || "",
        content: program.description || program.department || program.eligibility || "",
      })),
      query,
    );

    const matchedMajors = rankSearchItems(
      majors.map((major) => ({
        ...major,
        title: major.major_name || major.title || major.name || "",
        content: major.department || major.description || major.summary || "",
      })),
      query,
    );

    const matchedDocuments = rankSearchItems(
      documents.map((document) => ({
        ...document,
        title: document.title || document.name || "",
        content: document.content || document.description || document.category || "",
      })),
      query,
    );

    const matchedFacilities = rankSearchItems(
      facilities.map((facility) => ({
        ...facility,
        title: facility.name || facility.title || "",
        content: facility.description || facility.location || facility.department || "",
      })),
      query,
    );

    const matchedPosts = rankSearchItems(
      posts.map((post) => ({
        ...post,
        title: post.title || post.name || "",
        content: post.content || post.description || "",
      })),
      query,
    ).map((post) => ({
      ...post,
      student_name: post.student?.name || "Unknown Student",
    }));

    res.json({
      success: true,
      data: {
        query,
        courses: matchedCourses,
        notices: matchedNotices,
        scholarships: matchedScholarships,
        programs: matchedPrograms,
        majors: matchedMajors,
        documents: matchedDocuments,
        facilities: matchedFacilities,
        posts: matchedPosts,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Search execution error",
      error: err.message,
    });
  }
};

const healthCheck = async (req, res) => {
  try {
    const start = Date.now();

    // Check DB tables connectivity
    const { error: dbError } = await supabase
      .from("student")
      .select("student_id")
      .limit(1);
    const latency = Date.now() - start;

    // Get table row counts helper
    const getCount = async (table) => {
      try {
        const { data } = await supabase.from(table).select("*");
        return data?.length ?? 0;
      } catch {
        return 0;
      }
    };

    const [students, courses, notices, facilities, posts, comments] =
      await Promise.all([
        getCount("student"),
        getCount("course"),
        getCount("notice"),
        getCount("facility"),
        getCount("post"),
        getCount("comment"),
      ]);

    res.json({
      success: true,
      status: "UP",
      database: dbError ? "DISCONNECTED" : "CONNECTED",
      latencyMs: latency,
      geminiApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
      counts: {
        students,
        courses,
        notices,
        facilities,
        posts,
        comments,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, status: "DOWN", error: err.message });
  }
};
const likePost = async (req, res) => {
  try {
    const { post_id } = req.params;
    const studentId = req.user ? req.user.student_id : req.body.student_id;

    if (!studentId) {
      return res
        .status(400)
        .json({ success: false, message: "Student ID required" });
    }

    const { data: post, error: fetchError } = await supabase
      .from("post")
      .select("post_id, likes_count")
      .eq("post_id", post_id)
      .single();

    if (fetchError || !post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
        error: fetchError?.message,
      });
    }

    const nextCount = Number(post.likes_count || 0) + 1;
    const { data: updated, error: updateError } = await supabase
      .from("post")
      .update({ likes_count: nextCount })
      .eq("post_id", post_id)
      .select("likes_count")
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Failed to like post",
        error: updateError.message,
      });
    }

    res.json({
      success: true,
      data: {
        likes_count: updated.likes_count,
        liked: true,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const reportPost = async (req, res) => {
  try {
    const { post_id } = req.params;

    const { data: post, error: fetchError } = await supabase
      .from("post")
      .select("post_id, reports_count")
      .eq("post_id", post_id)
      .single();

    if (fetchError || !post) {
      return res.status(404).json({
        success: false,
        message: "Post not found",
        error: fetchError?.message,
      });
    }

    const nextCount = Number(post.reports_count || 0) + 1;
    const { error: updateError } = await supabase
      .from("post")
      .update({ reports_count: nextCount })
      .eq("post_id", post_id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Failed to report post",
        error: updateError.message,
      });
    }

    res.json({
      success: true,
      message: "Post successfully reported and hidden from student feeds.",
      data: { reports_count: nextCount },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const { isPushConfigured, sendToStudent, PUBLIC_KEY: VAPID_PUBLIC_KEY } = require("../services/pushNotificationService");

/**
 * Registers a browser to receive push notifications.
 *
 * Upserts on `endpoint` rather than inserting: a browser that re-subscribes —
 * after a permission reset, a reinstall, or simply a second visit — returns the
 * SAME endpoint, and inserting again would send every notice to it twice.
 */
const subscribeToPush = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    const { endpoint, keys, language_pref: languagePref } = req.body || {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({
        success: false,
        message: "A push subscription needs an endpoint and both keys",
      });
    }

    const { error } = await supabase
      .from("push_subscription")
      .upsert(
        {
          student_id: studentId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          language_pref: String(languagePref || "").slice(0, 5) || null,
        },
        { onConflict: "endpoint" },
      );

    if (error) {
      console.error("Failed to store push subscription:", error.message);
      return res.status(500).json({
        success: false,
        message: "Could not enable notifications. Please try again.",
      });
    }

    res.json({ success: true, data: { subscribed: true } });
  } catch (err) {
    console.error("Failed to store push subscription:", err.message);
    res.status(500).json({ success: false, message: "Unexpected server error" });
  }
};

/** Removes one browser's subscription. Idempotent — unsubscribing twice is fine. */
const unsubscribeFromPush = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: "endpoint is required" });
    }

    // Scoped to the caller so one student cannot unsubscribe another's device.
    const { error } = await supabase
      .from("push_subscription")
      .delete()
      .eq("endpoint", endpoint)
      .eq("student_id", studentId);

    if (error) {
      return res.status(500).json({ success: false, message: "Could not disable notifications" });
    }
    res.json({ success: true, data: { subscribed: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unexpected server error" });
  }
};

/**
 * Tells the client whether push is available and, if so, the key it needs to
 * subscribe. The public key is safe to serve — it is compiled into the bundle
 * anyway — but serving it from here means the browser and the server can never
 * disagree about which key pair is in use, which would silently produce
 * subscriptions the server cannot send to.
 */
const getPushConfig = async (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: isPushConfigured(),
      publicKey: isPushConfigured() ? VAPID_PUBLIC_KEY : null,
    },
  });
};

/** Sends a notification to the caller's own devices, so a student can confirm it works. */
const sendTestPush = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    if (!isPushConfigured()) {
      return res.status(503).json({ success: false, message: "Push is not configured on this server" });
    }
    const result = await sendToStudent(supabase, studentId, {
      title: "Hey! PNU",
      body: "Notifications are on. You will hear about new PNU notices here.",
      url: "/notifications",
      tag: "heypnu-test",
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const FEEDBACK_KINDS = new Set(["feedback", "app-support"]);
const MAX_FEEDBACK_LENGTH = 4000;

/**
 * Records in-app feedback.
 *
 * Both forms that reach here previously flipped a local `sent` flag and threw
 * the text away. This endpoint either stores the report or fails loudly — it
 * must never answer 200 for a message it did not save, which is the whole
 * point of the change.
 */
const submitFeedback = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    const message = String(req.body?.message ?? "").trim();

    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }
    if (message.length > MAX_FEEDBACK_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message must be ${MAX_FEEDBACK_LENGTH} characters or fewer`,
      });
    }

    const kind = FEEDBACK_KINDS.has(req.body?.kind) ? req.body.kind : "feedback";
    const languagePref = String(req.body?.language_pref ?? "").slice(0, 5) || null;

    const { error } = await supabase.from("app_feedback").insert({
      student_id: studentId ?? null,
      kind,
      message,
      language_pref: languagePref,
    });

    if (error) {
      // Most likely cause is that supabase/feedback.sql has not been applied.
      // Say so in the log; the student just sees that it did not send.
      console.error("Failed to store feedback:", error.message);
      return res.status(500).json({
        success: false,
        message: "Could not save your message. Please try again later.",
      });
    }

    res.json({ success: true, data: { received: true } });
  } catch (err) {
    console.error("Failed to store feedback:", err.message);
    res.status(500).json({ success: false, message: "Unexpected server error" });
  }
};

const getAllStudents = async (req, res) => {
  try {
    const { data: students, error } = await supabase
      .from("student")
      .select("*, major:major_id(major_name)")
      .order("name", { ascending: true });

    // The select is "*" so it carries the password column. Strip it per row —
    // `major` is deliberately kept, since the join above exists only to add it.
    const safeStudents = (students ?? []).map(({ password, ...rest }) => rest);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch students",
        error: error.message,
      });
    }

    res.json({
      success: true,
      data: safeStudents,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const requestStudentDeletion = async (req, res) => {
  try {
    const { student_id } = req.params;
    
    // Check authorization: A user can only request their own deletion
    if (String(req.user?.student_id) !== String(student_id)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only request deletion of your own account.",
      });
    }

    const { data, error } = await supabase
      .from("student")
      .update({ deletion_requested: true })
      .eq("student_id", student_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to request account deletion",
        error: error.message,
      });
    }

    // Same bare .select() as above — never echo the password back.
    const { password, ...safeStudent } = data ?? {};
    res.json({
      success: true,
      message: "Account deletion requested successfully. The administrator will review and delete your account shortly.",
      data: safeStudent,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const hardDeleteStudent = async (req, res) => {
  try {
    const { student_id } = req.params;

    // Execute CASCADE physical delete in Supabase
    const { error } = await supabase
      .from("student")
      .delete()
      .eq("student_id", student_id);

    if (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete student account",
        error: error.message,
      });
    }

    res.json({
      success: true,
      message: `Student account ${student_id} and all related checklists, timetables, posts, and comments have been permanently wiped.`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
};

const getEmergencyGuideHandler = async (req, res, next) => {
  try {
    let nationality = null;

    if (req.user?.student_id) {
      const { data: student } = await supabase
        .from("student")
        .select("nationality")
        .eq("student_id", req.user.student_id)
        .maybeSingle();
      nationality = student?.nationality ?? null;
    }

    const data = await getEmergencyGuide(req.language || "en", nationality);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

const getCampusFacilitiesHandler = async (req, res, next) => {
  try {
    const menuDate =
      typeof req.query.menu_date === "string" ? req.query.menu_date : "";
    const data = await getCampusFacilities(req.language || "en", { menuDate });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

const getCareerOpportunities = async (req, res, next) => {
  try {
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);
    const jobType = typeof req.query.jobType === "string" ? req.query.jobType : null;

    const page =
      Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 50)
        : 10;

    const [scrapedData, storedOpportunities] = await Promise.all([
      getCareerOpportunitiesPage({ page, limit, jobType }),
      fetchStoredCareerOpportunities({ limit: 50, jobType }).catch(() => []),
    ]);

    const seen = new Set();
    const opportunities = [];

    [...(scrapedData.opportunities || []), ...storedOpportunities].forEach((item) => {
      const key = item.sourceUrl || `${item.source}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      opportunities.push(item);
    });

    const careerCounts = new Map();
    [...(scrapedData.careers || []), ...storedOpportunities.map((item) => ({ name: item.role || item.jobType || "volunteer", count: 1 }))]
      .forEach((item) => {
        if (!item.name) return;
        careerCounts.set(item.name, (careerCounts.get(item.name) || 0) + item.count);
      });

    const translatedOpportunities = await translateCareers(opportunities.slice(0, limit), req.language);

    const data = {
      ...scrapedData,
      careers: Array.from(careerCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko")),
      opportunities: translatedOpportunities,
    };

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * Personalized internship/job recommendations, ranked against the
 * requesting student's profile (interests/career areas/academic areas
 * matched against posting title/role/company) via jobRecommendationEngine.
 * Falls back to soonest-deadline postings when the profile has no tags to
 * match yet, so the recommended section is never empty.
 */
const getCareerRecommendations = async (req, res, next) => {
  try {
    const jobType = typeof req.query.jobType === "string" ? req.query.jobType : null;
    const [data, volunteerOpportunities, context] = await Promise.all([
      getCareerOpportunitiesPage({ page: 1, limit: 20, jobType }),
      fetchStoredCareerOpportunities({ limit: 10, jobType: jobType || "volunteer" }).catch(() => []),
      fetchStudentContext(req.user.student_id).catch(() => null),
    ]);
    const recommendedSource = [...(data.opportunities || []), ...volunteerOpportunities];
    const studentProfile = context
      ? adaptStudentProfile(context.rawStudentInput).recommendationProfile
      : {};

    const ranked = recommendJobs(studentProfile, recommendedSource, { limit: 3 });
    const recommended = ranked.map((item, index) => ({
      ...item,
      location: item.location || "Korea",
      jobType: item.jobType || "internship",
      matchReason:
        item.matchReason ||
        (item.jobType === "volunteer"
          ? "Volunteer opportunity with an application deadline soon"
          : "Popular entry-level opening"),
      recommendationRank: index + 1,
    }));

    const translatedRecommended = await translateCareers(recommended, req.language);

    return res.status(200).json({
      success: true,
      data: translatedRecommended,
    });
  } catch (err) {
    return next(err);
  }
};

const getMyCommunityGroupHandler = async (req, res) => {
  try {
    const scope = String(req.query.scope || "department");
    if (!["department", "country", "all"].includes(scope)) {
      return res.status(400).json({
        success: false,
        message: "scope must be department, country, or all",
      });
    }

    const studentId = req.user?.student_id;
    const profile = await communityService.getStudentProfileLite(studentId);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const group = await communityService.getMyCommunityGroup(scope, profile);
    return res.json({ success: true, data: group });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load community group",
      error: err.message,
    });
  }
};

const getCommunityPostsHandler = async (req, res) => {
  try {
    const scope = String(req.query.scope || "all");
    const groupId = req.query.group_id ? String(req.query.group_id) : null;
    const groupSlug = req.query.group_slug ? String(req.query.group_slug) : null;

    const posts = await communityService.listCommunityPosts({
      scope,
      groupId,
      groupSlug,
    });
    return res.json({ success: true, data: posts });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load community posts",
      error: err.message,
    });
  }
};

const createCommunityPostHandler = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { content, scope, group_id, group_slug } = req.body || {};
    const post = await communityService.createCommunityPost({
      studentId,
      scope: scope || "all",
      groupId: group_id,
      groupSlug: group_slug,
      content,
    });

    return res.status(201).json({ success: true, data: post });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to create post",
      error: err.message,
    });
  }
};

const likeCommunityPostHandler = async (req, res) => {
  try {
    const { postId } = req.params;
    const data = await communityService.likeCommunityPost(postId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to like post",
      error: err.message,
    });
  }
};

const deleteCommunityPostHandler = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { postId } = req.params;
    const data = await communityService.deleteCommunityPost({ postId, studentId });
    return res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      message: err.message || "Failed to delete post",
      error: err.message,
    });
  }
};

module.exports = {
  getAllMajors,
  getAllStudents,
  submitFeedback,
  subscribeToPush,
  unsubscribeFromPush,
  getPushConfig,
  sendTestPush,
  requestStudentDeletion,
  hardDeleteStudent,
  testConnection,
  loginStudent,
  verifyLoginStudent,
  signupStudent,
  verifySignupStudent,
  completeSignupStudent,
  getGraduationProgress,
  updateGraduationRequirement,
  getStudentChecklist,
  updateChecklistItem,
  getAllScholarships,
  applyForScholarship,
  getStudentProfile,
  updateStudentProfile,
  forgotPassword,
  resetPassword,
  getAllBoards,
  getBoardPosts,
  createPost,
  likePost,
  reportPost,
  getFacilities,
  getFacilityById,
  getPnuContacts,
  getFaqItems,
  getAcademicRecords,
  getNotices,
  syncNotices,
  getNotifications,
  getCourses,
  getEnrollments,
  createEnrollment,
  updateEnrollment,
  deleteEnrollment,
  getPostComments,
  createComment,
  updateLanguagePreference,
  globalSearch,
  healthCheck,
  getCareerOpportunities,
  getCareerRecommendations,
  getMyCommunityGroupHandler,
  getCommunityPostsHandler,
  createCommunityPostHandler,
  likeCommunityPostHandler,
  deleteCommunityPostHandler,
  getEmergencyGuideHandler,
  getCampusFacilitiesHandler,
};

