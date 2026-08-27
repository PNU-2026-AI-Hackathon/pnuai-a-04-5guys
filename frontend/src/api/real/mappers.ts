import type {
  AcademicRecords,
  ChecklistItem,
  ChecklistPayload,
  ChecklistVariant,
  CourseCatalogItem,
  CourseType,
  CourseMetadataRequirement,
  GraduationProgress,
  GraduationRequirementItem,
  OriginalLanguageCode,
  RemoteCourseStatus,
  FacilityRoom,
  FaqItem,
  MapFacility,
  NoticeChannel,
  Notification,
  NotificationCategory,
  NotificationPriority,
  ProgramItem,
  PnuContact,
  RecommendedCourse,
  ScholarshipItem,
  TeachingLanguage,
  User,
} from '@/types/api'
import { formatMajorName } from '@/utils/formatMajor'

interface BackendCreditBucket {
  completed?: number
  required?: number
}

interface BackendStudent {
  student_id: string | number
  name?: string | null
  nationality?: string | null
  major_name?: string | null
  department?: string | null
  interests?: string[] | null
  student_type?: "Freshman" | "Current"
  grade?: number | null
  visa_status?: string
  language_pref?: string
  email?: string
  phone?: string
  completed_courses?: string[]
  deletion_requested?: boolean
  intake_term?: "March" | "September"
}

interface BackendChecklistItem {
  checklist_id: string | number
  title?: string | null
  task_name?: string | null
  description?: string | null
  status?: string | null
}

type BackendChecklistData =
  | BackendChecklistItem[]
  | Record<string, BackendChecklistItem[]>
  | null
  | undefined

interface BackendNotice {
  id?: string | number
  notice_id?: string | number
  kind?: 'NOTICE' | 'CHECKLIST'
  title?: string | null
  body?: string | null
  content?: string | null
  date?: string | null
  postedDate?: string | null
  posted_date?: string | null
  deadline?: string | null
  dueDate?: string | null
  updatedAt?: string | null
  languages?: string[] | null
  language?: string | null
  category?: NotificationCategory | null
  priority?: NotificationPriority | null
  source?: string | null
  channel?: NoticeChannel | null
  sourceUrl?: string | null
  source_url?: string | null
  originalTitle?: string | null
  originalBody?: string | null
  translationLanguage?: string | null
  score?: number | null
  matchHint?: string | null
  status?: string | null
  read?: boolean
  eligibility?: string | null
  requiredDocuments?: string[] | null
}

interface BackendCourse {
  id: string
  nameKo: string
  nameEn: string
  type: CourseType
  credits: number
  department?: string
  tags?: string[]
  score: number
  matchHint?: string
  officialCourseNumber?: string | null
  academicYear?: number | null
  semester?: string | null
  section?: string | null
  professor?: string | null
  schedule?: string | null
  remoteCourseStatus?: RemoteCourseStatus | null
  originalLanguageCode?: OriginalLanguageCode | null
  teachingLanguage?: TeachingLanguage | null
  isEnglishTaught?: boolean | null
  isOfferedThisTerm?: boolean | null
  theoryHours?: number | null
  practicalHours?: number | null
  presentationRequirement?: CourseMetadataRequirement | null
  groupProjectRequirement?: CourseMetadataRequirement | null
  assignmentRequirement?: CourseMetadataRequirement | null
  examInformation?: string | null
  majorId?: string | number | null
  majorName?: string | null
  isInStudentMajor?: boolean | null
  collegeId?: number | null
  year?: number | null
  curriculumYears?: number[]
  curriculum?: CourseCatalogItem['curriculum']
  courseOfferingId?: number | string
  enrollmentLimit?: number | null
  restrictions?: CourseCatalogItem['restrictions']
  slots?: CourseCatalogItem['slots']
  descriptionKo?: string | null
  descriptionEn?: string | null
  descriptionSourceUrl?: string | null
  syllabusUrl?: string | null
  detailSourceKind?: CourseCatalogItem['detailSourceKind']
  prerequisites?: CourseCatalogItem['prerequisites']
  offerings?: CourseCatalogItem['offerings']
}

function getAdmissionYear(studentId: string): number | null {
  const yearPrefix = studentId.slice(0, 4)
  if (!/^\d{4}$/.test(yearPrefix)) return null
  return Number(yearPrefix)
}

