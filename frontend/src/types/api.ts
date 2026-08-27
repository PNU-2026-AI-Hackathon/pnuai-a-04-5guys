/** Shared API types — keep in sync with backend OpenAPI / PROJECT_SPEC.md */

export type CourseType = '전공' | '효원핵심교양' | '효원균형교양' | '효원창의교양' | '일반선택' | '교직과목' | '전공기초' | '전공필수' | '전공선택'
export type CourseLanguageFilter = 'ALL' | 'ENGLISH' | 'KOREAN' | 'MIXED' | 'OTHER' | 'UNKNOWN'
export type CourseSortKey = 'RELEVANCE' | 'NAME' | 'CREDITS' | 'CODE'
export type SortDirection = 'ASC' | 'DESC'

export type NotificationCategory = string
export type NotificationPriority = string
export type NotificationKind = 'NOTICE' | 'CHECKLIST' | 'SCHOLARSHIP'
export type NoticeChannel = 'department' | 'international' | 'general' | 'scholarship'

export interface User {
  studentId: string
  name: string
  nationality: string
  major: string
  interests: string[]
  studentType?: "Freshman" | "Current"
  /** Academic year: 1–4, or 0 for exchange student. */
  grade?: number | null
  visaStatus?: string
  language_pref?: string
  email?: string
  phone?: string
  completed_courses?: string[]
  deletion_requested?: boolean
  intake_term?: "March" | "September"
}

export interface AuthResponse {
  token: string
  user: User
}

export interface LoginRequest {
  email: string
  password: string
}

export interface SignupRequest {
  email: string
  password: string
  languagePref?: string
}

export interface LoginChallengeResponse {
  challengeId: string
  maskedEmail: string
}

export interface SignupVerifyResponse {
  signupToken: string
}

export interface CompleteSignupRequest {
  signupToken: string
  major: string
  year: 1 | 2 | 3 | 4 | 'exchange' | string
  nationality: string
  languagePref?: string
}

export interface VerifyLoginRequest {
  challengeId: string
  code: string
}

export interface MajorRecommendationRequest {
  academicAreas: string[];
  activities: string[];
  strengths: string[];
  careerAreas: string[];
  learningStyles: string[];
  topikLevel: number;
  topN?: number;
}

export interface StudentProfile {
  student_id: string
  name: string
  nationality: string
  major_id?: number
  major?: string
  department?: string
  student_type: 'Freshman' | 'Transfer' | 'Exchange' | 'Current'
  visa_status: string
  language_pref: string
  is_in_korea: boolean
  mbti?: string
  d2_semester?: number
  completed_courses?: string[]
  intake_term?: string
}

export interface MajorData {
  major_id: number;
  major_name: string;
  department: string;
}

export interface UpdateProfileRequest {
  name: string
  nationality: string
  major: string
  interests: string[]
  languagePref?: string
  visaStatus?: string
  mbti?: string
  phone?: string
  email?: string
  completed_courses?: string[]
  intake_term?: "March" | "September"
  /** 1–4 or 'exchange' (stored as grade 0). */
  year?: 1 | 2 | 3 | 4 | 'exchange' | number | string
  grade?: number | null
  current_password?: string
  new_password?: string
}

export interface ProgramItem {
  id: string
  title: string
  description: string
  date: string
  category?: string
  sourceUrl?: string | null
  score?: number
  matchHint?: string
}

export type ScholarshipCategory = 'department' | 'international' | 'government' | 'other'

export interface ScholarshipItem {
  id: string
  title: string
  deadline: string
  description: string
  eligibility: string
  amount?: string | null
  provider?: string | null
  category?: ScholarshipCategory | null
  tag?: string | null
  deadlineAt?: string | null
  sourceUrl?: string | null
}

export interface EmergencyQuickAccess {
  number: string
  label: string
}

export interface EmergencyContact {
  id: string
  type: string
  name: string
  phone: string | null
  country?: string | null
  country_flag?: string | null
  distance?: string | null
  map_query?: string | null
}

export interface VisaOfficeContact {
  name: string
  unit?: string | null
  phone?: string | null
  address?: string | null
}

