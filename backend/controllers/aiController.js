

const departmentProfiles = require("../ai/departmentProfiles");
const { recommendMajors } = require("../ai/recommendationEngine");
const supabase = require("../supabaseClient");
const { localizeRow } = require("../middleware/languageMiddleware");
const ragService = require("../services/ragService");
const {
  createClaudeMajorAnalysis,
} = require("../services/claudeMajorRecommendationService");
const {
  isGeminiConfigured,
  generateGeminiChat,
  generateGeminiChatStream,
  generateGeminiMajorAnalysis,
  translateGeminiAnnouncement,
} = require("../services/geminiService");
const {
  isOpenRouterConfigured,
  generateOpenRouterChat,
  generateOpenRouterChatStream,
  generateOpenRouterMajorAnalysis,
} = require("../services/openrouterService");
const {
  getChecklistForStudent,
  normalizeGrade,
} = require("../services/semesterChecklistService");
function selectGroundingCourses(courses, message, targetYear, limit = 24) {
  const queryTokens = String(message || '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) || [];
  return [...(courses || [])]
    .map((course) => {
      const text = [course.course_name, course.course_name_en, course.course_code]
        .filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
      const queryScore = queryTokens.reduce(
        (score, token) => score + (text.includes(token) ? 20 : 0),
        0,
      );
      const yearScore = Number(course.recommended_year) === Number(targetYear) ? 10 : 0;
      const requiredScore = course.category === 'REQUIRED' ? 4 : 0;
      return { course, score: queryScore + yearScore + requiredScore };
    })
    .sort((a, b) => b.score - a.score
      || String(a.course.course_name_en || a.course.course_name)
        .localeCompare(String(b.course.course_name_en || b.course.course_name)))
    .slice(0, limit)
    .map(({ course }) => course);
}

async function getAcademicPromptContext(studentId, supabaseClient, message = '') {
  if (!studentId) return { context: '', queryExpansion: '' };
  try {
    const { data: student } = await supabaseClient
      .from("student")
      .select("student_id, student_type, completed_courses, intake_term, grade, major_id, major:major_id(major_id,major_name)")
      .eq("student_id", studentId)
      .single();
    if (student) {
      const majorName = student.major?.major_name || "Unassigned Major";
      const studentType = student.student_type || "Current";
      const completedList = student.completed_courses || [];
      const studentIdStr = String(student.student_id || studentId);
      const intakeTerm = student.intake_term || "March";

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1; // 1-indexed

      // Work from the recorded academic year, not the student id.
      //
      // The id is only an intake year when the email local part is the PNU
      // student number. Signup hashes every other local part into
      // [1e9, 2^31), so `htet_kaung_san@pusan.ac.kr` became id 1830…, and
      // parsing its first four digits told the model the student enrolled in
      // March 1830 and had completed several hundred semesters — which then
      // drove the "recommend 4th year courses" instruction below. The bug is
      // invisible in demos, because seeded accounts have numeric ids.
      //
      // A real PNU student number is 8-9 digits and its first four are the
      // intake year; studentIdFromEmail returns it verbatim in that case. Every
      // hashed id is exactly 10 digits, because the hash is
      // 1_000_000_000 + (digest % 1_147_483_647). Length alone separates the
      // two populations exactly — a year-range test does not, since hashed ids
      // starting 2000-2147 look like plausible years.
      //
      // The id wins over `grade` when it is usable: it is immutable and stays
      // correct as the student progresses, while `grade` is captured once at
      // onboarding and never advances. They have already drifted in the live
      // data — see scripts/backfill-student-grade.mjs, which treats the id as
      // the source of truth for exactly this reason, and note that ProfilePage
      // shows the student a year label derived from the id. Preferring `grade`
      // would make the assistant contradict the profile screen.
      const isRealPnuStudentNumber = /^\d{8,9}$/.test(studentIdStr);
      const idPrefixYear = parseInt(studentIdStr.substring(0, 4), 10);
      const idIsUsableIntakeYear =
        isRealPnuStudentNumber &&
        Number.isInteger(idPrefixYear) &&
        idPrefixYear >= 2000 &&
        idPrefixYear <= currentYear + 1;

      // The Korean academic year turns over in March, not in January, so
      // deriving an intake year from `grade` has to use the academic year —
      // otherwise every student is placed a year late for all of Jan/Feb.
      const academicYear = currentMonth >= 3 ? currentYear : currentYear - 1;
      const gradeValue = Number(student.grade);
      const hasKnownGrade =
        Number.isInteger(gradeValue) && gradeValue >= 1 && gradeValue <= 4;

      const intakeYear = idIsUsableIntakeYear
        ? idPrefixYear
        : hasKnownGrade
          ? academicYear - (gradeValue - 1)
          : currentYear;

      let semestersCompleted = 0;
      let iterYear = intakeYear;
      let iterTerm = intakeTerm;

      while (iterYear < currentYear || (iterYear === currentYear && (
        iterTerm === "March" && currentMonth >= 7 // March intake completes around July
      ))) {
        semestersCompleted++;
        if (iterTerm === "March") {
          iterTerm = "September";
        } else {
          iterTerm = "March";
          iterYear++;
        }
      }

      // Determine upcoming calendar semester type (Korea Spring starts in March, Fall starts in Sept)
      const upcomingSem = (currentMonth >= 3 && currentMonth <= 8) ? "Fall" : "Spring";
      const upcomingSemTermStr = upcomingSem === "Fall" ? "2nd Semester" : "1st Semester";
      
      // Academic year student is entering in the upcoming semester
      const nextSemesterNumber = semestersCompleted + 1;
      const enteringYearNum = Math.min(4, Math.ceil(nextSemesterNumber / 2));
      const enteringYearStr = enteringYearNum === 1 ? "1st Year"
                            : enteringYearNum === 2 ? "2nd Year"
                            : enteringYearNum === 3 ? "3rd Year"
                            : "4th Year";

      const targetRecommendationLabel = `${enteringYearStr} - ${upcomingSemTermStr}`;

      let context = `Student Academic Background:\n` +
        `- Major: ${majorName}\n` +
        `- Academic Status: ${studentType === "Freshman" ? "Newly Admitted Freshman" : "Current Enrolled Student"}\n` +
        `- Intake Profile: Enrolled in ${intakeTerm} ${intakeYear}\n` +
        `- Completed semesters so far: ${semestersCompleted}\n` +
        `- Upcoming target semester: Entering ${enteringYearStr} (calendar ${upcomingSemTermStr} in the ${upcomingSem} semester)\n` +
        `- TARGETED RECOMMENDATION: When asked for course advice or recommendations for next semester, you MUST prioritize and suggest courses designed for **${targetRecommendationLabel}** in the curriculum for ${majorName}.\n`;
        
      if (studentType === "Freshman") {
        context += `- Note: Recommend only standard starting 1st semester courses.\n`;
      } else {
        context += `- Completed Courses (Taken already): ${completedList.length > 0 ? completedList.join(", ") : "None recorded"}. IMPORTANT: DO NOT recommend any courses listed as completed! Only recommend courses they have not taken yet.\n`;
      }
      // Graduation requirements come from the database, not from retrieval.
      //
      // "Graduation credits" previously answered "you need to complete a
      // certain number of credits — check with your advisor", because no
      // knowledge-base document covers graduation and RAG had nothing to
      // return. The numbers were in Postgres the whole time: 103 rows in
      // graduation_requirement, which the Credits screen already renders.
      //
      // These are injected rather than embedded on purpose. They are
      // per-major, exact, and already scoped to this student, so a similarity
      // search could only make them worse — and 116 majors' worth of
      // near-identical documents would crowd retrieval the way the curriculum
      // payloads already do.
      if (student.major_id) {
        const { data: requirements, error: reqError } = await supabaseClient
          .from('graduation_requirement')
          .select('requirement_name, requirement_type, target_value, unit, description, display_order')
          .eq('major_id', Number(student.major_id))
          .order('display_order', { ascending: true });

        if (!reqError && Array.isArray(requirements) && requirements.length > 0) {
          const total = requirements
            .filter((row) => row.requirement_type === 'CREDIT')
            .reduce((sum, row) => sum + (Number(row.target_value) || 0), 0);

          context += `\nGRADUATION REQUIREMENTS for ${majorName} (authoritative — from PNU records):\n`;
          context += requirements
            .map((row) =>
              `- ${row.requirement_name}: ${row.target_value} ${row.unit || 'credits'}${row.description ? ` (${row.description})` : ''}`,
            )
            .join('\n');
          if (total > 0) {
            context += `\n- Total credits required to graduate: ${total}\n`;
          }
          context += `- Quote these figures exactly when asked about graduation, credits or requirements. They are this student's own major's rules. Do not round them, generalise them, or tell the student to ask an advisor for numbers that are listed here.\n`;
        }
      }

      if (student.major_id) {
        const { data: liveCourses, error: courseError } = await supabaseClient
          .from('course')
          .select('course_id,course_name,course_name_en,course_code,category,recommended_year,credit')
          .eq('major_id', Number(student.major_id))
          .order('course_id', { ascending: true });
        if (!courseError && Array.isArray(liveCourses) && liveCourses.length > 0) {
          let verifiedCodeByName = new Map();
          try {
            const names = [...new Set(liveCourses.filter((c) => !c.course_code).map((c) => c.course_name).filter(Boolean))];
            const { data: identityMatches, error: identityError } = await supabaseClient
              .from('course')
              .select('course_name,course_code')
              .in('course_name', names)
              .not('course_code', 'is', null);
            if (!identityError) {
              verifiedCodeByName = new Map(
                (identityMatches || []).map((course) => [course.course_name, course.course_code]),
              );
            }
          } catch (_error) {
            verifiedCodeByName = new Map();
          }
          const enrichedLiveCourses = liveCourses.map((course) => ({
            ...course,
            course_code:
              course.course_code || verifiedCodeByName.get(course.course_name) || null,
          }));
          const grounded = selectGroundingCourses(
            enrichedLiveCourses,
            message,
            student.grade || enteringYearNum,
          );
          context += `\nLIVE SUPABASE COURSE CATALOG (authoritative for course identity):\n`;
          context += grounded.map((course) =>
            `- ${course.course_code || 'code unavailable'} | ${course.course_name_en || course.course_name} | ${course.course_name} | ${course.category || 'category unavailable'} | recommended year ${course.recommended_year ?? 'unavailable'} | ${course.credit ?? 'unknown'} credits`
          ).join('\n');
          context += `\n- Only name a course when it appears in this live catalog. Do not invent course codes, professors, sections, or schedules. If schedule/offering data is absent, say it is unavailable.\n`;
        }
      }
      return {
        context: context,
        queryExpansion: `${majorName} ${targetRecommendationLabel} curriculum`
      };
    }
  } catch (err) {
    console.error("Failed to load academic context for AI:", err.message);
  }
  return { context: "", queryExpansion: "" };
}


async function recommendMajor(req, res) {
  try {
    const {
      academicAreas = [],
      activities = [],
      strengths = [],
      careerAreas = [],
      learningStyles = [],
      topikLevel,
      topN = 3,
    } = req.body || {};

    const userProfile = {
      academicAreas,
      activities,
      strengths,
      careerAreas,
      learningStyles,
      topikLevel,
    };

    const requestedTopN = Number(topN);
    const safeTopN =
      Number.isInteger(requestedTopN) && requestedTopN > 0 ? requestedTopN : 3;

    const ruleBasedRecommendations = recommendMajors(
      userProfile,
      departmentProfiles,
      safeTopN,
    );

    let aiResult;
    let method = "rule-based";

    if (isOpenRouterConfigured()) {
      aiResult = await generateOpenRouterMajorAnalysis(
        userProfile,
        ruleBasedRecommendations,
      );
      method = aiResult.enabled ? "rule-based + openrouter" : "rule-based";
    } else if (isGeminiConfigured()) {
      aiResult = await generateGeminiMajorAnalysis(
        userProfile,
        ruleBasedRecommendations,
      );
      method = aiResult.enabled ? "rule-based + gemini" : "rule-based";
    } else {
      aiResult = await createClaudeMajorAnalysis(
        userProfile,
        ruleBasedRecommendations,
      );
      method = aiResult.enabled ? "rule-based + claude" : "rule-based";
    }

    const aiReasons = new Map(
      (aiResult.analysis?.recommendations || [])
        .filter((item) => item?.id && item?.claudeReason)
        .map((item) => [item.id, item.claudeReason]),
    );

    const recommendations = ruleBasedRecommendations.map((recommendation) => ({
      ...recommendation,
      claudeReason: aiReasons.get(recommendation.id) || null,
    }));

    return res.status(200).json({
      success: true,
      recommendationMethod: method,
      recommendations,
      aiAnalysis: aiResult.analysis,
      warning: aiResult.warning,
    });
  } catch (error) {
    console.error("Major recommendation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to generate major recommendations.",
    });
  }
}