export function isFreshmanStudent(studentId: string): boolean {
  const admissionYear = getAdmissionYear(studentId)
  if (admissionYear === null) return false
  return admissionYear === new Date().getFullYear()
}

export function mapBackendStudent(data: BackendStudent): User {
  return {
    studentId: String(data.student_id),
    name: data.name ?? '',
    nationality: data.nationality ?? '',
    major: data.major_name ?? data.department ?? '',
    interests: Array.isArray(data.interests) ? data.interests : [],
    studentType: data.student_type,
    grade:
      data.grade === null || data.grade === undefined
        ? null
        : Number(data.grade),
    visaStatus: data.visa_status,
    language_pref: data.language_pref,
    email: data.email,
    phone: data.phone,
    completed_courses: data.completed_courses,
    deletion_requested: data.deletion_requested,
    intake_term: data.intake_term,
  }
}

export function mapChecklistVariant(
  _studentId: string,
  isNewFresher?: boolean,
): ChecklistVariant {
  // Trust the backend enrollment-history flag from the database.
  if (isNewFresher === true) return 'NEW_STUDENT'
  return 'GRADUATION_REQUIREMENT'
}

export function flattenChecklistItems(data: BackendChecklistData): BackendChecklistItem[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    return Object.values(data)
      .flat()
      .filter((item): item is BackendChecklistItem => Boolean(item && typeof item === 'object'))
  }
  return []
}

export function mapChecklistItem(item: BackendChecklistItem): ChecklistItem {
  const status = String(item.status ?? '').trim().toLowerCase()

  return {
    id: String(item.checklist_id),
    title: item.title ?? item.task_name ?? 'Untitled task',
    description: item.description ?? '',
    completed: status === 'completed' || status === 'done' || status === 'true',
  }
}

export function mapChecklistPayload(
  studentId: string,
  items: BackendChecklistData,
  options?: { isNewFresher?: boolean },
): ChecklistPayload {
  return {
    variant: mapChecklistVariant(studentId, options?.isNewFresher),
    items: flattenChecklistItems(items).map(mapChecklistItem),
  }
}

export function mapGraduationRequirementItem(row: {
  requirement_id?: number | string
  req_id?: number | string
  task_name?: string
  title?: string
  requirement_name?: string
  description?: string | null
  status?: string
  requirement_type?: string
  requirement_code?: string
  target_value?: number
}): GraduationRequirementItem {
  const status = String(row.status || '').toLowerCase()
  return {
    id: String(row.requirement_id ?? row.req_id ?? ''),
    title: row.title || row.task_name || row.requirement_name || '',
    description: row.description || '',
    completed: status === 'completed' || status === 'done',
    requirementType: row.requirement_type,
    requirementCode: row.requirement_code,
    targetValue: row.target_value,
  }
}

export function mapGraduationProgress(row: {
  total_required?: number
  total_completed?: number
  breakdown?: {
    general_required?: BackendCreditBucket
    general_elective?: BackendCreditBucket
    major_basic?: BackendCreditBucket
    major_required?: BackendCreditBucket
    major_elective?: BackendCreditBucket
    general_free?: BackendCreditBucket
  }
  grade_summary?: {
    has_completed_coursework?: boolean
    overall_gpa?: number | null
    major_gpa?: number | null
    gpa_scale?: number
    average_letter?: string | null
    semester_credits?: number
    standing?: string | null
  }
  requirements?: Array<Parameters<typeof mapGraduationRequirementItem>[0]>
}): GraduationProgress {
  const bucket = (value?: BackendCreditBucket) => ({
    completed: Number(value?.completed) || 0,
    required: Number(value?.required) || 0,
  })

  const grade = row.grade_summary
  return {
    totalRequired: Number(row.total_required) || 0,
    totalCompleted: Number(row.total_completed) || 0,
    breakdown: {
      generalRequired: bucket(row.breakdown?.general_required),
      generalElective: bucket(row.breakdown?.general_elective),
      majorBasic: bucket(row.breakdown?.major_basic),
      majorRequired: bucket(row.breakdown?.major_required),
      majorElective: bucket(row.breakdown?.major_elective),
      generalFree: bucket(row.breakdown?.general_free),
    },
    gradeSummary: grade
      ? {
          hasCompletedCoursework: Boolean(grade.has_completed_coursework),
          overallGpa:
            grade.overall_gpa == null ? null : Number(grade.overall_gpa),
          majorGpa: grade.major_gpa == null ? null : Number(grade.major_gpa),
          gpaScale: Number(grade.gpa_scale) || 4.5,
          averageLetter: grade.average_letter ?? null,
          semesterCredits: Number(grade.semester_credits) || 0,
          standing: grade.standing ?? null,
        }
      : undefined,
    requirements: (row.requirements || []).map(mapGraduationRequirementItem),
  }
}