export interface EmergencyGuide {
  quick_access: {
    police: EmergencyQuickAccess
    fire_medical: EmergencyQuickAccess
    disease_control: EmergencyQuickAccess
  }
  database_contacts: EmergencyContact[]
  guide_text: string
  visa_offices?: VisaOfficeContact[]
  jeonse_fraud_prevention?: {
    notice?: string | null
  }
}

export interface PnuContact {
  id: string
  name: string
  place: string
  hours: string
  phone: string
  email: string | null
}

export interface FaqItem {
  id: string
  question: string
  answer: string
}

export type CommunityScope = 'department' | 'country' | 'all'

export interface CommunityGroup {
  id: string
  groupId: number
  slug: string
  scope: CommunityScope
  name: string
  icon: string
}

export interface CommunityPost {
  id: string
  groupId: number | null
  groupSlug: string | null
  scope: CommunityScope
  content: string
  hashtags: string[]
  likes: number
  comments: number
  createdAt: string
  authorStudentId: string
  authorName: string
  authorInitials: string
  authorMajor: string
  majorTone: string
  authorNationality: string
  timeAgo: string
  eventDate?: {
    month: string
    day: string
    weekday: string
  } | null
}

export interface CreateCommunityPostRequest {
  content: string
  scope: CommunityScope
  groupId?: number | null
  groupSlug?: string | null
}

export interface CafeteriaMenuOption {
  price?: string | null
  items: string[]
}

export interface CafeteriaMenuColumn {
  day: string
  day_label: string
  /** First option price — kept for backward compatibility with older payloads */
  price?: string | null
  /** First option items — kept for backward compatibility with older payloads */
  items: string[]
  /** All menu options in the cell (정식, 일품, …). Prefer this when present. */
  options?: CafeteriaMenuOption[]
  note?: string | null
}

export interface CafeteriaMenuRow {
  meal_type: string
  meal_label: string
  columns: CafeteriaMenuColumn[]
}

export interface CafeteriaMenu {
  week_start?: string | null
  week_end?: string | null
  week_label?: string | null
  prev_menu_date?: string | null
  next_menu_date?: string | null
  rows: CafeteriaMenuRow[]
}

export interface GetCampusFacilitiesParams {
  menuDate?: string
}

export interface CampusFacility {
  id: string
  name: string
  location?: string | null
  hours?: string | null
  description?: string | null
  menu?: CafeteriaMenu
}

export interface CampusFacilities {
  shuttle_bus_metadata: {
    key_stops: CampusFacility[]
  }
  cafeterias: CampusFacility[]
  cafeteria_source?: string
  scraped_at?: string | null
  menu_date?: string | null
}

export interface MapFacility {
  id: string
  name: string
  nameKo?: string | null
  buildingNumber?: string | null
  type: string
  latitude: number
  longitude: number
  phone?: string | null
  website?: string | null
  image?: string | null
  departments?: FacilityRoom[]
  amenities?: FacilityRoom[]
}

export interface FacilityRoom {
  name: string
  floor: string
}

export interface AcademicSemesterRecord {
  semesterLabel: string
  gpa: number
}

export interface AcademicRecords {
  studentId: string
  overallGpa: number
  gpaScale: number
  standing: string
  completedCredits: number
  requiredCredits: number
  semesters: AcademicSemesterRecord[]
}

export interface AiDashboard {
  recommendedCourses: RecommendedCourse[]
  eligibleScholarships: ScholarshipItem[]
  matchedPrograms: ProgramItem[]
}

export interface Course {
  id: string
  nameKo: string
  nameEn: string
  type: CourseType
  credits: number
  department: string
  tags: string[]
  majorId?: string | null
  majorName?: string | null
  collegeId?: number | null
  recommendedYear?: number | null
  isInStudentMajor?: boolean | null
}

export type OriginalLanguageCode = 'E' | 'C' | 'J' | 'F' | 'G' | 'R'
export type TeachingLanguage = 'KOREAN' | 'ENGLISH' | 'MIXED' | 'OTHER'
export type RemoteCourseStatus = 'REMOTE' | 'NOT_REMOTE' | 'MIXED' | 'OTHER'
export type CourseMetadataRequirement = 'REQUIRED' | 'OPTIONAL' | 'NONE'

