import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import type {
  CourseType,
  CourseLanguageFilter,
  CourseSortKey,
  SortDirection,
  CourseCatalogItem,
  GraduationProgress,
  TimetableEntry,
  CreateTimetableEntryInput,
} from '@/types/api'
import { useAuth } from '@/context/AuthContext'
import { useLanguage } from '@/context/LanguageContext'
import { CourseCard } from '@/components/courses/CourseCard'
import { CourseFilters } from '@/components/courses/CourseFilters'
import { CourseTermSelector } from '@/components/courses/CourseTermSelector'
import { CourseListControls } from '@/components/courses/CourseListControls'
import { GraduationCard } from '@/components/graduation/GraduationCard'
import { DateStrip } from '@/components/schedule/DateStrip'
import { DayClassList } from '@/components/schedule/DayClassList'
import { AssignmentsExamsRow } from '@/components/schedule/AssignmentsExamsRow'
import { AddTimetableModal } from '@/components/schedule/AddTimetableModal'
import { MonthCalendar } from '@/components/schedule/MonthCalendar'
import { MonthDaySchedule } from '@/components/schedule/MonthDaySchedule'
import { WeeklyTimetableGrid } from '@/components/schedule/WeeklyTimetableGrid'
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronRight,
  Info,
  List,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  getClassDayNumbers,
  getClassesForDay,
  getScheduleSlots,
  getWeekdayOptions,
  slotsOverlap,
  toTimetableDay,
} from '@/utils/timetable'
import { currentCourseTerm, enrollmentSemester, type CourseTerm } from '@/utils/courseTerm'

const CARD_SHADOW = '0 10px 28px rgba(15,23,42,0.06)'