export function mapNotice(notice: BackendNotice): Notification {
  const source = notice.source ?? null
  const category =
    typeof notice.category === 'string' && notice.category.trim()
      ? notice.category
      : null
  const priority =
    typeof notice.priority === 'string' && notice.priority.trim()
      ? notice.priority.toUpperCase()
      : null
  const postedDate = notice.postedDate ?? notice.posted_date ?? null
  const deadline = notice.deadline ?? null
  const languages = Array.isArray(notice.languages)
    ? notice.languages.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    : notice.language
      ? [notice.language]
      : []

  return {
    id: String(notice.id ?? notice.notice_id ?? ''),
    kind: notice.kind ?? 'NOTICE',
    title: notice.title ?? 'Untitled notice',
    body: notice.body ?? notice.content ?? '',
    date: notice.date ?? deadline ?? postedDate,
    postedDate,
    deadline,
    dueDate: notice.dueDate ?? null,
    updatedAt: notice.updatedAt ?? null,
    languages,
    category,
    priority,
    source,
    channel: notice.channel ?? null,
    sourceUrl: notice.sourceUrl ?? notice.source_url ?? null,
    originalTitle: notice.originalTitle ?? null,
    originalBody: notice.originalBody ?? null,
    translationLanguage: notice.translationLanguage ?? null,
    score: typeof notice.score === 'number' ? notice.score : null,
    matchHint: notice.matchHint ?? null,
    status: notice.status ?? null,
    read: notice.read ?? false,
    eligibility: notice.eligibility ?? null,
    requiredDocuments: Array.isArray(notice.requiredDocuments) ? notice.requiredDocuments : [],
  }
}

export function mapRecommendedCourse(course: BackendCourse): RecommendedCourse {
  return {
    id: course.id,
    nameKo: course.nameKo,
    nameEn: course.nameEn,
    type: course.type,
    credits: course.credits,
    department: course.department ?? '',
    majorId: course.majorId == null ? null : String(course.majorId),
    majorName: course.majorName ? formatMajorName(course.majorName) : null,
    isInStudentMajor:
      course.isInStudentMajor === true
        ? true
        : course.isInStudentMajor === false
          ? false
          : null,
    collegeId: course.collegeId ?? null,
    recommendedYear: course.year ?? null,
    tags: course.tags ?? [],
    score: course.score,
    matchHint: course.matchHint,
    officialCourseNumber: course.officialCourseNumber ?? null,
    academicYear: course.academicYear ?? null,
    semester: course.semester ?? null,
    section: course.section ?? null,
    professor: course.professor ?? null,
    schedule: course.schedule ?? null,
    remoteCourseStatus: course.remoteCourseStatus ?? null,
    originalLanguageCode: course.originalLanguageCode ?? null,
    teachingLanguage: course.teachingLanguage ?? null,
    isEnglishTaught:
      course.isEnglishTaught === true
        ? true
        : course.isEnglishTaught === false
          ? false
          : null,
    isOfferedThisTerm:
      course.isOfferedThisTerm === true
        ? true
        : course.isOfferedThisTerm === false
          ? false
          : null,
    theoryHours: course.theoryHours ?? null,
    practicalHours: course.practicalHours ?? null,
    presentationRequirement: course.presentationRequirement ?? null,
    groupProjectRequirement: course.groupProjectRequirement ?? null,
    assignmentRequirement: course.assignmentRequirement ?? null,
    examInformation: course.examInformation ?? null,
  }
}