// Predefined fallback responses for PNU campus life questions when Claude is not configured
const CAMPUS_FAQ = [
  {
    keywords: ["arc", "alien", "registration", "visa", "외국인등록증", "비자"],
    response:
      "To apply for your Alien Registration Card (ARC), you must visit the Busan Immigration Office within 90 days of your arrival. Required documents: Passport, 1 color photo (3.5x4.5cm), Certificate of Enrollment, fee (30,000 KRW), and proof of residence. You can make an appointment online at Hikorea.go.kr.",
  },
  {
    keywords: ["bank", "account", "nh", "card", "은행", "계좌"],
    response:
      "You can open a student bank account at the NH Bank (Nonghyup) branch located on the PNU campus (inside the Moonchang Hall or main administrative building). Bring your Passport, Certificate of Enrollment, and your ARC (if available).",
  },
  {
    keywords: [
      "insurance",
      "health",
      "medical",
      "보험",
      "의료",
      "국민건강보험",
    ],
    response:
      "All international students in Korea are automatically registered for the National Health Insurance Service (NHIS) once their alien registration is processed. The monthly fee is automatically billed. For details, visit the PNU International Office.",
  },
  {
    keywords: ["thesis", "graduation", "outline", "졸업", "논문"],
    response:
      "To graduate, you must submit your graduation thesis outline to your department office by the specified deadline (usually in October for the Fall semester, or April for the Spring semester). Check with your department academic advisor for outline templates.",
  },
  {
    keywords: ["topik", "korean", "certificate", "토픽", "한국어능력시험"],
    response:
      "PNU graduation requirements normally specify obtaining TOPIK Level 4 or above. You must submit your official TOPIK certificate to your department office before your final semester ends.",
  },
  {
    keywords: ["credit", "audit", "requirements", "학점"],
    response:
      "You must complete a credit audit to verify that your course credits meet your major requirements (usually 130+ total credits, including major required, elective, and general education). You can schedule a credit audit with your department advisor.",
  },
  {
    keywords: ["cafeteria", "food", "eat", "restaurant", "학식", "식당"],
    response:
      "Student cafeterias are located near the main library (Geumjeong Hall), Moonchang Hall, and the engineering building. Standard hours are 11:30 AM – 1:30 PM for lunch, and 5:30 PM – 7:00 PM for dinner on weekdays.",
  },
  {
    keywords: ["library", "study", "book", "도서관"],
    response:
      "The PNU Central Library is open daily for student study. You can access the library and check out books using your student ID card or mobile student ID app. Study room reservations can be made via the PNU Library app.",
  },
];

