import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, CalendarDays, Check, ChevronRight, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { api } from '@/api'
import { AddPastCourseModal } from '@/components/courses/AddPastCourseModal'
import { EditPastCourseModal } from '@/components/courses/EditPastCourseModal'
import { CourseTermSelector } from '@/components/courses/CourseTermSelector'
import { CourseListControls } from '@/components/courses/CourseListControls'
import { AddTimetableModal } from '@/components/schedule/AddTimetableModal'
import { useAuth } from '@/context/AuthContext'
import { useLanguage } from '@/context/LanguageContext'
import type { CourseCatalogItem, CourseLanguageFilter, CourseSortKey, CourseType, CreateTimetableEntryInput, Enrollment, MajorData, SortDirection } from '@/types/api'
import { currentCourseTerm, enrollmentSemester, type CourseTerm } from '@/utils/courseTerm'
import { formatMajorName } from '@/utils/formatMajor'
import { getCourseLanguageBadgeKey } from '@/utils/courseOfferingDisplay'
import { CourseTypeBadge } from '@/components/ui/Badge'

type CoursesTab = 'current' | 'all' | 'past'
const CARD_SHADOW = '0 8px 24px rgba(15,23,42,0.06)'

interface AppliedCatalogFilters {
  query: string
  category: CourseType | 'ALL'
  recommendedYear?: number
  majorId: string
  languageFilter: CourseLanguageFilter
  sortBy: Exclude<CourseSortKey, 'RELEVANCE'>
  sortDirection: SortDirection
}

function isCompletedStatus(status: string) {
  const normalized = String(status || '').toLowerCase()
  return normalized.includes('complete') || normalized.includes('passed') || normalized === 'done'
}

function termRank(value: string) {
  const match = String(value || '').match(/^(\d{4})-(Spring|Summer|Fall|Winter)$/i)
  if (!match) return null
  const order: Record<string, number> = { spring: 1, summer: 2, fall: 3, winter: 4 }
  return Number(match[1]) * 10 + order[match[2].toLowerCase()]
}

function currentTermRank(now = new Date()) {
  return now.getFullYear() * 10 + (now.getMonth() + 1 >= 7 ? 3 : 1)
}

function recentPastTerms(now = new Date(), yearCount = 10) {
  const terms = ['Winter', 'Fall', 'Summer', 'Spring'] as const
  const currentRank = currentTermRank(now)
  const values: string[] = []
  for (let year = now.getFullYear(); year > now.getFullYear() - yearCount; year -= 1) {
    for (const term of terms) {
      const value = `${year}-${term}`
      if ((termRank(value) ?? currentRank) < currentRank) values.push(value)
    }
  }
  return values
}

function isPastEnrollment(enrollment: Enrollment) {
  if (isCompletedStatus(enrollment.status)) return true
  const rank = termRank(enrollment.semester)
  return rank != null && rank < currentTermRank()
}

function formatSchedule(enrollment: Enrollment): string {
  if (enrollment.schedule) return enrollment.schedule
  if (!enrollment.day_of_week || !enrollment.start_time || !enrollment.end_time) {
    return 'Schedule unavailable'
  }
  return `${enrollment.day_of_week} ${enrollment.start_time.slice(0, 5)} – ${enrollment.end_time.slice(0, 5)}`
}