export function AcademicPage() {
  const { user } = useAuth()
  const { locale, t } = useLanguage()
  const [viewTab, setViewTab] = useState<'CURRICULUM' | 'TIMETABLE'>('TIMETABLE')
  const [allFilter, setAllFilter] = useState<CourseType | 'ALL'>('ALL')
  const [catalogLanguage, setCatalogLanguage] = useState<CourseLanguageFilter>('ALL')
  const [catalogSort, setCatalogSort] = useState<Exclude<CourseSortKey, 'RELEVANCE'>>('NAME')
  const [catalogDirection, setCatalogDirection] = useState<SortDirection>('ASC')
  const [allCourses, setAllCourses] = useState<CourseCatalogItem[]>([])
  const [progress, setProgress] = useState<GraduationProgress | null>(null)
  const [enrollments, setEnrollments] = useState<TimetableEntry[]>([])
  const [enrolledCourseIds, setEnrolledCourseIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [collisionError, setCollisionError] = useState<string | null>(null)
  const [now] = useState(() => new Date())
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [monthView, setMonthView] = useState(false)
  const [scheduleLayout, setScheduleLayout] = useState<'DAILY' | 'GRID'>('GRID')
  const [term, setTerm] = useState<CourseTerm>(() => currentCourseTerm())
  const [search, setSearch] = useState('')
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState<CourseCatalogItem | null>(null)
  const academicYear = term.academicYear
  const semester = term.semester

  const weekDays = useMemo(() => getWeekdayOptions(anchorDate), [anchorDate])

  const classDays = useMemo(
    () =>
      getClassDayNumbers(
        enrollments,
        anchorDate.getFullYear(),
        anchorDate.getMonth(),
      ),
    [enrollments, anchorDate],
  )

  function selectCalendarDate(date: Date) {
    const next = new Date(date)
    next.setHours(12, 0, 0, 0)
    setAnchorDate(next)
  }

  function shiftWeek(delta: number) {
    const next = new Date(anchorDate)
    next.setDate(next.getDate() + delta * 7)
    selectCalendarDate(next)
  }

  function shiftMonth(delta: number) {
    const base = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + delta, 1)
    const keepDay = Math.min(
      anchorDate.getDate(),
      new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate(),
    )
    selectCalendarDate(new Date(base.getFullYear(), base.getMonth(), keepDay))
  }

  const fetchData = async () => {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      const [graduation, timetable, courseEnrollments] = await Promise.all([
        api.getGraduationProgress(),
        api.getTimetable({ academicYear, semester }),
        api.getEnrollments(user.studentId),
      ])
      setProgress(graduation)
      setEnrollments(timetable)
      const termLabel = enrollmentSemester({ academicYear, semester })
      setEnrolledCourseIds(new Set(
        courseEnrollments
          .filter((entry) => entry.status !== 'Completed' && entry.semester === termLabel)
          .map((entry) => Number(entry.catalog_course_id || entry.course_id)),
      ))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('academic.loadError')
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academicYear, semester, user])

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(async () => {
      setCatalogLoading(true)
      try {
        const result = await api.getCourseCatalog({
          page: 1,
          pageSize: 50,
          search,
          myMajor: allFilter === '전공',
          category: allFilter,
          academicYear,
          semester,
          languageFilter: catalogLanguage,
          sortBy: catalogSort,
          sortDirection: catalogDirection,
        })
        setAllCourses(result.items)
        setCatalogPage(result.page)
        setCatalogTotal(result.total)
        setCatalogHasMore(result.hasMore)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t('academic.loadError'))
      } finally {
        setCatalogLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [user, search, allFilter, academicYear, semester, catalogDirection, catalogLanguage, catalogSort, t])

  const selectedDate = useMemo(() => {
    const d = new Date(anchorDate)
    d.setHours(0, 0, 0, 0)
    return d
  }, [anchorDate])

  const timetableDay = toTimetableDay(selectedDate.getDay())

  const dayClasses = useMemo(
    () =>
      timetableDay === 0
        ? []
        : getClassesForDay(enrollments, timetableDay, selectedDate, now),
    [enrollments, timetableDay, selectedDate, now],
  )
  const timetableCredits = useMemo(
    () => enrollments.reduce((total, entry) => total + (Number(entry.credit) || 0), 0),
    [enrollments],
  )

  const handleAddToTimetable = async (data: CreateTimetableEntryInput) => {
    if (!user) return
    setCollisionError(null)
    setSubmittingId(data.courseId)

    const selectedOfferingSlots = selectedCourse?.slots || []
    const proposedSlots = data.slots?.length ? data.slots : selectedOfferingSlots
    const conflict = enrollments.find((entry) =>
      getScheduleSlots(entry).some((existingSlot) =>
        proposedSlots.some((proposedSlot) => slotsOverlap(existingSlot, proposedSlot)),
      ),
    )
    if (conflict) {
      setCollisionError(`${t('academic.conflictMessage')} (${conflict.course_name})`)
      setSubmittingId(null)
      return
    }

    let createdEnrollmentId: number | null = null
    try {
      if (!enrolledCourseIds.has(data.courseId)) {
        const enrollment = await api.createEnrollment(
          user.studentId,
          data.courseId,
          enrollmentSemester({ academicYear, semester }),
        )
        createdEnrollmentId = enrollment.enrollment_id
      }
      let newTimetableEntry: TimetableEntry
      try {
        newTimetableEntry = await api.createTimetableEntry(data)
      } catch (reason) {
        if (createdEnrollmentId != null) {
          await api.deleteEnrollment(createdEnrollmentId).catch(() => undefined)
        }
        throw reason
      }
      setEnrollments((prev) => [...prev, newTimetableEntry])
      setEnrolledCourseIds((current) => new Set(current).add(data.courseId))
      setSelectedCourse(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add course.'
      setCollisionError(message)
    } finally {
      setSubmittingId(null)
    }
  }

  const handleDropFromTimetable = async (enrollmentId: number) => {
    if (!window.confirm(t('academic.confirmDrop'))) return
    const removed = enrollments.find((entry) => entry.enrollment_id === enrollmentId)
    setLoading(true)
    try {
      await api.deleteTimetableEntry(enrollmentId)
      setEnrollments((prev) => prev.filter((entry) => entry.enrollment_id !== enrollmentId))
      if (removed) {
        setEnrolledCourseIds((current) => {
          const next = new Set(current)
          next.delete(Number(removed.course_id))
          return next
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to drop course.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const profileIncomplete = !user?.major
  const enrollmentForCourse = (courseId: string) =>
    enrollments.find((e) => Number(e.course_id) === Number(courseId))

  const dayLabel = selectedDate.toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  async function loadMoreCourses() {
    const nextPage = catalogPage + 1
    setCatalogLoading(true)
    try {
      const result = await api.getCourseCatalog({
        page: nextPage,
        pageSize: 50,
        search,
        myMajor: allFilter === '전공',
        category: allFilter,
        academicYear,
        semester,
        languageFilter: catalogLanguage,
        sortBy: catalogSort,
        sortDirection: catalogDirection,
      })
      setAllCourses((current) => [...current, ...result.items])
      setCatalogPage(result.page)
      setCatalogHasMore(result.hasMore)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('academic.loadError'))
    } finally {
      setCatalogLoading(false)
    }
  }

  return (
    <div className="pb-8">
      {viewTab === 'TIMETABLE' ? (
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold tracking-tight text-pnu-text">
              {t('schedule.title')}
            </h1>
          </div>
          <Link
            to="/academic-calendar"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-pnu-blue/10 px-3 py-2 text-[12px] font-semibold text-pnu-blue transition active:scale-[0.98]"
          >
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="max-w-[7.5rem] truncate">{t('home.academicCalendar')}</span>
            <ChevronRight className="h-3.5 w-3.5 opacity-70" strokeWidth={2.2} />
          </Link>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-pnu-text">
              {t('academic.curriculum')}
            </h1>
            <p className="mt-0.5 text-[12px] font-medium text-pnu-muted">
              {t('academic.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setViewTab('TIMETABLE')}
            className="inline-flex items-center gap-1 rounded-full bg-pnu-blue/10 px-3 py-1.5 text-[12px] font-semibold text-pnu-blue"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {t('schedule.title')}
          </button>
        </div>
      )}

      <div className="mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-black/5">
        <button
          type="button"
          onClick={() => setViewTab('TIMETABLE')}
          className={`rounded-lg px-2 py-2 text-[11px] font-bold ${viewTab === 'TIMETABLE' ? 'bg-pnu-blue text-white' : 'text-pnu-muted'}`}
        >
          {t('schedule.title')}
        </button>
        <button
          type="button"
          onClick={() => setViewTab('CURRICULUM')}
          className={`rounded-lg px-2 py-2 text-[11px] font-bold ${viewTab === 'CURRICULUM' ? 'bg-pnu-blue text-white' : 'text-pnu-muted'}`}
        >
          {t('academic.allCourses')}
        </button>
        <Link
          to="/academic/recommended-courses"
          className="flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-[11px] font-bold text-pnu-muted"
        >
          <Sparkles className="h-3 w-3" />
          AI
        </Link>
      </div>

      <div className="space-y-4 px-4 py-4">
        {viewTab === 'TIMETABLE' ? (
          <div className="space-y-2">
          <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">
              {t('schedule.scheduleTerm')}
            </p>
            <CourseTermSelector value={term} onChange={setTerm} />
          </div>
          <div className="grid grid-cols-2 rounded-xl bg-white p-1 ring-1 ring-black/5">
            <button
              type="button"
              onClick={() => setScheduleLayout('DAILY')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold ${scheduleLayout === 'DAILY' ? 'bg-pnu-blue text-white' : 'text-pnu-muted'}`}
            >
              <List className="h-3.5 w-3.5" />
              {t('schedule.dailyView')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMonthView(false)
                setScheduleLayout('GRID')
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold ${scheduleLayout === 'GRID' ? 'bg-pnu-blue text-white' : 'text-pnu-muted'}`}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              {t('schedule.weeklyView')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-black/5">
              <p className="text-[10px] font-semibold text-pnu-muted">{t('schedule.plannedCourses')}</p>
              <p className="text-lg font-bold text-pnu-text">{enrollments.length}</p>
            </div>
            <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-black/5">
              <p className="text-[10px] font-semibold text-pnu-muted">{t('schedule.plannedCredits')}</p>
              <p className="text-lg font-bold text-pnu-text">{timetableCredits}</p>
            </div>
          </div>
          </div>
        ) : null}
        {profileIncomplete ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <span>{t('academic.profileIncomplete')}</span>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        ) : null}

        {collisionError ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="flex-1">
              <p className="font-bold">{t('academic.conflictTitle')}</p>
              <p className="mt-0.5 text-xs font-medium text-rose-600">
                {collisionError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCollisionError(null)}
              className="rounded border border-rose-300 px-1.5 py-0.5 text-xs font-semibold text-rose-800"
            >
              {t('common.clear')}
            </button>
          </div>
        ) : null}

        {loading || (viewTab === 'CURRICULUM' && catalogLoading && allCourses.length === 0) ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-pnu-muted">
            <RefreshCw className="h-6 w-6 animate-spin text-pnu-blue" />
            <p className="text-sm font-medium">{t('academic.loading')}</p>
          </div>
        ) : null}

        {!loading && viewTab === 'CURRICULUM' ? (
          <div className="space-y-6">
            {progress ? (
              <section className="rounded-2xl border border-pnu-border bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-pnu-text">
                  {t('academic.completedCredits')}
                </h3>
                <GraduationCard progress={progress} />
              </section>
            ) : null}

            <section className="space-y-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold tracking-tight text-pnu-text">
                    {t('academic.allCourses')}
                  </h3>
                  <p className="text-xs text-pnu-muted">{t('courseCatalog.total', { count: catalogTotal })}</p>
                </div>
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-pnu-border bg-white px-3 py-2.5">
                <Search className="h-4 w-4 text-pnu-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('courseCatalog.searchPlaceholder')}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <CourseFilters value={allFilter} onChange={setAllFilter} />
              <div className="rounded-2xl border border-pnu-border bg-white p-3 shadow-sm">
                <CourseListControls
                  language={catalogLanguage}
                  sortBy={catalogSort}
                  direction={catalogDirection}
                  onLanguageChange={setCatalogLanguage}
                  onSortChange={(value) => setCatalogSort(value === 'RELEVANCE' ? 'NAME' : value)}
                  onDirectionChange={setCatalogDirection}
                />
              </div>

              {allCourses.length === 0 ? (
                <p className="py-4 text-sm text-pnu-muted">{t('academic.noCourses')}</p>
              ) : null}

              <div className="space-y-3.5">
                {allCourses.map((course) => {
                  const enrollment = enrollmentForCourse(course.id)
                  return (
                    <CourseCard
                      key={`all-${course.id}`}
                      course={course}
                      action={
                        enrollment ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleDropFromTimetable(enrollment.enrollment_id)
                            }
                            className="inline-flex items-center gap-1 rounded-xl border border-emerald-100/60 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-600"
                          >
                            <Check className="h-3.5 w-3.5 stroke-[3]" />
                            {t('timetable.added')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (course.slots && course.slots.length > 0) {
                                handleAddToTimetable({
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
                            disabled={submittingId === Number(course.id)}
                            className="flex items-center justify-center gap-1 rounded-xl bg-pnu-blue p-2 text-xs font-bold text-white shadow-md transition-all hover:bg-pnu-blue-light active:scale-95 disabled:opacity-50"
                          >
                            <Plus className="h-4 w-4" />
                            {t('academic.addToTimetable')}
                          </button>
                        )
                      }
                    />
                  )
                })}
              </div>
              {catalogHasMore ? (
                <button
                  type="button"
                  onClick={loadMoreCourses}
                  disabled={catalogLoading}
                  className="w-full rounded-xl border border-pnu-blue py-3 text-sm font-bold text-pnu-blue disabled:opacity-50"
                >
                  {catalogLoading ? t('common.loading') : t('courseCatalog.loadMore')}
                </button>
              ) : null}
            </section>
          </div>
        ) : null}

        {!loading && viewTab === 'TIMETABLE' && scheduleLayout === 'DAILY' ? (
          <div className="space-y-3.5">
            <DateStrip
              days={weekDays}
              selectedDate={selectedDate}
              locale={locale}
              monthView={monthView}
              onSelectDate={selectCalendarDate}
              onShiftWeek={shiftWeek}
              onToggleMonthView={() => setMonthView((open) => !open)}
            />

            {monthView ? (
              <>
                <MonthCalendar
                  year={anchorDate.getFullYear()}
                  month={anchorDate.getMonth()}
                  selectedDate={selectedDate}
                  classDays={classDays}
                  onSelectDate={selectCalendarDate}
                  onShiftMonth={shiftMonth}
                />
                <MonthDaySchedule
                  date={selectedDate}
                  classes={dayClasses}
                  locale={locale}
                  onViewFullSchedule={() => setMonthView(false)}
                />
              </>
            ) : (
              <section
                className="rounded-[20px] bg-white px-3.5 py-3.5 ring-1 ring-black/5"
                style={{ boxShadow: CARD_SHADOW }}
              >
                <div className="mb-1 flex items-center gap-2 px-0.5">
                  <CalendarDays className="h-4 w-4 shrink-0 text-pnu-blue" strokeWidth={2} />
                  <h2 className="text-[14px] font-bold tracking-tight text-pnu-text">
                    {dayLabel}
                  </h2>
                </div>

                <DayClassList classes={dayClasses} embedded onDrop={handleDropFromTimetable} />
                <AssignmentsExamsRow embedded />
              </section>
            )}
          </div>
        ) : null}

        {!loading && viewTab === 'TIMETABLE' && scheduleLayout === 'GRID' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-pnu-border bg-white px-3 py-2.5">
              <div>
                <p className="text-[10px] font-semibold text-pnu-muted">{t('schedule.semesterTimetable')}</p>
                <p className="text-sm font-bold text-pnu-text">{enrollmentSemester(term)}</p>
              </div>
            </div>
            <WeeklyTimetableGrid
              entries={enrollments}
              locale={locale}
              onDrop={handleDropFromTimetable}
            />
          </div>
        ) : null}
      </div>
      {selectedCourse ? (
        <AddTimetableModal
          course={selectedCourse}
          academicYear={academicYear}
          semester={semester}
          submitting={submittingId === Number(selectedCourse.id)}
          onClose={() => setSelectedCourse(null)}
          onSubmit={handleAddToTimetable}
        />
      ) : null}
    </div>
  )
}