export interface CourseOfferingInformation {
  officialCourseNumber: string | null
  academicYear: number | null
  semester: string | null
  section: string | null
  professor: string | null
  schedule: string | null
  remoteCourseStatus: RemoteCourseStatus | null
  isOfferedThisTerm: boolean | null
  originalLanguageCode: OriginalLanguageCode | null
  teachingLanguage: TeachingLanguage | null
  isEnglishTaught: boolean | null
  theoryHours: number | null
  practicalHours: number | null
  presentationRequirement: CourseMetadataRequirement | null
  groupProjectRequirement: CourseMetadataRequirement | null
  assignmentRequirement: CourseMetadataRequirement | null
  examInformation: string | null
}

export interface RecommendedCourse
  extends Omit<Course, 'section' | 'professor'>, CourseOfferingInformation {
  score: number
  matchHint?: string
}

export interface CourseCurriculumInformation {
  curriculumYear: number
  sourceCourseCode: string | null
  category: CourseType | null
  recommendedYear: number | null
  gradeSemester: string | null
  sourceDepartment: string | null
}

export interface CourseOfferingOption {
  courseOfferingId: number
  officialCourseNumber: string | null
  academicYear: number
  semester: string
  section: string | null
  professor: string | null
  schedule: string | null
  classroom: string | null
  teachingLanguage: TeachingLanguage | null
  remoteCourseStatus: RemoteCourseStatus | null
  enrollmentLimit: number | null
  teamTeachingStatus: 'TEAM_TAUGHT' | 'NOT_TEAM_TAUGHT' | null
  generalEducationArea: string | null
  remarks: string | null
  restrictions: CourseOfferingRestriction[]
  slots: TimetableSlotInput[]
  presentationRequirement: CourseMetadataRequirement | null
  groupProjectRequirement: CourseMetadataRequirement | null
  assignmentRequirement: CourseMetadataRequirement | null
  examInformation: string | null
}

export interface CourseOfferingRestriction {
  id: number
  kind: 'RESTRICTION' | 'EXCEPTION'
  ruleType: string | null
  permission: 'ALLOWED' | 'PROHIBITED' | null
  departmentCondition: string | null
  yearLevelCondition: string | null
  domesticForeignCondition: string | null
  nationalityCondition: string | null
  curriculumYearCondition: string | null
  completedSemestersCondition: string | null
  academicStatusCondition: string | null
  degreeProgramCondition: string | null
  reason: string | null
  exceptionText: string | null
}

export interface CoursePrerequisite {
  id: number
  courseId: number | null
  officialCourseNumber: string | null
  nameKo: string | null
  nameEn: string | null
  requirementText: string | null
  sourceUrl: string | null
  sourceKind: 'PNU_CATALOG' | 'PNU_CURRICULUM' | 'PNU_SYLLABUS'
}

export interface CourseCatalogItem extends RecommendedCourse {
  curriculumYears: number[]
  curriculum: CourseCurriculumInformation | null
  descriptionKo: string | null
  descriptionEn: string | null
  descriptionSourceUrl: string | null
  syllabusUrl: string | null
  detailSourceKind: 'PNU_CATALOG' | 'PNU_CURRICULUM' | 'PNU_SYLLABUS' | null
  prerequisites: CoursePrerequisite[]
  courseOfferingId: number | null
  officialCourseNumber: string | null
  academicYear: number
  semester: string
  enrollmentLimit: number | null
  restrictions: CourseOfferingRestriction[]
  slots: TimetableSlotInput[]
  offerings: CourseOfferingOption[]
}

