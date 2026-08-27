import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSource(relativePath) {
  return readFileSync(join(frontendRoot, relativePath), 'utf8')
}

const tsModuleCache = new Map()

/** Resolves a `@/...` alias the way vite.config / tsconfig paths do. */
function resolveAlias(specifier) {
  const withoutAlias = join(frontendRoot, 'src', specifier.slice(2))
  for (const candidate of [
    `${withoutAlias}.ts`,
    `${withoutAlias}.tsx`,
    join(withoutAlias, 'index.ts'),
    join(withoutAlias, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Cannot resolve ${specifier} from the frontend source tree`)
}

/**
 * Transpiles a TS module and runs it as CommonJS.
 *
 * The transpiled output calls require() for any VALUE import, so a module is
 * given a require that resolves `@/...` back into this same loader. Without it
 * the harness only worked on files that happened to import nothing but types —
 * which erase — and adding one ordinary import to a module under test broke the
 * suite with "require is not defined in ES module scope", pointing at the
 * loader rather than at the import that caused it.
 */
function loadTypeScriptModule(pathOrAbsolute) {
  const absolute = isAbsolute(pathOrAbsolute)
    ? pathOrAbsolute
    : join(frontendRoot, pathOrAbsolute)
  const cached = tsModuleCache.get(absolute)
  if (cached) return cached.exports

  const source = readFileSync(absolute, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

  const module = { exports: {} }
  // Cached before evaluating, so an import cycle sees a partially populated
  // exports object rather than recursing forever — the same way CommonJS does.
  tsModuleCache.set(absolute, module)

  const moduleRequire = (specifier) =>
    specifier.startsWith('@/') ? loadTypeScriptModule(resolveAlias(specifier)) : require(specifier)

  Function('module', 'exports', 'require', output)(module, module.exports, moduleRequire)
  return module.exports
}

const {
  getCourseLanguageBadgeKey,
  getRemoteCourseStatusKey,
  getVerifiedCourseOfferingDisplay,
} = loadTypeScriptModule(
  'src/utils/courseOfferingDisplay.ts',
)
const { mapRecommendedCourse } = loadTypeScriptModule('src/api/real/mappers.ts')

const base = {
  id: '1',
  nameKo: '과목',
  nameEn: 'Course',
  type: 'ELECTIVE',
  credits: 3,
  department: '',
  tags: [],
  score: 50,
}

assert.equal(
  getCourseLanguageBadgeKey({
    isEnglishTaught: true,
    originalLanguageCode: 'E',
    teachingLanguage: 'ENGLISH',
  }),
  'courseOffering.englishTaught',
)
assert.equal(
  getCourseLanguageBadgeKey({
    isEnglishTaught: false,
    originalLanguageCode: 'C',
    teachingLanguage: 'OTHER',
  }),
  'courseOffering.chinese',
)
assert.equal(
  getCourseLanguageBadgeKey({
    isEnglishTaught: null,
    originalLanguageCode: null,
    teachingLanguage: null,
  }),
  null,
)
assert.equal(
  getCourseLanguageBadgeKey({
    isEnglishTaught: null,
    originalLanguageCode: null,
    teachingLanguage: 'MIXED',
  }),
  'courseOffering.mixedLanguage',
)
assert.equal(getRemoteCourseStatusKey(null), null)
assert.equal(getRemoteCourseStatusKey('REMOTE'), 'courseOffering.remote')

const unknown = mapRecommendedCourse(base)
for (const field of [
  'officialCourseNumber',
  'academicYear',
  'semester',
  'section',
  'professor',
  'schedule',
  'remoteCourseStatus',
  'originalLanguageCode',
  'teachingLanguage',
  'isEnglishTaught',
  'theoryHours',
  'practicalHours',
  'presentationRequirement',
  'groupProjectRequirement',
  'assignmentRequirement',
  'examInformation',
]) {
  assert.equal(unknown[field], null, `${field} must preserve unknown as null`)
}
assert.equal(mapRecommendedCourse({ ...base, isEnglishTaught: false }).isEnglishTaught, false)
assert.equal(mapRecommendedCourse({ ...base, isOfferedThisTerm: true }).isOfferedThisTerm, true)
assert.equal(mapRecommendedCourse({ ...base, isOfferedThisTerm: false }).isOfferedThisTerm, false)
assert.equal(unknown.isOfferedThisTerm, null)

const fixtureDisplays = [
  { ...base, id: 'english', isEnglishTaught: true, originalLanguageCode: 'E', teachingLanguage: 'ENGLISH' },
  { ...base, id: 'chinese', isEnglishTaught: false, originalLanguageCode: 'C', teachingLanguage: 'OTHER' },
  { ...base, id: 'unknown-language' },
  { ...base, id: 'remote', remoteCourseStatus: 'REMOTE' },
  { ...base, id: 'staffed', professor: 'Professor Kim', schedule: 'Mon 09:00' },
  { ...base, id: 'no-offering' },
].map((fixture) => getVerifiedCourseOfferingDisplay(mapRecommendedCourse(fixture)))

assert.equal(fixtureDisplays[0].languageBadgeKey, 'courseOffering.englishTaught')
assert.equal(fixtureDisplays[1].languageBadgeKey, 'courseOffering.chinese')
assert.equal(fixtureDisplays[2].languageBadgeKey, null)
assert.equal(fixtureDisplays[3].remoteStatusKey, 'courseOffering.remote')
assert.equal(fixtureDisplays[4].professor, 'Professor Kim')
assert.equal(fixtureDisplays[4].schedule, 'Mon 09:00')
assert.deepEqual(fixtureDisplays[5], {
  languageBadgeKey: null,
  remoteStatusKey: null,
  officialCourseNumber: null,
  term: null,
  section: null,
  professor: null,
  schedule: null,
  presentationRequirementKey: null,
  groupProjectRequirementKey: null,
  assignmentRequirementKey: null,
  examInformation: null,
  hasAssessmentMetadata: false,
})

const capstone = getVerifiedCourseOfferingDisplay(mapRecommendedCourse({
  ...base,
  id: 'capstone',
  presentationRequirement: 'REQUIRED',
  groupProjectRequirement: 'REQUIRED',
  assignmentRequirement: 'REQUIRED',
  examInformation: 'Presentation and final work evaluation',
}))
assert.equal(capstone.presentationRequirementKey, 'courseMetadata.presentation.required')
assert.equal(capstone.groupProjectRequirementKey, 'courseMetadata.groupProject.required')
assert.equal(capstone.assignmentRequirementKey, 'courseMetadata.assignment.required')
assert.equal(capstone.hasAssessmentMetadata, true)

const aiProgramming = getVerifiedCourseOfferingDisplay(mapRecommendedCourse({
  ...base,
  id: 'ai-programming',
  presentationRequirement: 'REQUIRED',
  assignmentRequirement: 'REQUIRED',
}))
assert.equal(aiProgramming.presentationRequirementKey, 'courseMetadata.presentation.required')
assert.equal(aiProgramming.groupProjectRequirementKey, null)

const databases = getVerifiedCourseOfferingDisplay(mapRecommendedCourse({
  ...base,
  id: 'databases',
  presentationRequirement: null,
  groupProjectRequirement: null,
  assignmentRequirement: null,
  examInformation: null,
}))
assert.equal(databases.presentationRequirementKey, null)
assert.equal(databases.groupProjectRequirementKey, null)
assert.equal(databases.assignmentRequirementKey, null)
assert.equal(databases.examInformation, null)
assert.equal(databases.hasAssessmentMetadata, false)

for (const id of [
  'computer-architecture',
  'ai-programming',
  'web-application-programming',
  'platform-based-programming',
  'software-engineering',
  'deep-learning-programming',
]) {
  const display = getVerifiedCourseOfferingDisplay(mapRecommendedCourse({
    ...base,
    id,
    assignmentRequirement: 'REQUIRED',
  }))
  assert.equal(display.assignmentRequirementKey, 'courseMetadata.assignment.required')
}

const explicitPresentationNone = getVerifiedCourseOfferingDisplay(mapRecommendedCourse({
  ...base,
  id: 'presentation-none',
  presentationRequirement: 'NONE',
}))
assert.equal(explicitPresentationNone.presentationRequirementKey, null)

const courseDetailSource = readSource('src/pages/CourseDetailPage.tsx')
assert.match(courseDetailSource, /getCourseCatalog\(\{ courseId, pageSize: 1, academicYear: term\.academicYear, semester: term\.semester \}\)/)
assert.match(courseDetailSource, /CourseTermSelector/)
assert.match(courseDetailSource, /enrollmentLimit/)
assert.match(courseDetailSource, /course\.restrictions/)

const recommendationSource = readSource('src/pages/RecommendedCoursesPage.tsx')
assert.match(recommendationSource, /courseId: course\.id,[\s\S]*academicYear,[\s\S]*semester,/)
assert.match(recommendationSource, /CourseListControls/)
assert.match(recommendationSource, /filterAndSortCourses/)

const dashboardSource = readSource('src/pages/CoursesDashboardPage.tsx')
assert.match(dashboardSource, /useState<CourseType \| 'ALL'>\('전공'\)/)
assert.match(dashboardSource, /api\.createEnrollment\(user\.studentId, courseId, enrollmentSemester\(term\)\)/)
assert.match(dashboardSource, /api\.createTimetableEntry\(data\)/)
assert.match(dashboardSource, /api\.deleteEnrollment\(Number\(enrollment\.enrollment_id\)\)/)
assert.match(dashboardSource, /catalogTotal\.toLocaleString\(\)/)
assert.match(dashboardSource, /catalogHasMore/)
assert.match(dashboardSource, /recommendedYear/)
assert.match(dashboardSource, /api\.getMajors\(\)/)
assert.match(dashboardSource, /myMajor: !appliedCatalogFilters\.majorId/)
assert.match(dashboardSource, /majorId: appliedCatalogFilters\.majorId \? Number\(appliedCatalogFilters\.majorId\) : undefined/)
assert.match(dashboardSource, /languageFilter: appliedCatalogFilters\.languageFilter/)
assert.match(dashboardSource, /sortBy: appliedCatalogFilters\.sortBy/)
assert.match(dashboardSource, /sortDirection: appliedCatalogFilters\.sortDirection/)
assert.match(dashboardSource, /CourseListControls/)
assert.match(dashboardSource, /pastGradeFilter/)
assert.match(dashboardSource, /courses\.searchPastPlaceholder/)
assert.match(dashboardSource, /courses\.graduationSyncHelp/)
assert.match(dashboardSource, /recentPastTerms/)
assert.match(dashboardSource, /function searchCatalog\(/)
assert.match(dashboardSource, /type="submit"/)
assert.match(dashboardSource, /<CourseTypeBadge[\s\S]*showOriginalTypeForOtherMajor/)
assert.match(dashboardSource, /Add to My Courses|courses\.addCurrent/)

const academicSource = readSource('src/pages/AcademicPage.tsx')
assert.match(academicSource, /timetableCredits/)
assert.match(academicSource, /schedule\.plannedCredits/)
assert.match(academicSource, /useState<'DAILY' \| 'GRID'>\('GRID'\)/)
assert.match(academicSource, /CourseTermSelector value=\{term\} onChange=\{setTerm\}/)
assert.match(academicSource, /enrollmentSemester\(term\)/)
assert.match(academicSource, /CourseListControls/)
assert.match(academicSource, /languageFilter: catalogLanguage/)
assert.match(academicSource, /sortBy: catalogSort/)
assert.match(academicSource, /sortDirection: catalogDirection/)
assert.doesNotMatch(academicSource, /schedule\.recurringWeekly/)

const addPastCourseSource = readSource('src/components/courses/AddPastCourseModal.tsx')
assert.match(addPastCourseSource, /uniqueCourses/)
assert.match(addPastCourseSource, /creditsEarned: finalGrade/)

const editPastCourseSource = readSource('src/components/courses/EditPastCourseModal.tsx')
assert.match(editPastCourseSource, /z-\[100\]/)
assert.match(editPastCourseSource, /<footer/)
assert.match(editPastCourseSource, /courses\.recordGrade/)
assert.match(editPastCourseSource, /const TERMS = \['Spring', 'Summer', 'Fall', 'Winter'\]/)
assert.match(readSource('src/i18n/locales/en.ts'), /courses\.autoIncluded/)

const badgeSource = readSource('src/components/ui/Badge.tsx')
assert.match(badgeSource, /showOriginalTypeForOtherMajor/)

const courseCardSource = readSource('src/components/courses/CourseCard.tsx')
assert.match(courseCardSource, /getCourseLanguageBadgeKey/)

const listControlsSource = readSource('src/components/courses/CourseListControls.tsx')
assert.match(listControlsSource, /courseCatalog\.languageFilter/)
assert.match(listControlsSource, /courseCatalog\.sortBy/)
assert.match(listControlsSource, /courseCatalog\.sortDirection/)

const courseListSource = readSource('src/utils/courseList.ts')
assert.match(courseListSource, /matchesCourseLanguage/)
assert.match(courseListSource, /sortBy === 'RELEVANCE'/)

assert.match(recommendationSource, /getRecommendedCourses\('ALL', \{ academicYear, semester \}\)/)
assert.match(readSource('src/pages/ScholarshipsPage.tsx'), /scholarships\.noticeSourceDisclosure/)

const programsSource = readSource('src/pages/ProgramsPage.tsx')
assert.match(programsSource, /const RECOMMENDED_LIMIT = 3/)
assert.match(programsSource, /useState<ProgramTab>\('all'\)/)
assert.match(programsSource, /categoryFilter/)
assert.match(programsSource, /statusFilter/)
assert.match(programsSource, /sortDirection/)
assert.match(programsSource, /programs\.topThree/)

console.log('Course, timetable, recommendation, scholarship, program, and metadata frontend checks passed: 106 assertions')