async function handleChat(req, res) {
  try {
    const { message } = req.body;
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    // Identity must come from verified authentication, never a request body.
    const studentId = req.user?.student_id ?? null;

    // Prioritize history turns passed in the request body (supports client-side multi-session)
    let history = [];
    if (req.body.history && Array.isArray(req.body.history)) {
      history = req.body.history;
    } else {
      // Load recent history context (last 10 messages) if studentId is present
      const supabase = require("../supabaseClient");
      if (studentId) {
        try {
          const { data, error } = await supabase
            .from("chatbot_log")
            .select("*")
            .eq("student_id", studentId)
            .order("timestamp", { ascending: false })
            .limit(10);

          if (error) {
            console.error(
              "Failed to load chat history for context:",
              error.message,
            );
          } else if (data) {
            // Re-sort chronological order and map to turns
            history = [...data].reverse().map((log) => ({
              question: log.question,
              answer: log.answer,
            }));
          }
        } catch (histErr) {
          console.error(
            "Error loading chat history for context:",
            histErr.message,
          );
        }
      }
    }

    let userLangPref = "EN";
    let filters = { country: "ALL", gender: "ALL" };
    if (studentId) {
      try {
        const { data: student } = await supabase
          .from("student")
          .select("language_pref, nationality")
          .eq("student_id", studentId)
          .single();
        if (student) {
          if (student.language_pref) userLangPref = student.language_pref;
          if (student.nationality) filters.country = student.nationality;
        }
      } catch (err) {
        console.error("Failed to load language/nationality for AI chat:", err.message);
      }
    }

    const { context: academicPromptContext, queryExpansion } = await getAcademicPromptContext(studentId, supabase, message);

    let ragUsed = false;
    let ragStatus = "not-used";

    // Retrieve grounding context from Vector RAG system
    let context = "";
    try {
      const augmentedQuery = queryExpansion ? `${queryExpansion} ${message}` : message;
      context = await ragService.retrieveContext(augmentedQuery, filters, 3);
    } catch (ragErr) {
      ragStatus = "failed";
      console.error("RAG context retrieval failed:", ragErr.message);
    }

    let reply = null;
    let provider = "fallback";
    let isFallback = true;
    let fallbackReason = "No provider was configured or the provider call failed.";

    // 1. If OpenRouter is configured in .env, call OpenRouter for real AI chat.
    if (isOpenRouterConfigured()) {
      try {
        let augmentedMsg = "";
        if (academicPromptContext) {
          augmentedMsg += `${academicPromptContext}\n`;
        }
        if (context) {
          ragUsed = true;
          ragStatus = "used";
          augmentedMsg += `PNU Knowledge Base Context:\n${context}\n\n`;
        }
        augmentedMsg += `User Question: ${message}`;

        reply = await generateOpenRouterChat(augmentedMsg, history);
        provider = "openrouter";
        isFallback = false;
        fallbackReason = null;
      } catch (orErr) {
        console.error(
          "OpenRouter Chat Error, falling back to Gemini/Claude/FAQ:",
          orErr.message,
        );
      }
    }

    // 2. If Gemini is configured in .env, call Gemini for real AI chat.
    if (!reply && isGeminiConfigured()) {
      try {
        let geminiMsg = message;
        if (academicPromptContext) {
          geminiMsg = `${academicPromptContext}\n${geminiMsg}`;
        }
        if (context) {
          ragUsed = true;
          ragStatus = "used";
        }
        reply = await generateGeminiChat(geminiMsg, userLangPref, context);
        provider = "gemini";
        isFallback = false;
        fallbackReason = null;
      } catch (geminiErr) {
        console.error(
          "Gemini Chat Error, falling back to Claude/FAQ:",
          geminiErr.message,
        );
      }
    }

    // 3. If Anthropic/Claude is configured in .env, call Claude for real AI chat.
    if (!reply && process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_MODEL) {
      try {
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: process.env.CLAUDE_MODEL,
          max_tokens: 300,
          system:
            "You are the Hey! PNU Smart Assistant, an AI helper for international students at Pusan National University. Keep your responses short (under 4 sentences), friendly, helpful, and focused on PNU campus life, academics, or settlement requirements. Answer in the same language the student asks in.",
          messages: [{ role: "user", content: message }],
        });

        reply = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        provider = "claude";
        isFallback = false;
        fallbackReason = null;
      } catch (claudeErr) {
        console.error(
          "Claude Chat Error, falling back to local FAQ:",
          claudeErr.message,
        );
      }
    }

    // 4. Fallback: Smart keyword matching.
    if (!reply) {
      const lowerMsg = message.toLowerCase();
      for (const faq of CAMPUS_FAQ) {
        const match = faq.keywords.some((keyword) =>
          lowerMsg.includes(keyword),
        );
        if (match) {
          reply = faq.response;
          break;
        }
      }
    }

    // 5. Default general assistant response if no keyword matches.
    if (!reply) {
      reply =
        "I'm the Hey! PNU Assistant. I can help you with campus inquiries such as ARC application, bank accounts, health insurance, thesis outline submissions, TOPIK requirements, library access, and cafeterias. Please ask about any of these topics!";
    }

    if (!reply || provider === "fallback") {
      fallbackReason = "No provider key was configured or the provider call failed.";
      if (provider !== "fallback") {
        provider = "fallback";
      }
    }

    // Save the conversation turn to the database if studentId is present
    if (studentId) {
      try {
        const { error: insertError } = await supabase
          .from("chatbot_log")
          .insert({
            student_id: studentId,
            question: message,
            answer: reply,
            timestamp: new Date().toISOString(),
          });

        if (insertError) {
          console.error(
            "Failed to save chatbot log in database:",
            insertError.message,
          );
        }
      } catch (dbErr) {
        console.error("Error saving chatbot log in database:", dbErr.message);
      }
    }

    return res.json({
      success: true,
      reply,
      metadata: {
        provider,
        isFallback,
        fallbackReason,
        ragUsed,
        ragStatus,
      },
    });
  } catch (err) {
    console.error("Chat controller error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function getChatHistory(req, res) {
  try {
    const { student_id } = req.params;
    if (!student_id) {
      return res
        .status(400)
        .json({ success: false, message: "Student ID is required" });
    }
    if (String(req.user?.student_id) !== String(student_id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const supabase = require("../supabaseClient");

    // Fetch logs ordered by timestamp ascending (chronological order)
    const { data, error } = await supabase
      .from("chatbot_log")
      .select("*")
      .eq("student_id", student_id)
      .order("timestamp", { ascending: true });

    if (error) {
      console.error(
        "Error fetching chat history from Supabase:",
        error.message,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch chat history" });
    }

    return res.json({ success: true, history: data || [] });
  } catch (err) {
    console.error("Chat history controller error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function clearChatHistory(req, res) {
  try {
    const { student_id } = req.params;
    if (!student_id) {
      return res
        .status(400)
        .json({ success: false, message: "Student ID is required" });
    }
    if (String(req.user?.student_id) !== String(student_id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const supabase = require("../supabaseClient");
    const { error } = await supabase
      .from("chatbot_log")
      .delete()
      .eq("student_id", student_id);

    if (error) {
      console.error(
        "Error clearing chat history from Supabase:",
        error.message,
      );
      return res
        .status(500)
        .json({ success: false, message: "Failed to clear chat history" });
    }

    return res.json({
      success: true,
      message: "Chat history cleared successfully",
    });
  } catch (err) {
    console.error("Clear chat history error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function translateAnnouncement(req, res) {
  try {
    const { imageBase64, mimeType, textContent } = req.body;

    if (!isGeminiConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Gemini translation service is not configured.",
      });
    }

    if (!imageBase64 && !textContent) {
      return res.status(400).json({
        success: false,
        message: "Missing raw text or base64 image payload to translate.",
      });
    }

    const result = await translateGeminiAnnouncement(
      imageBase64,
      mimeType,
      textContent,
    );
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Translation controller error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to translate announcement",
      error: err.message,
    });
  }
}

async function handleChatStream(req, res) {
  try {
    const { message, languagePref = "EN" } = req.body || {};
    if (!message) {
      return res
        .status(400)
        .json({ success: false, message: "Message is required" });
    }

    if (!isGeminiConfigured() && !isOpenRouterConfigured()) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const fallbackText =
        "AI provider is not configured. The assistant is using the built-in fallback response.";
      const words = fallbackText.split(" ");
      for (const word of words) {
        res.write(`data: ${JSON.stringify({ text: word + " " })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const studentId = req.user?.student_id;
    let userLangPref = languagePref;
    let filters = { country: "ALL", gender: "ALL" };

    if (studentId) {
      try {
        const { data: student } = await supabase
          .from("student")
          .select("language_pref, nationality")
          .eq("student_id", studentId)
          .single();
        if (student) {
          if (student.language_pref) userLangPref = student.language_pref;
          if (student.nationality) filters.country = student.nationality;
        }
      } catch (err) {
        console.error("Failed to load student details for chat stream:", err.message);
      }
    }

    const { context: academicPromptContext, queryExpansion } = await getAcademicPromptContext(studentId, supabase, message);

    // Retrieve grounding context from Vector RAG system
    let context = "";
    let ragSources = [];
    let ragUsed = false;
    let ragStatus = "not-used";
    try {
      const augmentedQuery = queryExpansion ? `${queryExpansion} ${message}` : message;
      const retrieved = await ragService.retrieveContextWithSources(augmentedQuery, filters, 3);
      context = retrieved.context;
      ragSources = retrieved.sources;
      if (context) {
        ragUsed = true;
        ragStatus = "used";
      }
    } catch (ragErr) {
      ragStatus = "failed";
      console.error("RAG context retrieval failed for stream:", ragErr.message);
    }

    // Follow-up prompts are built from documents that actually matched, so every
    // suggestion is one the knowledge base can answer.
    //
    // Curriculum documents are excluded. They are machine-generated per-major,
    // per-year recommendation payloads titled like "Computer Engineering - 2nd
    // Year - 1st Semester Recommendations" — useful as model context, but not
    // something to invite a student to read. They also surface constantly
    // regardless of topic, because the retrieval query is expanded with the
    // student's academic background, so an immigration question reliably pulls
    // them in too. Every other category is a human-written guide and makes a
    // sensible chip. When nothing qualifies we send none and the client keeps
    // its own defaults.
    const MACHINE_GENERATED_CATEGORIES = new Set(["Curriculum"]);
    const priorTurns = Array.isArray(req.body.history) ? req.body.history : [];
    const askedAlready = new Set(
      priorTurns
        .map((turn) => String(turn?.question ?? "").toLowerCase().trim())
        .concat(String(message).toLowerCase().trim()),
    );

    const followUps = ragSources
      .filter((source) => !MACHINE_GENERATED_CATEGORIES.has(source.category))
      .map((source) => `Tell me more about ${source.title}`)
      .filter((prompt) => !askedAlready.has(prompt.toLowerCase().trim()))
      .slice(0, 3);

    // Whichever provider answers reports why it stopped; "stop" is a complete
    // answer and anything else (usually "length") is a truncated one.
    let finishReason = null;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Mirror every token we stream so the finished answer can be logged. The
    // non-streaming /ai/chat writes to chatbot_log; this handler did not, so a
    // client on the streaming endpoint left no history behind — which also
    // starved this endpoint's own DB fallback for callers that send no history.
    let fullReply = "";
    const emitText = (text) => {
      if (!text) return;
      fullReply += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    };

    const finish = async (provider) => {
      if (studentId && fullReply.trim()) {
        try {
          const { error: insertError } = await supabase.from("chatbot_log").insert({
            student_id: studentId,
            question: message,
            answer: fullReply,
            timestamp: new Date().toISOString(),
          });
          if (insertError) {
            console.error("Failed to save streamed chatbot log:", insertError.message);
          }
        } catch (logErr) {
          console.error("Failed to save streamed chatbot log:", logErr.message);
        }
      }
      res.write(
        `data: ${JSON.stringify({
          metadata: {
            provider,
            isFallback: false,
            ragUsed,
            ragStatus,
            followUps,
            // False when the model stopped early, so the client can say the
            // answer was cut off instead of presenting it as finished.
            complete: finishReason === null || finishReason === "stop",
            finishReason,
            // Named so the client can show WHICH documents an answer rests on.
            // Without this the UI cannot tell a grounded answer from one the
            // model produced from general knowledge, and neither can the
            // student — on a screen whose subject is visa and work-permit law.
            //
            // Machine-generated curriculum payloads are excluded for the same
            // reason they are excluded from followUps above: the retrieval
            // query is expanded with the student's major and year, so they
            // match constantly regardless of topic. Citing one under a visa
            // answer would be a false provenance claim — the exact failure
            // this metadata exists to prevent.
            //
            // ragUsed is deliberately NOT derived from this filtered list.
            // Curriculum documents are real grounding for a course question,
            // and treating them as no grounding would put "confirm with
            // immigration" under correct course advice.
            ragSources: ragSources
              .filter((source) => !MACHINE_GENERATED_CATEGORIES.has(source.category))
              .map((source) => source.title),
          },
        })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    };

    /**
     * Streams from Gemini. Used as the primary provider when OpenRouter is
     * unconfigured, and as the fallback when it is configured but fails.
     */
    const streamFromGemini = async () => {
        let geminiMsg = message;
        if (academicPromptContext) {
          geminiMsg = `${academicPromptContext}\n${geminiMsg}`;
        }
        const stream = await generateGeminiChatStream(geminiMsg, userLangPref, context);
        let buffer = "";
        const decoder = new TextDecoder();

        for await (const chunk of stream) {
          buffer += decoder.decode(chunk, { stream: true });
          const textRegex = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
          let match;
          while ((match = textRegex.exec(buffer)) !== null) {
            const rawText = match[1];
            try {
              const cleanText = JSON.parse(`"${rawText}"`);
              emitText(cleanText);
            } catch {
              // ignore parsing error
            }
          }
          buffer = buffer.slice(-100);
        }

    };

    if (isOpenRouterConfigured()) {
      let augmentedMsg = "";
      if (academicPromptContext) {
        augmentedMsg += `${academicPromptContext}\n`;
      }
      if (context) {
        augmentedMsg += `PNU Knowledge Base Context:\n${context}\n\n`;
      }
      augmentedMsg += `User Question: ${message}`;

      let history = [];
      if (req.body.history && Array.isArray(req.body.history)) {
        history = req.body.history;
      } else if (studentId) {
        try {
          const { data: logs } = await supabase
            .from("chatbot_log")
            .select("*")
            .eq("student_id", studentId)
            .order("timestamp", { ascending: false })
            .limit(10);
          if (logs) {
            history = [...logs].reverse().map((log) => ({
              question: log.question,
              answer: log.answer,
            }));
          }
        } catch (histErr) {
          console.error("Failed to load history for OpenRouter stream:", histErr.message);
        }
      }

      // Falling back to Gemini has to be decided BEFORE any token is written,
      // because once the first chunk reaches the client we cannot un-send it
      // and start a second answer in the same bubble. generateOpenRouterChatStream
      // throws only while connecting — every model rejected, or none responded
      // within the connect timeout — so a throw here means nothing was emitted
      // and switching provider is safe.
      //
      // Without this, an OpenRouter key that is configured but out of credits
      // killed the chat outright even with a working GEMINI_API_KEY, because
      // the Gemini leg sat in the `else` of "is OpenRouter configured".
      let stream;
      try {
        stream = await generateOpenRouterChatStream(augmentedMsg, history);
      } catch (openRouterErr) {
        if (!isGeminiConfigured()) throw openRouterErr;
        console.error(
          "OpenRouter stream unavailable, falling back to Gemini:",
          openRouterErr.message,
        );
        await streamFromGemini();
        await finish("gemini-fallback");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            const rawJson = trimmed.slice(6);
            try {
              const parsed = JSON.parse(rawJson);
              emitText(parsed.choices?.[0]?.delta?.content || "");
              // OpenRouter reports why generation stopped. "length" means the
              // model hit max_tokens (1000 here) and the answer is cut off
              // mid-sentence. Nothing read this, so a half-finished sentence
              // was logged as the complete answer, replayed as history, and
              // given the full "Based on: …" badge — a truncated visa answer
              // reads as a confident one. Any reason other than "stop" leaves
              // the answer incomplete.
              const reason = parsed.choices?.[0]?.finish_reason;
              if (reason) finishReason = reason;
            } catch {
              // ignore partial line parsing issues
            }
          }
        }
      }

      if (buffer.trim().startsWith("data: ")) {
        const rawJson = buffer.trim().slice(6);
        try {
          const parsed = JSON.parse(rawJson);
          emitText(parsed.choices?.[0]?.delta?.content || "");
          const reason = parsed.choices?.[0]?.finish_reason;
          if (reason) finishReason = reason;
        } catch {}
      }

      await finish("openrouter");
    } else if (isGeminiConfigured()) {
      await streamFromGemini();
      await finish("gemini");
    }
  } catch (err) {
    console.error("AI Streaming error:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

async function getAllDocuments(req, res) {
  try {
    const { data, error } = await supabase
      .from("kb_document")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getDocument(req, res) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("kb_document")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({ success: false, message: "Document not found" });
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function createDocument(req, res) {
  try {
    const { category, title, content, target_country = 'ALL', target_gender = 'ALL' } = req.body;
    if (!category || !title || !content) {
      return res.status(400).json({ success: false, message: "Category, title, and content are required." });
    }

    const { data, error } = await supabase
      .from("kb_document")
      .insert({ category, title, content, target_country, target_gender })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Automatically sync vector chunks
    try {
      await ragService.syncDocument(data.id);
    } catch (syncErr) {
      console.error(`Auto-sync failed for document ${data.id}:`, syncErr.message);
      return res.json({ success: true, data, warning: "Document saved, but vector sync failed: " + syncErr.message });
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function updateDocument(req, res) {
  try {
    const { id } = req.params;
    const { category, title, content, target_country, target_gender } = req.body;

    const updates = {};
    if (category !== undefined) updates.category = category;
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (target_country !== undefined) updates.target_country = target_country;
    if (target_gender !== undefined) updates.target_gender = target_gender;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("kb_document")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    // Recalculate and sync vector chunks
    try {
      await ragService.syncDocument(id);
    } catch (syncErr) {
      console.error(`Auto-sync failed for document ${id}:`, syncErr.message);
      return res.json({ success: true, data, warning: "Document updated, but vector sync failed: " + syncErr.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function deleteDocument(req, res) {
  try {
    const { id } = req.params;

    // Delete chunks first (Supabase has cascade delete, but we do it manually for emulated/double safety)
    const { error: deleteChunksError } = await supabase
      .from("kb_chunk")
      .delete()
      .eq("document_id", id);

    if (deleteChunksError) {
      console.warn("Cascade delete chunks failed:", deleteChunksError.message);
    }

    const { error } = await supabase
      .from("kb_document")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }

    res.json({ success: true, message: "Document deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function syncDocumentVector(req, res) {
  try {
    const { id } = req.params;
    const result = await ragService.syncDocument(id);
    res.json({ success: true, message: `Successfully synced ${result.chunksCount} chunks.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

const { buildStudentDashboard } = require('../ai/studentDashboardEngine');
const { analyzeMajorGap } = require('../ai/gapAnalysisEngine');
const { recommendCourses } = require('../ai/courseRecommendationEngine');
const { recommendNotices } = require('../ai/noticeRecommendationEngine');
const { translateNotices } = require('../services/noticeTranslationService');
const { extractNoticeInfo } = require('../services/noticeExtractionService');
const { adaptStudentProfile } = require('../ai/studentProfileAdapter');
const {
  attachCourseCurriculum,
  fetchAllCourses,
  fetchCourseCurriculum,
  fetchStudentCourseHistory,
  fetchAllNotices,
  fetchDashboardCatalogs,
} = require('../ai/supabaseDataRepository');
const {
  collectUserTags,
  fetchRecommendedPrograms,
  fetchProgramDetail,
} = require('../services/extracurricularProgramService');
const {
  pilotCourses,
  pilotPrograms,
  pilotScholarships,
  pilotCareers,
  gapTargetMajors,
} = require('../ai/pilotCatalog');

function mergeReadableValues(...lists) {
  const values = [];
  const seen = new Set();

  for (const list of lists) {
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      const value = String(item || '').trim();
      const key = value.toLowerCase();
      if (value && !seen.has(key)) {
        seen.add(key);
        values.push(value);
      }
    }
  }

  return values;
}

async function fetchStudentContext(studentId) {
  const { data, error } = await supabase
    .from('student')
    .select(`
      *,
      major:major_id (
        major_name,
        department
      )
    `)
    .eq('student_id', studentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }

    const databaseError = new Error(
      `Failed to fetch student profile from Supabase: ${error.message}`
    );
    databaseError.statusCode = 502;
    databaseError.code = 'SUPABASE_STUDENT_QUERY_FAILED';
    databaseError.cause = error;
    throw databaseError;
  }

  if (!data) {
    return null;
  }

  const questionnaire = data.questionnaire || {};
  const interests = mergeReadableValues(
    data.interests,
    data.interest_tags,
    questionnaire.interests
  );
  const languages = mergeReadableValues(
    data.languages,
    data.language_pref ? [data.language_pref] : []
  );

  return {
    rawStudentInput: {
      questionnaire: {
        academicAreas: questionnaire.academicAreas || [],
        activities: questionnaire.activities || [],
        strengths: questionnaire.strengths || [],
        careerAreas: questionnaire.careerAreas || [],
        learningStyles: questionnaire.learningStyles || [],
        topikLevel: questionnaire.topikLevel ?? data.topik_level ?? null,
        topN: questionnaire.topN ?? 3,
      },
      profile: {
  major: data.major?.major_name ?? null,
  majorId: data.major_id ?? data.major?.major_id ?? data.major?.id ?? null,
  interests,
  interestTags: interests,
  languages,
  academicAreas: data.academic_areas || [],
  activities: data.activities || [],
  strengths: data.strengths || [],
  careerAreas: data.career_areas || [],
  learningStyles: data.learning_styles || [],
  gpa: data.gpa ?? null,
  nationality: data.nationality ?? null,
  year: data.year ?? data.grade ?? null,
  mbti: data.mbti ?? null,
  topikLevel: data.topik_level ?? questionnaire.topikLevel ?? null,
},
completedCourseIds:
  data.completed_course_ids ||
  data.completed_courses ||
  [],
    },
  };
}

function resolveTargetMajor(targetMajorId) {
  if (!targetMajorId) {
    return null;
  }

  return gapTargetMajors[targetMajorId] || null;
}


async function getDashboardSummary(req, res, next) {
  try {
    const studentId = req.user.student_id;
    const { targetMajorId } = req.query;

    const context = await fetchStudentContext(studentId);
    if (!context) {
      const err = new Error('Student profile not found');
      err.statusCode = 404;
      return next(err);
    }

    const targetMajor = resolveTargetMajor(targetMajorId);
    if (targetMajorId && !targetMajor) {
      return res.status(400).json({
        success: false,
        message: 'Invalid targetMajorId. Use a valid department id such as artificial-intelligence.',
      });
    }

    const catalogs = await fetchDashboardCatalogs(supabase, { language: req.language || 'en' });
    const dashboard = buildStudentDashboard({
      rawStudentInput: context.rawStudentInput,
      targetMajor,
      majors: catalogs.majors,
      courses: catalogs.courses,
      programs: catalogs.programs,
      scholarships: catalogs.scholarships,
      careers: pilotCareers,
      notices: catalogs.notices,
    });

    return res.status(200).json({
      success: true,
      data: dashboard,
      metadata: catalogs.metadata,
    });
  } catch (err) {
    next(err);
  }
}

async function runMajorGapAnalysis(req, res, next) {
  try {
    const { targetMajorId } = req.body || {};

    if (!targetMajorId) {
      return res.status(400).json({
        success: false,
        message: 'targetMajorId is required.',
      });
    }

    const targetMajor = resolveTargetMajor(targetMajorId);
    if (!targetMajor) {
      return res.status(400).json({
        success: false,
        message: 'Invalid targetMajorId. Use a valid department id such as artificial-intelligence.',
      });
    }

    const context = await fetchStudentContext(req.user.student_id);
    if (!context) {
      const err = new Error('Student profile not found');
      err.statusCode = 404;
      return next(err);
    }

    const adaptedProfile = adaptStudentProfile(context.rawStudentInput);
    const analysis = analyzeMajorGap(
      adaptedProfile.recommendationProfile,
      targetMajor
    );

    return res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (err) {
    next(err);
  }
}

async function getCourseRecommendations(req, res, next) {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? requestedLimit
        : 20;

    const context = await fetchStudentContext(req.user.student_id);
    if (!context) {
      const err = new Error('Student profile not found');
      err.statusCode = 404;
      return next(err);
    }

    const courseOptions = { language: req.language || 'en' };
    const requestedAcademicYear = Number(req.query.academicYear);
    const requestedSemester = String(req.query.semester || '').trim();
    const hasRequestedTerm = Number.isInteger(requestedAcademicYear)
      && ['1', '2', 'SUMMER', 'WINTER'].includes(requestedSemester);
    if (hasRequestedTerm) {
      courseOptions.includeOfferings = true;
      courseOptions.offeringAcademicYear = requestedAcademicYear;
      courseOptions.offeringSemester = requestedSemester;
      courseOptions.offeringSection = null;
    } else if (String(process.env.ENABLE_COURSE_OFFERINGS).toLowerCase() === 'true') {
      courseOptions.includeOfferings = true;
      courseOptions.offeringAcademicYear =
        process.env.COURSE_OFFERING_ACADEMIC_YEAR ?? null;
      courseOptions.offeringSemester = process.env.COURSE_OFFERING_SEMESTER ?? null;
      courseOptions.offeringSection = process.env.COURSE_OFFERING_SECTION ?? null;
    }
    const adaptedProfile = adaptStudentProfile(context.rawStudentInput);
    const preferredCurriculumYear = /^\d{4}/.test(String(req.user.student_id))
      ? Number(String(req.user.student_id).slice(0, 4))
      : undefined;
    const [loadedCourseCatalog, enrollmentHistory, curriculumRows] = await Promise.all([
      fetchAllCourses(supabase, courseOptions),
      fetchStudentCourseHistory(supabase, req.user.student_id),
      adaptedProfile.recommendationProfile.majorId
        ? fetchCourseCurriculum(supabase, {
          majorId: adaptedProfile.recommendationProfile.majorId,
        })
        : Promise.resolve([]),
    ]);
    const baseCourseCatalog = req.query.offeredOnly === 'true' && hasRequestedTerm
      ? loadedCourseCatalog.filter((course) => course.isOfferedThisTerm === true)
      : loadedCourseCatalog;
    const courseCatalog = attachCourseCurriculum(baseCourseCatalog, curriculumRows, {
      curriculumYear: preferredCurriculumYear,
    });
    const recommendations = recommendCourses(
      adaptedProfile.recommendationProfile,
      courseCatalog,
      {
        completedCourseIds: adaptedProfile.completedCourseIds,
        enrollmentHistory,
        limit,
      }
    );

    return res.status(200).json({
      success: true,
      data: recommendations,
      metadata: {
        source: 'supabase',
        courses: courseCatalog.length > 0 ? 'loaded' : 'empty',
      },
    });
  } catch (err) {
    next(err);
  }
}

function mapRecommendedScholarship(scholarship) {
  return {
    id: String(scholarship.id),
    title: scholarship.title,
    description: scholarship.description ?? "",
    deadline: scholarship.deadline ?? "",
    eligibility: scholarship.eligibility ?? scholarship.provider ?? "",
    amount: scholarship.amount ?? null,
    provider: scholarship.provider ?? null,
    sourceUrl: scholarship.sourceUrl ?? null,
    score: scholarship.score,
    matchHint: scholarship.matchHint,
  };
}

function mapRecommendedProgram(program) {
  return {
    id: String(program.id),
    title: program.title,
    description: program.description ?? "",
    date: program.date ?? "",
    category: program.category ?? null,
    sourceUrl: program.sourceUrl ?? null,
    score: program.score,
    matchHint: program.matchHint,
  };
}

async function getAiDashboard(req, res, next) {
  try {
    const language = req.language || "en";
    const context = await fetchStudentContext(req.user.student_id);
    if (!context) {
      const err = new Error("Student profile not found");
      err.statusCode = 404;
      return next(err);
    }

    const catalogs = await fetchDashboardCatalogs(supabase, { language });
    const dashboard = buildStudentDashboard({
      rawStudentInput: context.rawStudentInput,
      targetMajor: null,
      majors: catalogs.majors,
      courses: catalogs.courses,
      programs: catalogs.programs,
      scholarships: catalogs.scholarships,
      careers: pilotCareers,
      notices: catalogs.notices,
      options: {
        courseLimit: 20,
        programLimit: 20,
        scholarshipLimit: 20,
      },
    });

    const scholarshipRows = catalogs.scholarships;
    const localizedScholarships = new Map(
      scholarshipRows.map((row) => [
        String(row.id),
        row,
      ]),
    );

    const eligibleScholarships = dashboard.recommendedScholarships
      .map(mapRecommendedScholarship)
      .map((item) => {
        const localized = localizedScholarships.get(item.id);
        if (!localized) return item;
        return {
          ...item,
          title: localized.title ?? item.title,
          description: localized.description ?? item.description,
          eligibility: localized.eligibility ?? item.eligibility,
        };
      });

    let matchedPrograms = [];
    try {
      matchedPrograms = await fetchRecommendedPrograms({
        studentProfile: context.rawStudentInput.profile || {},
        userTags: context.rawStudentInput.profile.interests || [],
        limit: 20,
        language,
      });
    } catch (programErr) {
      console.warn(
        "[extracurricular] failed to load programs for dashboard:",
        programErr.message,
      );
      matchedPrograms = [];
    }

    return res.status(200).json({
      success: true,
      data: {
        recommendedCourses: dashboard.recommendedCourses,
        eligibleScholarships,
        matchedPrograms: matchedPrograms.map(mapRecommendedProgram),
      },
      metadata: catalogs.metadata,
    });
  } catch (err) {
    next(err);
  }
}

async function getStudentNotifications(req, res, next) {
  try {
    res.set("Cache-Control", "no-store");

    const language = req.language || "en";
    const studentId = req.user.student_id;
    const context = await fetchStudentContext(studentId);

    if (!context) {
      const err = new Error("Student profile not found");
      err.statusCode = 404;
      return next(err);
    }

    const { data: studentGradeRow } = await supabase
      .from("student")
      .select("grade")
      .eq("student_id", studentId)
      .maybeSingle();

    const checklistPayload = await getChecklistForStudent(
      supabase,
      studentId,
      normalizeGrade(studentGradeRow?.grade),
    );

    const checklistNotifications = (checklistPayload.items || [])
      .filter(
        (item) => String(item.status ?? "").toLowerCase() !== "completed",
      )
      .map((item) => {
        const localized = localizeRow(item, language, [
          "title",
          "description",
          "task_name",
        ]);
        return {
          id: `checklist-${item.checklist_id}`,
          kind: "CHECKLIST",
          title:
            localized.title ??
            localized.task_name ??
            item.title ??
            "Checklist item",
          body: localized.description ?? item.description ?? "",
          date: item.due_date ?? item.updated_at ?? item.created_at ?? null,
          dueDate: item.due_date ?? null,
          updatedAt: item.updated_at ?? item.created_at ?? null,
          status: item.status ?? null,
        };
      });

    const notices = await fetchAllNotices(supabase, { language });
    const adaptedProfile = adaptStudentProfile(context.rawStudentInput);
    const recommendedNotices = recommendNotices(
      adaptedProfile.recommendationProfile,
      notices,
      { limit: 10 }
    );

    const noticeBase = recommendedNotices.map((notice) => ({
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
      source: notice.source,
      sourceUrl: notice.sourceUrl,
      score: notice.score,
      matchHint: notice.matchHint,
    }));
    // Independent AI calls — extraction reads original Korean text
    // regardless of the requested display language, so it doesn't need to
    // wait on translation to finish.
    const [translatedNoticeNotifications, extractedNoticeInfo] = await Promise.all([
      translateNotices(noticeBase, language),
      extractNoticeInfo(noticeBase),
    ]);
    const noticeNotifications = translatedNoticeNotifications.map((notice, index) => {
      const deadline = notice.deadline || extractedNoticeInfo[index]?.deadline || null;
      return {
        ...notice,
        deadline,
        eligibility: extractedNoticeInfo[index]?.eligibility ?? null,
        requiredDocuments: extractedNoticeInfo[index]?.requiredDocuments ?? [],
        date: deadline || notice.postedDate || null,
      };
    });

    const orderedChecklistNotifications = checklistNotifications.sort(
      (a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : Number.NaN;
        const bTime = b.date ? new Date(b.date).getTime() : Number.NaN;
        const timeDifference =
          (Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime) -
          (Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime);

        if (timeDifference !== 0) return timeDifference;
        return String(a.id).localeCompare(String(b.id));
      },
    );

    // Ordering contract: AI-ranked NOTICE items remain in recommendation
    // order. CHECKLIST items follow, ordered by due date and then stable ID.
    const notifications = [
      ...noticeNotifications,
      ...orderedChecklistNotifications,
    ];

    return res.status(200).json({
      success: true,
      data: notifications,
      metadata: {
        source: "supabase",
        notices: notices.length > 0 ? "loaded" : "empty",
        ordering: "NOTICE_RECOMMENDATION_RANK_THEN_CHECKLIST_DUE_DATE",
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getPrograms(req, res, next) {
  try {
    const language = req.language || req.lang || "en";
    const context = await fetchStudentContext(req.user.student_id);
    if (!context) {
      const err = new Error("Student profile not found");
      err.statusCode = 404;
      return next(err);
    }

    const programs = await fetchRecommendedPrograms({
      studentProfile: context.rawStudentInput.profile || {},
      userTags: context.rawStudentInput.profile.interests || [],
      limit: 200,
      language,
    });

    return res.status(200).json({
      success: true,
      data: programs.map(mapRecommendedProgram),
    });
  } catch (err) {
    next(err);
  }
}

async function getProgramDetail(req, res, next) {
  try {
    const { programId } = req.params;
    const language = req.language || req.lang || "en";
    const context = await fetchStudentContext(req.user.student_id);
    if (!context) {
      const err = new Error("Student profile not found");
      err.statusCode = 404;
      return next(err);
    }

    const program = await fetchProgramDetail({
      programId,
      studentProfile: context.rawStudentInput.profile || {},
      userTags: context.rawStudentInput.profile.interests || [],
      language,
    });

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Program not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: mapRecommendedProgram(program),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  recommendMajor,
  handleChat,
  handleChatStream,
  getChatHistory,
  clearChatHistory,
  translateAnnouncement,
  getAllDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  syncDocumentVector,
  getDashboardSummary,
  runMajorGapAnalysis,
  getCourseRecommendations,
  getAiDashboard,
  getPrograms,
  getProgramDetail,
  getStudentNotifications,
  fetchStudentContext,
};