export interface CourseCatalogPage {
  items: CourseCatalogItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export interface CourseCatalogParams {
  page?: number
  pageSize?: number
  search?: string
  myMajor?: boolean
  majorId?: number
  category?: CourseType | 'ALL'
  recommendedYear?: number
  curriculumYear?: number
  academicYear?: number
  semester?: '1' | '2' | 'SUMMER' | 'WINTER'
  courseId?: string | number
  languageFilter?: CourseLanguageFilter
  sortBy?: Exclude<CourseSortKey, 'RELEVANCE'>
  sortDirection?: SortDirection
}

export interface RecommendedMajor {
  id: string;
  name: string;
  nameKo: string;
  score: number;
  rank: number;
  reason: string;
  eligibilityNote: string;
  claudeReason: string | null;
}

export interface AiAnalysis {
  summary: string;
  gapAnalysis: string[];
}

export interface MajorRecommendationResponse {
  success: boolean;
  recommendationMethod: string;
  recommendations: RecommendedMajor[];
  aiAnalysis: AiAnalysis | null;
  warning: string | null;
}

export interface CreditBreakdown {
  completed: number
  required: number
}

export interface Enrollment {
  enrollment_id: number;
  student_id: string;
  course_id: number;
  semester: string;
  status: string;
  course_name?: string;
  credit?: number;
  category?: string;
  classroom?: string;
  course_name_en?: string | null;
  course_name_ko?: string | null;
  official_course_number?: string | null;
  /** Canonical catalog row used for details when a legacy enrollment was matched by exact name. */
  catalog_course_id?: number | null;
  professor?: string | null;
  schedule?: string | null;
  day_of_week?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  final_grade?: string | null;
  credits_earned?: number | null;
}

export interface TimetableSlotInput {
  day: number
  start: string
  end: string
  classroom?: string | null
}

export interface TimetableSlot extends TimetableSlotInput {
  slotId: number
}

export interface TimetableEntry {
  timetableEntryId: number
  enrollment_id: number
  student_id: string
  course_id: number
  courseOfferingId: number | null
  academicYear: number
  semester: string
  status: 'Planned'
  source: 'OFFERING' | 'MANUAL'
  color: string | null
  course_name: string
  courseNameEn: string | null
  officialCourseNumber: string | null
  credit: number
  category: string
  professor: string | null
  section: string | null
  classroom?: string | null
  slots: TimetableSlot[]
}

export interface CreateTimetableEntryInput {
  courseId: number
  courseOfferingId?: number | null
  academicYear: number
  semester: '1' | '2' | 'SUMMER' | 'WINTER'
  color?: string | null
  slots?: TimetableSlotInput[]
}

export interface GradeSummary {
  hasCompletedCoursework: boolean
  overallGpa: number | null
  majorGpa: number | null
  gpaScale: number
  averageLetter: string | null
  semesterCredits: number
  standing: string | null
}

export interface GraduationRequirementItem {
  id: string
  title: string
  description: string
  completed: boolean
  requirementType?: string
  requirementCode?: string
  targetValue?: number
}

export interface GraduationProgress {
  totalRequired: number
  totalCompleted: number
  breakdown: {
    /** 교양필수 – General Required */
    generalRequired: CreditBreakdown
    /** 교양선택 – General Elective */
    generalElective: CreditBreakdown
    /** 전공기초 – Major Basic */
    majorBasic: CreditBreakdown
    /** 전공필수 – Major Required */
    majorRequired: CreditBreakdown
    /** 전공선택 – Major Elective */
    majorElective: CreditBreakdown
    /** 일반선택 – General Free Elective */
    generalFree: CreditBreakdown
  }
  gradeSummary?: GradeSummary
  /** Department milestones from `graduation_requirement` (not checklist_item). */
  requirements?: GraduationRequirementItem[]
}

export interface Notification {
  id: string
  /** Missing only on legacy local-storage snapshots created before Notice AI. */
  kind?: NotificationKind
  title: string
  body: string
  /** Compatibility display date; real date semantics remain separate below. */
  date?: string | null
  postedDate?: string | null
  deadline?: string | null
  dueDate?: string | null
  updatedAt?: string | null
  languages?: string[]
  category?: NotificationCategory | null
  priority?: NotificationPriority | null
  source?: string | null
  channel?: NoticeChannel | null
  /** External original post URL when scraped from a PNU board */
  sourceUrl?: string | null
  originalTitle?: string | null
  originalBody?: string | null
  translationLanguage?: string | null
  score?: number | null
  matchHint?: string | null
  status?: string | null
  read?: boolean
  /** AI-extracted from the notice text; null/[] when the notice doesn't state it. */
  eligibility?: string | null
  requiredDocuments?: string[]
}

export interface CreditRequirement {
  /** Which breakdown bucket must meet the threshold */
  category: keyof GraduationProgress['breakdown'] | 'total'
}

export interface ChecklistItem {
  id: string
  title: string
  description: string
  completed: boolean
  /** If set, item is locked until the credit requirement is met */
  creditRequirement?: CreditRequirement
}

export type ChecklistVariant = 'NEW_STUDENT' | 'GRADUATION_REQUIREMENT'

export interface ChecklistPayload {
  variant: ChecklistVariant
  items: ChecklistItem[]
}

export interface ChatMessageRequest {
  message: string
}

export interface ChatMessageResponse {
  reply: string
  intentId?: string
}

/**
 * One completed exchange. The backend expects {question, answer} pairs rather
 * than the OpenAI-style {role, content} — see generateOpenRouterChatStream,
 * which reads turn.question / turn.answer. Sending the wrong shape yields
 * undefined content and the model silently loses the thread.
 */
export interface ChatHistoryTurn {
  question: string
  answer: string
}

export interface ChatStreamRequest {
  message: string
  history: ChatHistoryTurn[]
}

/**
 * Whether an answer actually rested on PNU documents.
 *
 * The backend has always computed this and sent it in the stream's final
 * metadata frame; nothing read it. That mattered because the assistant answers
 * visa and work-permit questions, and when retrieval returns nothing it still
 * answers — fluently, from a general-purpose model, in a bubble that looks
 * exactly like a sourced one.
 */
export interface ChatGrounding {
  /** True when knowledge-base context was retrieved and fed to the model. */
  grounded: boolean
  /** 'used' | 'not-used' | 'failed' — 'failed' means retrieval itself errored. */
  status: string
  /** Titles of the documents the answer drew on. Empty when ungrounded. */
  sources: string[]
  /**
   * False when the model stopped before finishing — almost always because it
   * hit the token cap. A truncated answer reads as a complete one, which on
   * "You do NOT need to report your part-time job if…" is the difference
   * between guidance and misinformation.
   */
  complete: boolean
}

export interface ChatStreamHandlers {
  onText: (chunk: string) => void
  /** Follow-up prompts grounded in the knowledge-base documents that matched. */
  onFollowUps?: (followUps: string[]) => void
  onGrounding?: (grounding: ChatGrounding) => void
  signal?: AbortSignal
}

export interface ApiError {
  message: string
  status?: number
}

export type FeedbackKind = 'feedback' | 'app-support'

export type CareerJobType = 'internship' | 'part-time' | 'full-time' | 'volunteer'

export interface CareerOpportunity {
  id: string
  source: string
  company: string
  title: string
  deadline: string
  role: string | null
  applicationType: string | null
  sourceUrl: string
  /** Optional fields for Internships UI + AI recommendations */
  location?: string | null
  jobType?: CareerJobType | null
  logoUrl?: string | null
  /** Short reason from the AI recommender (shown under recommended cards) */
  matchReason?: string | null
}

export interface CareerSummary {
  name: string
  count: number
}

export interface CareerOpportunitiesPagination {
  page: number
  limit: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface CareerOpportunitiesResponse {
  source: string
  careers: CareerSummary[]
  opportunities: CareerOpportunity[]
  pagination: CareerOpportunitiesPagination
  fetchedAt: string
}

export interface GetCareerOpportunitiesParams {
  page?: number
  limit?: number
  jobType?: CareerJobType
}

/** Backend team: implement these endpoints — see BACKEND.md */
export interface HeyPnuApi {
  login(data: LoginRequest): Promise<LoginChallengeResponse>
  verifyLogin(data: VerifyLoginRequest): Promise<AuthResponse>
  signup(data: SignupRequest): Promise<LoginChallengeResponse>
  verifySignup(data: VerifyLoginRequest): Promise<SignupVerifyResponse>
  completeSignup(data: CompleteSignupRequest): Promise<AuthResponse>
  logout(): Promise<void>
  getMe(): Promise<User>
  updateProfile(data: UpdateProfileRequest): Promise<User>
  /** School email (preferred) or student ID — the backend detects which by '@'. */
  forgotPassword(identifier: string): Promise<{ maskedEmail: string; code: string }>
  resetPassword(studentId: string, code: string, newPassword: string): Promise<void>
  getRecommendedCourses(
    type?: CourseType | 'ALL',
    term?: {
      academicYear: number
      semester: '1' | '2' | 'SUMMER' | 'WINTER'
    },
  ): Promise<RecommendedCourse[]>
  getCourseCatalog(params?: CourseCatalogParams): Promise<CourseCatalogPage>
  getTimetable(params?: {
    academicYear?: number
    semester?: '1' | '2' | 'SUMMER' | 'WINTER'
  }): Promise<TimetableEntry[]>
  createTimetableEntry(data: CreateTimetableEntryInput): Promise<TimetableEntry>
  deleteTimetableEntry(timetableEntryId: number): Promise<void>
  deleteTimetableCourse(courseId: number): Promise<void>
  getGraduationProgress(): Promise<GraduationProgress>
  updateGraduationRequirement(
    requirementId: string,
    completed: boolean,
  ): Promise<GraduationRequirementItem>
  getPersonalizedNotifications(): Promise<Notification[]>
  getPublicNotices(): Promise<Notification[]>
  getChecklist(): Promise<ChecklistPayload>
  updateChecklistItem(itemId: string, completed: boolean): Promise<ChecklistItem>
  sendChatMessage(data: ChatMessageRequest): Promise<ChatMessageResponse>
  streamChatMessage(
    data: ChatStreamRequest,
    handlers: ChatStreamHandlers,
  ): Promise<void>
  getChatSuggestions(): Promise<string[]>
  getPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }>
  subscribeToPush(data: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }): Promise<void>
  unsubscribeFromPush(endpoint: string): Promise<void>
  sendTestPush(): Promise<void>
  /**
   * Records in-app feedback. Rejects rather than resolving when the message
   * was not stored — the forms used to claim success unconditionally.
   */
  submitFeedback(data: { message: string; kind: FeedbackKind }): Promise<void>
  getCareerOpportunities(params?: GetCareerOpportunitiesParams): Promise<CareerOpportunitiesResponse>
  /**
   * AI hook-point: personalized internship/job recommendations.
   * Backend: GET /students/career-recommendations
   */
  getRecommendedCareerOpportunities(jobType?: CareerJobType): Promise<CareerOpportunity[]>
  getEmergencyGuide(): Promise<EmergencyGuide>
  getPnuContacts(): Promise<PnuContact[]>
  getFaqItems(): Promise<FaqItem[]>
  getMyCommunityGroup(scope: CommunityScope): Promise<CommunityGroup | null>
  getCommunityPosts(params: {
    scope: CommunityScope
    groupSlug?: string | null
    groupId?: number | null
  }): Promise<CommunityPost[]>
  createCommunityPost(data: CreateCommunityPostRequest): Promise<CommunityPost>
  likeCommunityPost(postId: string): Promise<{ id: string; likes: number }>
  deleteCommunityPost(postId: string): Promise<{ id: string }>
  getCampusFacilities(params?: GetCampusFacilitiesParams): Promise<CampusFacilities>
  getMajors(): Promise<{ data: MajorData[] }>
  getMapFacilities(): Promise<MapFacility[]>
  getMapFacility(id: string): Promise<MapFacility>
  getAcademicRecords(): Promise<AcademicRecords | null>
  getAiDashboard(): Promise<AiDashboard>
  /**
   * `suppressToast` is for screens that already degrade on failure. The toast
   * is raised inside apiFetch, before the caller's `.catch()` runs, so a
   * caller that handles the error still gets a banner unless it opts out here.
   */
  getScholarships(options?: { suppressToast?: boolean }): Promise<ScholarshipItem[]>
  getPrograms(): Promise<ProgramItem[]>
  getProgramDetail(programId: string): Promise<ProgramItem | null>
  getMemory(): Promise<string>
  updateMemory(memory: string): Promise<void>
  recommendMajor(data: MajorRecommendationRequest): Promise<MajorRecommendationResponse>
  getCourses(campus?: string): Promise<Course[]>
  getEnrollments(studentId: string): Promise<Enrollment[]>
  createEnrollment(studentId: string, courseId: number, semester?: string): Promise<Enrollment>
  addPastCourse(
    courseId: number,
    semester: string,
    details?: { finalGrade?: string | null; creditsEarned?: number | null },
  ): Promise<Enrollment>
  updateEnrollment(
    enrollmentId: number,
    details: { semester: string; finalGrade?: string | null; creditsEarned?: number | null },
  ): Promise<Enrollment>
  deleteEnrollment(enrollmentId: number): Promise<void>
  requestAccountDeletion(studentId: string): Promise<void>
  updateLanguagePreference(studentId: string, languagePref: string): Promise<void>
}