export function mapCourseCatalogItem(course: BackendCourse): CourseCatalogItem {
  return {
    ...mapRecommendedCourse(course),
    curriculumYears: Array.isArray(course.curriculumYears)
      ? course.curriculumYears.filter(Number.isInteger)
      : [],
    curriculum: course.curriculum ?? null,
    courseOfferingId:
      course.courseOfferingId == null ? null : Number(course.courseOfferingId),
    officialCourseNumber: course.officialCourseNumber ?? null,
    academicYear: Number(course.academicYear),
    semester: String(course.semester),
    enrollmentLimit: course.enrollmentLimit ?? null,
    restrictions: Array.isArray(course.restrictions) ? course.restrictions : [],
    slots: Array.isArray(course.slots) ? course.slots : [],
    offerings: Array.isArray(course.offerings) ? course.offerings : [],
    descriptionKo: course.descriptionKo ?? null,
    descriptionEn: course.descriptionEn ?? null,
    descriptionSourceUrl: course.descriptionSourceUrl ?? null,
    syllabusUrl: course.syllabusUrl ?? null,
    detailSourceKind: course.detailSourceKind ?? null,
    prerequisites: Array.isArray(course.prerequisites) ? course.prerequisites : [],
  }
}

export function mapScholarshipItem(scholarship: ScholarshipItem): ScholarshipItem {
  return {
    id: String(scholarship.id),
    title: scholarship.title,
    deadline: scholarship.deadline,
    description: scholarship.description,
    eligibility: scholarship.eligibility,
    amount: scholarship.amount ?? null,
    provider: scholarship.provider ?? null,
    category: scholarship.category ?? null,
    tag: scholarship.tag ?? null,
    deadlineAt: scholarship.deadlineAt ?? null,
    sourceUrl: scholarship.sourceUrl ?? null,
  }
}

interface BackendMapFacility {
  facility_id?: number | string
  id?: number | string
  name: string
  name_ko?: string | null
  building_number?: string | null
  type: string
  latitude: number | string
  longitude: number | string
  phone?: string | null
  website?: string | null
  image?: string | null
  departments?: Array<{ name: string; floor: string }> | string | null
  amenities?: Array<{ name: string; floor: string }> | string | null
}

function parseFacilityRooms(
  value: Array<{ name: string; floor: string }> | string | null | undefined,
): FacilityRoom[] {
  if (!value) return []
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Array<{ name: string; floor: string }>
      return Array.isArray(parsed)
        ? parsed.map((item) => ({ name: item.name, floor: item.floor }))
        : []
    } catch {
      return []
    }
  }
  return value.map((item) => ({ name: item.name, floor: item.floor }))
}

export function mapMapFacility(row: BackendMapFacility): MapFacility {
  return {
    id: String(row.facility_id ?? row.id ?? ''),
    name: row.name,
    nameKo: row.name_ko ?? null,
    buildingNumber: row.building_number ?? null,
    type: row.type,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    phone: row.phone ?? null,
    website: row.website ?? null,
    image: row.image ?? null,
    departments: parseFacilityRooms(row.departments),
    amenities: parseFacilityRooms(row.amenities),
  }
}

export function mapPnuContact(row: {
  contact_id?: number | string
  slug: string
  name: string
  place: string
  hours: string
  phone: string
  email?: string | null
}): PnuContact {
  return {
    id: row.slug || String(row.contact_id),
    name: row.name,
    place: row.place,
    hours: row.hours,
    phone: row.phone,
    email: row.email ?? null,
  }
}

export function mapFaqItem(row: {
  faq_id?: number | string
  slug: string
  question: string
  answer: string
}): FaqItem {
  return {
    id: row.slug || String(row.faq_id),
    question: row.question,
    answer: row.answer,
  }
}

export function mapAcademicRecords(row: {
  student_id: string
  overall_gpa: number
  gpa_scale: number
  standing: string
  completed_credits: number
  required_credits: number
  semesters?: Array<{ semester_label: string; gpa: number }>
}): AcademicRecords {
  return {
    studentId: String(row.student_id),
    overallGpa: Number(row.overall_gpa),
    gpaScale: Number(row.gpa_scale),
    standing: row.standing,
    completedCredits: Number(row.completed_credits),
    requiredCredits: Number(row.required_credits),
    semesters: (row.semesters ?? []).map((s) => ({
      semesterLabel: s.semester_label,
      gpa: Number(s.gpa),
    })),
  }
}

export function mapProgramItem(program: ProgramItem): ProgramItem {
  return {
    id: String(program.id),
    title: program.title,
    description: program.description,
    date: program.date,
    category: program.category,
    sourceUrl: program.sourceUrl ?? null,
    score: program.score,
    matchHint: program.matchHint,
  }
}




