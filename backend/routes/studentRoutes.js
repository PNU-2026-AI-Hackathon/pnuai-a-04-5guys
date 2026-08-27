const express = require("express");
const {
  getAllMajors,
  testConnection,
  loginStudent,
  verifyLoginStudent,
  signupStudent,
  verifySignupStudent,
  completeSignupStudent,
  forgotPassword,
  resetPassword,
  getStudentChecklist,
  updateChecklistItem,
  getAllScholarships,
  applyForScholarship,
  getStudentProfile,
  updateStudentProfile,
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
  getGraduationProgress,
  updateGraduationRequirement,
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
  requestStudentDeletion,
  hardDeleteStudent,
  getAllStudents,
  submitFeedback,
  subscribeToPush,
  unsubscribeFromPush,
  getPushConfig,
  sendTestPush,
  getCareerOpportunities,
  getCareerRecommendations,
  getMyCommunityGroupHandler,
  getCommunityPostsHandler,
  createCommunityPostHandler,
  likeCommunityPostHandler,
  deleteCommunityPostHandler,
  getEmergencyGuideHandler,
  getCampusFacilitiesHandler,
} = require("../controllers/studentController");

const { authenticateToken, requireAdmin } = require("../middlewares/auth");

const {
  createPostSchema,
  createCommentSchema,
  updateProfileSchema,
  validateBody,
} = require("../validators/studentValidator");

const {
  getDashboardSummary,
  runMajorGapAnalysis,
  getCourseRecommendations,
  getAiDashboard,
  getPrograms,
  getProgramDetail,
  getStudentNotifications,
} = require("../controllers/aiController");

const {
  createTimetableEntry,
  getCourseCatalog,
  getTimetable,
  removeTimetableByCourse,
  removeTimetableEntry,
} = require("../controllers/courseController");

const router = express.Router();

// Public routes
router.get("/test", testConnection);
router.post("/login", loginStudent);
router.post("/verify-login", verifyLoginStudent);
router.post("/signup", signupStudent);
router.post("/verify-signup", verifySignupStudent);
router.post("/complete-signup", completeSignupStudent);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/boards", getAllBoards);
router.get("/boards/:board_id/posts", getBoardPosts);
router.get("/posts/:post_id/comments", getPostComments);
router.get("/facilities", getFacilities);
router.get("/facilities/:facility_id", getFacilityById);
router.get("/pnu-contacts", getPnuContacts);
router.get("/faq", getFaqItems);
router.get("/notices", getNotices);
router.get("/search", globalSearch);
router.get("/health-check", healthCheck);
router.get("/majors", getAllMajors);
router.get("/scholarships", getAllScholarships);
router.get("/career-opportunities", getCareerOpportunities);
router.get("/career-recommendations", authenticateToken, getCareerRecommendations);
router.get("/community/posts", authenticateToken, getCommunityPostsHandler);
router.get("/emergency-guide", authenticateToken, getEmergencyGuideHandler);
router.get("/campus-facilities", getCampusFacilitiesHandler);
router.get("/courses", getCourses);

// Protected / named routes (before /:student_id)
router.get("/", authenticateToken, requireAdmin, getAllStudents);
router.post("/feedback", authenticateToken, submitFeedback);
router.get("/push/config", getPushConfig);
router.post("/push/subscribe", authenticateToken, subscribeToPush);
router.post("/push/unsubscribe", authenticateToken, unsubscribeFromPush);
router.post("/push/test", authenticateToken, sendTestPush);
router.post(
  "/notices/sync",
  authenticateToken,
  requireAdmin,
  syncNotices,
);
router.get("/checklist/:student_id", authenticateToken, getStudentChecklist);
router.put("/checklist/:checklist_id", authenticateToken, updateChecklistItem);
router.get("/notifications/:student_id", authenticateToken, getNotifications);
router.get("/notifications", authenticateToken, getStudentNotifications);
router.get("/ai-dashboard", authenticateToken, getAiDashboard);
router.get("/programs", authenticateToken, getPrograms);
router.get("/programs/:programId", authenticateToken, getProgramDetail);
router.put(
  "/profile",
  authenticateToken,
  validateBody(updateProfileSchema),
  updateStudentProfile,
);
router.get("/enrollments/:student_id", authenticateToken, getEnrollments);
router.post("/enrollments", authenticateToken, createEnrollment);
router.patch("/enrollments/:enrollment_id", authenticateToken, updateEnrollment);
router.delete("/enrollments/:enrollment_id", authenticateToken, deleteEnrollment);
router.post("/scholarships/apply", authenticateToken, applyForScholarship);
router.get("/dashboard-summary", authenticateToken, getDashboardSummary);
router.post("/major-gap-analysis", authenticateToken, runMajorGapAnalysis);
router.get("/course-recommendations", authenticateToken, getCourseRecommendations);
router.get("/course-catalog", authenticateToken, getCourseCatalog);
router.get("/timetable", authenticateToken, getTimetable);
router.post("/timetable", authenticateToken, createTimetableEntry);
router.delete(
  "/timetable/course/:course_id",
  authenticateToken,
  removeTimetableByCourse,
);
router.delete(
  "/timetable/:timetable_entry_id",
  authenticateToken,
  removeTimetableEntry,
);
router.get(
  "/academic-records/:student_id",
  authenticateToken,
  getAcademicRecords,
);
router.get(
  "/graduation-progress/:student_id",
  authenticateToken,
  getGraduationProgress,
);
router.get(
  "/graduation-progress",
  authenticateToken,
  getGraduationProgress,
);
router.put(
  "/graduation-requirement/:requirement_id",
  authenticateToken,
  updateGraduationRequirement,
);

router.post("/posts", authenticateToken, validateBody(createPostSchema), createPost);
router.get("/community/my-group", authenticateToken, getMyCommunityGroupHandler);
router.post("/community/posts", authenticateToken, createCommunityPostHandler);
router.post(
  "/community/posts/:postId/like",
  authenticateToken,
  likeCommunityPostHandler,
);
router.delete(
  "/community/posts/:postId",
  authenticateToken,
  deleteCommunityPostHandler,
);
router.post("/posts/:post_id/like", authenticateToken, likePost);
router.post("/posts/:post_id/report", authenticateToken, reportPost);
router.post("/comments", authenticateToken, validateBody(createCommentSchema), createComment);
router.post("/posts/:post_id/comments", authenticateToken, validateBody(createCommentSchema), createComment);

// Parametric student routes last
router.get("/:student_id", authenticateToken, getStudentProfile);
router.patch("/:student_id", authenticateToken, updateStudentProfile);
router.patch("/:student_id/request-delete", authenticateToken, requestStudentDeletion);
router.patch("/:student_id/language", authenticateToken, updateLanguagePreference);
router.delete("/:student_id", authenticateToken, requireAdmin, hardDeleteStudent);

module.exports = router;