export function CoursesDashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [tab, setTab] = useState<CoursesTab>('current')
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [catalog, setCatalog] = useState<CourseCatalogItem[]>([])
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [majors, setMajors] = useState<MajorData[]>([])
  const [selectedCollege, setSelectedCollege] = useState('')
  const [selectedMajorId, setSelectedMajorId] = useState('')
  const [query, setQuery] = useState('')
  const [catalogCategory, setCatalogCategory] = useState<CourseType | 'ALL'>('전공')
  const [recommendedYear, setRecommendedYear] = useState<number | undefined>()
  const [languageFilter, setLanguageFilter] = useState<CourseLanguageFilter>('ALL')
  const [sortBy, setSortBy] = useState<Exclude<CourseSortKey, 'RELEVANCE'>>('NAME')
  const [sortDirection, setSortDirection] = useState<SortDirection>('ASC')
  const [appliedCatalogFilters, setAppliedCatalogFilters] = useState<AppliedCatalogFilters>({
    query: '',
    category: '전공',
    recommendedYear: undefined,
    majorId: '',
    languageFilter: 'ALL',
    sortBy: 'NAME',
    sortDirection: 'ASC',
  })
  // Defaults to the student's own major. Opening the catalogue on "All majors"
  // meant the first thing a student saw was 1,924 courses from 116 majors, and
  // the toggle that fixes it looks like a filter you would apply, not one you
  // need to undo. If the student has no major recorded the backend resolves it
  // to null and shows everything, which is the same as before.
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [showAddPast, setShowAddPast] = useState(false)
  const [editingPast, setEditingPast] = useState<Enrollment | null>(null)
  const [pastQuery, setPastQuery] = useState('')
  const [pastTerm, setPastTerm] = useState('ALL')
  const [pastGradeFilter, setPastGradeFilter] = useState<'ALL' | 'GRADED' | 'PENDING'>('ALL')
  const [selectedCourse, setSelectedCourse] = useState<CourseCatalogItem | null>(null)
  const [timetableCourseIds, setTimetableCourseIds] = useState<Set<number>>(new Set())
  const [term, setTerm] = useState<CourseTerm>(() => currentCourseTerm())
  const [draftTerm, setDraftTerm] = useState<CourseTerm>(() => currentCourseTerm())
  const [changingCourseId, setChangingCourseId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const academicYear = term.academicYear
  const semester = term.semester

  const loadEnrollments = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      setEnrollments(await api.getEnrollments(user.studentId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('academic.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t, user])

  useEffect(() => { loadEnrollments() }, [loadEnrollments])

  useEffect(() => {
    let cancelled = false
    api.getMajors()
      .then(({ data }) => {
        if (cancelled) return
        const availableMajors = data || []
        setMajors(availableMajors)
        const normalizedUserMajor = String(user?.major || '').trim().toLowerCase()
        const studentMajor = availableMajors.find((major) =>
          major.major_name.trim().toLowerCase() === normalizedUserMajor)
        if (studentMajor) {
          setSelectedCollege(studentMajor.department)
          setSelectedMajorId(String(studentMajor.major_id))
          setAppliedCatalogFilters((current) => ({
            ...current,
            majorId: String(studentMajor.major_id),
          }))
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('academic.loadError')))
    return () => { cancelled = true }
  }, [t, user?.major])

  useEffect(() => {
    api.getTimetable({ academicYear, semester })
      .then((entries) => setTimetableCourseIds(new Set(entries.map((entry) => Number(entry.course_id)))))
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('academic.loadError')))
  }, [academicYear, semester, t])

  useEffect(() => {
    if (tab !== 'all') return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setCatalogLoading(true)
      setError('')
      try {
        const page = await api.getCourseCatalog({
          page: 1,
          pageSize: 100,
          search: appliedCatalogFilters.query,
          category: appliedCatalogFilters.category,
          recommendedYear: appliedCatalogFilters.recommendedYear,
          myMajor: !appliedCatalogFilters.majorId,
          majorId: appliedCatalogFilters.majorId ? Number(appliedCatalogFilters.majorId) : undefined,
          languageFilter: appliedCatalogFilters.languageFilter,
          sortBy: appliedCatalogFilters.sortBy,
          sortDirection: appliedCatalogFilters.sortDirection,
          academicYear,
          semester,

        })
        if (cancelled) return
        setCatalog(page.items)
        setCatalogPage(page.page)
        setCatalogTotal(page.total)
        setCatalogHasMore(page.hasMore)
      } catch (reason) {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : t('academic.loadError'))
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [academicYear, appliedCatalogFilters, semester, t, tab])

  const pastEnrollments = useMemo(() => enrollments.filter(isPastEnrollment), [enrollments])
  const activeEnrollments = useMemo(() => enrollments.filter((item) => !isPastEnrollment(item)), [enrollments])
  const semesterCredits = activeEnrollments.reduce((sum, item) => sum + (item.credit ?? 0), 0)
  const colleges = useMemo(() => Array.from(new Set(
    majors.map((major) => major.department).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b)), [majors])
  const majorsForCollege = useMemo(() => majors
    .filter((major) => major.department === selectedCollege)
    .sort((a, b) => a.major_name.localeCompare(b.major_name)), [majors, selectedCollege])
  const studentMajor = useMemo(() => {
    const normalizedUserMajor = String(user?.major || '').trim().toLowerCase()
    return majors.find((major) => major.major_name.trim().toLowerCase() === normalizedUserMajor) || null
  }, [majors, user?.major])

  const currentCourseIds = useMemo(() => {
    const ids = new Set<number>(timetableCourseIds)
    for (const item of activeEnrollments) {
      if (item.course_id) ids.add(Number(item.course_id))
      if (item.catalog_course_id) ids.add(Number(item.catalog_course_id))
    }
    return ids
  }, [timetableCourseIds, activeEnrollments])

  async function loadMore() {
    const nextPage = catalogPage + 1
    setCatalogLoading(true)
    try {
      const page = await api.getCourseCatalog({
        page: nextPage,
        pageSize: 100,
        search: appliedCatalogFilters.query,
        category: appliedCatalogFilters.category,
        recommendedYear: appliedCatalogFilters.recommendedYear,
        myMajor: !appliedCatalogFilters.majorId,
        majorId: appliedCatalogFilters.majorId ? Number(appliedCatalogFilters.majorId) : undefined,
        languageFilter: appliedCatalogFilters.languageFilter,
        sortBy: appliedCatalogFilters.sortBy,
        sortDirection: appliedCatalogFilters.sortDirection,
        academicYear,
        semester,

      })
      setCatalog((current) => [...current, ...page.items])
      setCatalogPage(page.page)
      setCatalogHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('academic.loadError'))
    } finally {
      setCatalogLoading(false)
    }
  }

  function selectCollege(college: string) {
    setSelectedCollege(college)
    const firstMajor = majors
      .filter((major) => major.department === college)
      .sort((a, b) => a.major_name.localeCompare(b.major_name))[0]
    setSelectedMajorId(firstMajor ? String(firstMajor.major_id) : '')
  }

  function resetCatalogFilters() {
    const resetTerm = currentCourseTerm()
    setQuery('')
    setCatalogCategory('전공')
    setRecommendedYear(undefined)
    setLanguageFilter('ALL')
    setSortBy('NAME')
    setSortDirection('ASC')
    setDraftTerm(resetTerm)
    setTerm(resetTerm)
    if (studentMajor) {
      setSelectedCollege(studentMajor.department)
      setSelectedMajorId(String(studentMajor.major_id))
      setAppliedCatalogFilters({
        query: '',
        category: '전공',
        recommendedYear: undefined,
        majorId: String(studentMajor.major_id),
        languageFilter: 'ALL',
        sortBy: 'NAME',
        sortDirection: 'ASC',
      })
    } else {
      setSelectedCollege('')
      setSelectedMajorId('')
      setAppliedCatalogFilters({
        query: '',
        category: '전공',
        recommendedYear: undefined,
        majorId: '',
        languageFilter: 'ALL',
        sortBy: 'NAME',
        sortDirection: 'ASC',
      })
    }
  }

  function searchCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTerm(draftTerm)
    setAppliedCatalogFilters({
      query: query.trim(),
      category: catalogCategory,
      recommendedYear,
      majorId: selectedMajorId,
      languageFilter,
      sortBy,
      sortDirection,
    })
  }

  async function addCurrentCourse(data: CreateTimetableEntryInput) {
    if (!user) return
    const courseId = Number(data.courseId)
    setChangingCourseId(courseId)
    setError('')
    let createdEnrollment: Enrollment | null = null
    try {
      const alreadyEnrolled = activeEnrollments.some((item) =>
        Number(item.catalog_course_id || item.course_id) === courseId
        && item.semester === enrollmentSemester(term))
      if (!alreadyEnrolled) createdEnrollment = await api.createEnrollment(user.studentId, courseId, enrollmentSemester(term))
      try {
        await api.createTimetableEntry(data)
      } catch (reason) {
        if (createdEnrollment) await api.deleteEnrollment(createdEnrollment.enrollment_id).catch(() => undefined)
        throw reason
      }
      await loadEnrollments()
      setTimetableCourseIds((current) => new Set(current).add(courseId))
      setSelectedCourse(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.errorFallback'))
    } finally {
      setChangingCourseId(null)
    }
  }

  async function dropTimetableCourse(courseId: number) {
    if (!window.confirm(t('academic.confirmDrop') || 'Remove this course from your timetable?')) return
    setChangingCourseId(courseId)
    setError('')
    try {
      await api.deleteTimetableCourse(courseId)
      setTimetableCourseIds((current) => {
        const next = new Set(current)
        next.delete(courseId)
        return next
      })
      await loadEnrollments()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.errorFallback'))
    } finally {
      setChangingCourseId(null)
    }
  }

  async function removeCourse(enrollment: Enrollment) {
    if (!window.confirm(t('courses.removeConfirm'))) return
    setChangingCourseId(Number(enrollment.course_id))
    setError('')
    try {
      await api.deleteEnrollment(Number(enrollment.enrollment_id))
      await loadEnrollments()
      setTimetableCourseIds((current) => {
        const next = new Set(current)
        next.delete(Number(enrollment.catalog_course_id || enrollment.course_id))
        return next
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.errorFallback'))
    } finally {
      setChangingCourseId(null)
    }
  }

  const tabs: { id: CoursesTab; labelKey: string }[] = [
    { id: 'current', labelKey: 'courses.tabCurrent' },
    { id: 'all', labelKey: 'courses.tabAll' },
    { id: 'past', labelKey: 'courses.tabPast' },
  ]
  const pastTerms = Array.from(new Set([
    ...pastEnrollments.map((item) => item.semester),
    ...recentPastTerms(),
  ]))
    .sort((a, b) => (termRank(b) ?? 0) - (termRank(a) ?? 0))
  const filteredPastEnrollments = pastEnrollments
    .filter((item) => {
      if (pastTerm !== 'ALL' && item.semester !== pastTerm) return false
      if (pastGradeFilter === 'GRADED' && !item.final_grade) return false
      if (pastGradeFilter === 'PENDING' && item.final_grade) return false
      const needle = pastQuery.trim().toLowerCase()
      if (!needle) return true
      return [
        item.course_name,
        item.course_name_en,
        item.course_name_ko,
        item.official_course_number,
        item.semester,
        item.final_grade,
      ].some((value) => String(value || '').toLowerCase().includes(needle))
    })
    .sort((a, b) => {
      const termComparison = (termRank(b.semester) ?? 0) - (termRank(a.semester) ?? 0)
      if (termComparison) return termComparison
      return String(a.course_name_en || a.course_name || '').localeCompare(String(b.course_name_en || b.course_name || ''))
    })
  const visibleEnrollments = tab === 'past' ? filteredPastEnrollments : activeEnrollments

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-[#F5F7FB]/95 px-3 py-2 backdrop-blur-xl">
        <button type="button" onClick={() => navigate(-1)} className="rounded-lg p-1" aria-label={t('common.goBack')}><ArrowLeft className="h-4 w-4" /></button>
        <h1 className="text-[15px] font-bold text-pnu-text">{t('courses.title')}</h1>
        <Link to="/academic/recommended-courses" className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#E8F3FF] text-pnu-blue"><BookOpen className="h-4 w-4" /></Link>
      </header>

      <div className="space-y-3 px-3 pb-5">
        {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}
        <section>
          <h2 className="mb-1.5 text-[12px] font-bold text-pnu-text">{t('courses.overview')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              [t('courses.enrolledCourses'), activeEnrollments.length, t('courses.coursesUnit')],
              [t('courses.thisSemester'), semesterCredits, t('courses.creditsUnit')],
            ].map(([label, value, unit]) => (
              <div key={String(label)} className="rounded-[14px] bg-white px-3 py-2.5" style={{ boxShadow: CARD_SHADOW }}>
                <p className="text-[10px] font-medium text-pnu-muted">{label}</p>
                <p className="mt-1 text-[22px] font-bold leading-none text-pnu-text">{value}</p>
                <p className="mt-0.5 text-[10px] text-pnu-muted">{unit}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="flex gap-3.5 overflow-x-auto border-b border-black/8">
          {tabs.map(({ id, labelKey }) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`-mb-px border-b-2 pb-1.5 text-[11px] font-semibold ${tab === id ? 'border-pnu-blue text-pnu-blue' : 'border-transparent text-pnu-muted'}`}>{t(labelKey)}</button>
          ))}
        </div>

        {tab === 'all' ? (
          <>
            <form onSubmit={searchCatalog} className="overflow-hidden rounded-[18px] border border-[#DDE4EE] bg-white" style={{ boxShadow: CARD_SHADOW }}>
              <div className="flex items-start justify-between gap-3 border-b border-[#E7ECF3] bg-gradient-to-r from-[#F4F8FF] to-white px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-pnu-blue text-white">
                    <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[13px] font-bold text-pnu-text">{t('courseCatalog.filtersTitle')}</h2>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-pnu-muted">{t('courseCatalog.filtersHint')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetCatalogFilters}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#D8E0EB] bg-white px-2 py-1.5 text-[10px] font-bold text-pnu-blue transition hover:bg-[#F4F8FF]"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t('courseCatalog.resetFilters')}
                </button>
              </div>

              <div className="space-y-3 p-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">
                    {t('courseCatalog.termSelector')}
                  </label>
                  <CourseTermSelector value={draftTerm} onChange={setDraftTerm} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('profile.college')}</span>
                    <select
                      value={selectedCollege}
                      onChange={(event) => selectCollege(event.target.value)}
                      className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none transition focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20"
                    >
                      <option value="">{t('courseCatalog.selectCollege')}</option>
                      {colleges.map((college) => <option key={college} value={college}>{college}</option>)}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('profile.major')}</span>
                    <select
                      value={selectedMajorId}
                      onChange={(event) => setSelectedMajorId(event.target.value)}
                      disabled={!selectedCollege}
                      className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none transition focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{t('courseCatalog.selectMajor')}</option>
                      {majorsForCollege.map((major) => (
                        <option key={major.major_id} value={major.major_id}>{major.major_name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('courseCatalog.categoryFilter')}</span>
                <select
                  value={catalogCategory}
                  onChange={(event) => setCatalogCategory(event.target.value as CourseType | 'ALL')}
                        className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none transition focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20"
                  aria-label={t('courseCatalog.categoryFilter')}
                >
                  <option value="ALL">{t('courseFilter.all')}</option>
                  <option value="전공">{t('courseFilter.major')}</option>
                  <option value="효원핵심교양">{t('courseFilter.hyowonCore')}</option>
                  <option value="효원균형교양">{t('courseFilter.hyowonBalanced')}</option>
                  <option value="효원창의교양">{t('courseFilter.hyowonCreative')}</option>
                  <option value="일반선택">{t('courseFilter.generalElective')}</option>
                </select>
                  </label>
                  <label className="min-w-0">
                    <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('courseCatalog.yearFilter')}</span>
                    <select
                      value={recommendedYear ?? ''}
                      onChange={(event) => setRecommendedYear(event.target.value ? Number(event.target.value) : undefined)}
                      className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none transition focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20"
                      aria-label={t('courseCatalog.yearFilter')}
                    >
                      <option value="">{t('courseCatalog.allYears')}</option>
                      {[1, 2, 3, 4].map((year) => <option key={year} value={year}>{t('courseCatalog.yearOption', { year })}</option>)}
                    </select>
                  </label>
                </div>

                <CourseListControls
                  language={languageFilter}
                  sortBy={sortBy}
                  direction={sortDirection}
                  onLanguageChange={setLanguageFilter}
                  onSortChange={(value) => setSortBy(value === 'RELEVANCE' ? 'NAME' : value)}
                  onDirectionChange={setSortDirection}
                />

                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('courseCatalog.courseName')}</span>
                  <span className="relative block">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pnu-muted" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('courseCatalog.searchPlaceholder')}
                      className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] py-2.5 pl-9 pr-3 text-sm text-pnu-text outline-none transition placeholder:text-pnu-muted/70 focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20"
                    />
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={catalogLoading || !selectedMajorId}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pnu-blue px-4 py-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(0,61,130,0.2)] transition hover:bg-pnu-blue-light active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  {catalogLoading ? t('common.loading') : t('courseCatalog.searchAction')}
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] font-semibold text-pnu-muted">{t('courseCatalog.results', { count: catalogTotal.toLocaleString() })}</p>
              {studentMajor && selectedMajorId === String(studentMajor.major_id) ? (
                <span className="rounded-full bg-[#E8F3FF] px-2.5 py-1 text-[10px] font-bold text-pnu-blue">{t('courseCatalog.myMajor')}</span>
              ) : null}
            </div>
            <section className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: CARD_SHADOW }}>
              {catalogLoading && catalog.length === 0 ? <p className="p-8 text-center text-xs text-pnu-muted">{t('common.loading')}</p> : null}
              <ul className="divide-y divide-black/6">
                {catalog.map((course) => {
                  const courseId = Number(course.id)
                  const isAdded = currentCourseIds.has(courseId)
                  const languageBadgeKey = getCourseLanguageBadgeKey(course)
                  return (
                  <li key={course.id} className="flex items-center gap-2 pr-3">
                    <Link to={`/academic/recommended-courses/${course.id}?academicYear=${academicYear}&semester=${semester}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F3FF] text-pnu-blue"><BookOpen className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <CourseTypeBadge
                            type={course.type}
                            isInStudentMajor={course.isInStudentMajor}
                            showOriginalTypeForOtherMajor
                          />
                          {languageBadgeKey ? (
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">{t(languageBadgeKey)}</span>
                          ) : null}
                          {course.officialCourseNumber ? <span className="text-[10px] font-bold text-pnu-blue">{course.officialCourseNumber}</span> : null}
                        </div>
                        <span className="block truncate text-[13px] font-bold text-pnu-text">{course.nameEn || course.nameKo}</span>
                        <span className="block truncate text-[10px] text-pnu-muted">{[formatMajorName(course.majorName || course.department), `${course.credits} ${t('courses.creditsUnit')}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-pnu-muted/40" />
                    </Link>
                    {isAdded ? (
                      <button
                        type="button"
                        onClick={() => dropTimetableCourse(courseId)}
                        disabled={changingCourseId === courseId}
                        className="group inline-flex shrink-0 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title={t('academic.confirmDrop') || 'Remove from timetable'}
                      >
                        <Check className="h-3.5 w-3.5 stroke-[3] group-hover:hidden" />
                        <Trash2 className="hidden h-3.5 w-3.5 group-hover:inline" />
                        <span className="group-hover:hidden">{t('timetable.added')}</span>
                        <span className="hidden group-hover:inline">{t('common.remove') || 'Remove'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          if (course.slots && course.slots.length > 0) {
                            addCurrentCourse({
                              courseId: Number(course.id),
                              courseOfferingId: course.courseOfferingId,
                              academicYear,
                              semester,
                              slots: course.courseOfferingId ? [] : course.slots,
                            })
                          } else {
                            setSelectedCourse(course)
                          }
                        }}
                        disabled={changingCourseId === courseId}
                        className="shrink-0 rounded-xl bg-pnu-blue px-2.5 py-2 text-[10px] font-bold text-white shadow-sm transition hover:bg-pnu-blue-light disabled:opacity-50"
                      >
                        {changingCourseId === courseId ? t('common.loading') : t('courses.addCurrent')}
                      </button>
                    )}
                  </li>
                  )
                })}
              </ul>
              {catalogHasMore ? <button type="button" onClick={loadMore} disabled={catalogLoading} className="w-full border-t border-pnu-border py-3 text-xs font-bold text-pnu-blue">{catalogLoading ? t('common.loading') : t('courseCatalog.loadMore')}</button> : null}
            </section>
          </>
        ) : (
          <>
            {tab === 'past' ? (
              <div className="space-y-2">
                <button type="button" onClick={() => setShowAddPast(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-pnu-blue px-3 py-2.5 text-xs font-bold text-white"><Plus className="h-4 w-4" /> {t('courses.addPastCourse')}</button>
                <div className="rounded-[14px] border border-[#DDE4EE] bg-white p-2.5" style={{ boxShadow: CARD_SHADOW }}>
                  <label className="relative block">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pnu-muted" />
                    <input
                      value={pastQuery}
                      onChange={(event) => setPastQuery(event.target.value)}
                      placeholder={t('courses.searchPastPlaceholder')}
                      className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] py-2.5 pl-9 pr-3 text-xs outline-none focus:border-pnu-blue"
                    />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select value={pastTerm} onChange={(event) => setPastTerm(event.target.value)} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                      <option value="ALL">{t('courses.allPastTerms')}</option>
                      {pastTerms.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <select value={pastGradeFilter} onChange={(event) => setPastGradeFilter(event.target.value as 'ALL' | 'GRADED' | 'PENDING')} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                      <option value="ALL">{t('courses.allGradeStatuses')}</option>
                      <option value="GRADED">{t('courses.gradesRecorded')}</option>
                      <option value="PENDING">{t('courses.gradePending')}</option>
                    </select>
                  </div>
                  <p className="mt-2 px-0.5 text-[10px] font-semibold text-pnu-muted">
                    {t('courses.pastResults', { count: filteredPastEnrollments.length })}
                  </p>
                  <div className="mt-1 flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-700">
                    <span className="min-w-0 flex-1">{t('courses.graduationSyncHelp')}</span>
                    <Link to="/academic/credits" className="shrink-0 font-bold text-pnu-blue hover:underline">
                      {t('courses.viewGraduationProgress')}
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}
            <section className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: CARD_SHADOW }}>
              {loading ? <p className="p-8 text-center text-xs text-pnu-muted">{t('common.loading')}</p> : null}
              {!loading && visibleEnrollments.length === 0 ? <p className="p-8 text-center text-xs text-pnu-muted">{t('courses.emptyList')}</p> : null}
              <ul className="divide-y divide-black/6">
                {visibleEnrollments.map((enrollment) => {
                  const hasGrade = Boolean(enrollment.final_grade)
                  const failingGrade = ['F', 'NP', 'U'].includes(String(enrollment.final_grade || '').toUpperCase())
                  const credits = enrollment.credits_earned ?? (hasGrade && !failingGrade ? enrollment.credit ?? 0 : 0)
                  return (
                    <li key={enrollment.enrollment_id} className="flex items-center gap-1 pr-2">
                      <Link
                        to={`/academic/recommended-courses/${enrollment.catalog_course_id || enrollment.course_id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 transition active:bg-pnu-surface"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F3FF] text-pnu-blue">
                          <CalendarDays className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          {enrollment.official_course_number ? <span className="block text-[10px] font-bold text-pnu-blue">{enrollment.official_course_number}</span> : null}
                          <span className="block truncate text-[13px] font-bold text-pnu-text">
                            {enrollment.course_name_en || enrollment.course_name || t('courses.untitled')}
                          </span>
                          <span className="block truncate text-[10px] text-pnu-muted">
                            {enrollment.professor || t('courses.professorUnknown')} · {enrollment.semester}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-pnu-muted">
                            {tab === 'past' ? (
                              hasGrade ? (
                                <span className="inline-flex items-center gap-1.5 font-medium">
                                  <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                                    {enrollment.final_grade}
                                  </span>
                                  <span>· {credits} {t('courses.creditsUnit')}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                                  <span>{t('courses.gradePending') || 'Grade Pending'}</span>
                                  <span>· {t('courses.notCountedYet')}</span>
                                </span>
                              )
                            ) : (
                              formatSchedule(enrollment)
                            )}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-pnu-muted/40" />
                      </Link>

                      {tab === 'past' && !hasGrade ? (
                        <button
                          type="button"
                          onClick={() => setEditingPast(enrollment)}
                          className="shrink-0 rounded-xl bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-amber-600"
                        >
                          {t('courses.inputGrade') || 'Enter Grade'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingPast(enrollment)}
                          className="shrink-0 rounded-lg p-2 text-pnu-muted transition hover:text-pnu-blue"
                          aria-label={t('courses.editPastCourse')}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => removeCourse(enrollment)}
                        disabled={changingCourseId === Number(enrollment.course_id)}
                        className="shrink-0 rounded-lg p-2 text-red-500 transition hover:bg-red-50 disabled:opacity-40"
                        aria-label={t('courses.removeCourse')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}

        <Link to="/academic/recommended-courses" className="flex items-center gap-3 rounded-[14px] bg-white px-3 py-3" style={{ boxShadow: CARD_SHADOW }}><Sparkles className="h-5 w-5 text-[#7C3AED]" /><span className="flex-1 text-[13px] font-bold text-pnu-text">{t('courses.aiRecommendation')}</span><ChevronRight className="h-4 w-4 text-pnu-muted/40" /></Link>
      </div>

      {showAddPast ? <AddPastCourseModal existingEnrollments={enrollments} onClose={() => setShowAddPast(false)} onAdded={async () => { await loadEnrollments(); setShowAddPast(false) }} /> : null}
      {editingPast ? <EditPastCourseModal enrollment={editingPast} onClose={() => setEditingPast(null)} onSaved={async () => { await loadEnrollments(); setEditingPast(null) }} /> : null}
      {selectedCourse ? <AddTimetableModal course={selectedCourse} academicYear={academicYear} semester={semester} submitting={changingCourseId === Number(selectedCourse.id)} onClose={() => setSelectedCourse(null)} onSubmit={addCurrentCourse} /> : null}
    </div>
  )
}
