import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, Check, RotateCcw, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { api } from '@/api'
import type { CourseCatalogItem, CourseLanguageFilter, CourseSortKey, CourseType, CreateTimetableEntryInput, RecommendedCourse, SortDirection } from '@/types/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { AddTimetableModal } from '@/components/schedule/AddTimetableModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { CourseTypeBadge } from '@/components/ui/Badge'
import { CourseTermSelector } from '@/components/courses/CourseTermSelector'
import { CourseListControls } from '@/components/courses/CourseListControls'
import { useAuth } from '@/context/AuthContext'
import { currentCourseTerm, enrollmentSemester, type CourseTerm } from '@/utils/courseTerm'
import {
  getVerifiedCourseOfferingDisplay,
} from '@/utils/courseOfferingDisplay'
import { formatMajorName } from '@/utils/formatMajor'
import { filterAndSortCourses } from '@/utils/courseList'

export function RecommendedCoursesPage() {
  const { language, t } = useLanguage()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [courses, setCourses] = useState<RecommendedCourse[]>([])
  const [selectedCourse, setSelectedCourse] = useState<CourseCatalogItem | null>(null)
  const [addedCourseIds, setAddedCourseIds] = useState<Set<number>>(new Set())
  const [actionCourseId, setActionCourseId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<CourseType | 'ALL'>('ALL')
  const [languageFilter, setLanguageFilter] = useState<CourseLanguageFilter>('ALL')
  const [sortBy, setSortBy] = useState<CourseSortKey>('RELEVANCE')
  const [sortDirection, setSortDirection] = useState<SortDirection>('DESC')
  const [term, setTerm] = useState<CourseTerm>(() => currentCourseTerm())
  const [enrolledCourseIds, setEnrolledCourseIds] = useState<Set<number>>(new Set())

  const academicYear = term.academicYear
  const semester = term.semester

  useEffect(() => {
    Promise.all([
      api.getRecommendedCourses('ALL', { academicYear, semester }),
      api.getTimetable({ academicYear, semester }),
      user ? api.getEnrollments(user.studentId) : Promise.resolve([]),
    ])
      .then(([items, timetable, enrollments]) => {
        setCourses(items)
        setAddedCourseIds(new Set(timetable.map((entry) => Number(entry.course_id))))
        setEnrolledCourseIds(new Set(enrollments
          .filter((entry) => entry.status !== 'Completed' && entry.semester === enrollmentSemester({ academicYear, semester }))
          .map((entry) => Number(entry.catalog_course_id || entry.course_id))))
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('academic.loadError')))
      .finally(() => setLoading(false))
  }, [academicYear, language, semester, t, user])

  async function openTimetableModal(course: RecommendedCourse) {
    setActionCourseId(Number(course.id))
    setError('')
    try {
      const detail = await api.getCourseCatalog({
        courseId: course.id,
        pageSize: 1,
        academicYear,
        semester,
      })
      const catalogCourse = detail.items[0]
      if (!catalogCourse) throw new Error(t('academic.loadError'))
      setSelectedCourse(catalogCourse)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('academic.loadError'))
    } finally {
      setActionCourseId(null)
    }
  }

  async function addToTimetable(data: CreateTimetableEntryInput) {
    setActionCourseId(data.courseId)
    let createdEnrollmentId: number | null = null
    try {
      if (user && !enrolledCourseIds.has(data.courseId)) {
        const enrollment = await api.createEnrollment(user.studentId, data.courseId, enrollmentSemester(term))
        createdEnrollmentId = enrollment.enrollment_id
      }
      try {
        await api.createTimetableEntry(data)
      } catch (reason) {
        if (createdEnrollmentId != null) await api.deleteEnrollment(createdEnrollmentId).catch(() => undefined)
        throw reason
      }
      setAddedCourseIds((current) => new Set(current).add(data.courseId))
      setEnrolledCourseIds((current) => new Set(current).add(data.courseId))
      setSelectedCourse(null)
      showToast(t('timetable.added'), 'success')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('academic.loadError'))
    } finally {
      setActionCourseId(null)
    }
  }

  async function dropFromTimetable(courseId: number) {
    if (!window.confirm(t('academic.confirmDrop') || 'Remove this course from your timetable?')) return
    setActionCourseId(courseId)
    setError('')
    try {
      await api.deleteTimetableCourse(courseId)
      setAddedCourseIds((current) => {
        const next = new Set(current)
        next.delete(courseId)
        return next
      })
      setEnrolledCourseIds((current) => {
        const next = new Set(current)
        next.delete(courseId)
        return next
      })
      showToast(t('timetable.removed') || 'Course removed from timetable', 'info')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('academic.loadError'))
    } finally {
      setActionCourseId(null)
    }
  }

  const recommendedCourses = useMemo(() => filterAndSortCourses(
    courses.filter((course) => (
      course.score > 0
      && (typeFilter === 'ALL' || course.type === typeFilter)
    )),
    languageFilter,
    sortBy,
    sortDirection,
  ), [courses, languageFilter, sortBy, sortDirection, typeFilter])

  function resetFilters() {
    setTypeFilter('ALL')
    setLanguageFilter('ALL')
    setSortBy('RELEVANCE')
    setSortDirection('DESC')
    setTerm(currentCourseTerm())
  }

  return (
    <div>
      <PageHeader title={t('academic.recommendedCourses')} subtitle={t('academic.recommendationHint')} back />

      <div className="space-y-3 px-5 py-5">
        <section className="overflow-hidden rounded-[18px] border border-[#DDE4EE] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-3 border-b border-[#E7ECF3] bg-gradient-to-r from-[#F4F8FF] to-white px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-pnu-blue text-white">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[13px] font-bold text-pnu-text">{t('courseCatalog.recommendationFiltersTitle')}</h2>
                <p className="mt-0.5 text-[10px] leading-relaxed text-pnu-muted">{t('courseCatalog.recommendationFiltersHint')}</p>
              </div>
            </div>
            <button type="button" onClick={resetFilters} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#D8E0EB] bg-white px-2 py-1.5 text-[10px] font-bold text-pnu-blue transition hover:bg-[#F4F8FF]">
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t('courseCatalog.resetFilters')}
            </button>
          </div>
          <div className="space-y-3 p-3">
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('courseCatalog.termSelector')}</p>
              <CourseTermSelector value={term} onChange={setTerm} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted">{t('courseCatalog.categoryFilter')}</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as CourseType | 'ALL')} className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20">
                <option value="ALL">{t('courseFilter.all')}</option>
                <option value="REQUIRED">{t('courseFilter.required')}</option>
                <option value="ELECTIVE">{t('courseFilter.elective')}</option>
                <option value="GEN_ED">{t('courseFilter.genEd')}</option>
              </select>
            </label>
            <CourseListControls
              language={languageFilter}
              sortBy={sortBy}
              direction={sortDirection}
              onLanguageChange={setLanguageFilter}
              onSortChange={setSortBy}
              onDirectionChange={setSortDirection}
              allowRelevance
              allowCode={false}
            />
          </div>
        </section>
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        {loading ? <p className="text-sm text-pnu-muted">{t('academic.loading')}</p> : null}
        {!loading && recommendedCourses.length === 0 && !error ? (
          <p className="text-sm text-pnu-muted">{t('academic.noCourses')}</p>
        ) : null}

        {recommendedCourses.map((course) => {
          const offering = getVerifiedCourseOfferingDisplay(course)
          return (
          <article key={course.id} className="rounded-2xl border border-pnu-border bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 shrink-0 text-pnu-blue-light" aria-hidden="true" />
                  <Link
                    to={`/academic/recommended-courses/${course.id}`}
                    className="text-sm font-bold text-pnu-text hover:text-pnu-blue-light"
                  >
                    {course.nameEn}
                  </Link>
                </div>
                <p className="mt-1 text-sm text-pnu-muted">{course.nameKo}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex flex-wrap justify-end gap-1">
                  <CourseTypeBadge type={course.type} isInStudentMajor={course.isInStudentMajor} />
                  {offering.languageBadgeKey ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700">
                      {t(offering.languageBadgeKey)}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs font-semibold text-pnu-blue-light">{course.score}% match</span>
              </div>
            </div>
            {offering.officialCourseNumber || offering.section ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-pnu-muted">
                {offering.officialCourseNumber ? <span>{offering.officialCourseNumber}</span> : null}
                {offering.term ? <span>{offering.term}</span> : null}
                {offering.section ? <span>{t('courseOffering.section', { section: offering.section })}</span> : null}
              </div>
            ) : null}
            {offering.professor || offering.schedule || offering.remoteStatusKey ? (
              <div className="mt-3 space-y-1 rounded-xl bg-pnu-surface px-3 py-2 text-xs text-pnu-muted">
                {offering.professor ? (
                  <p>{t('courseOffering.professor', { professor: offering.professor })}</p>
                ) : null}
                {offering.schedule ? (
                  <p>{t('courseOffering.schedule', { schedule: offering.schedule })}</p>
                ) : null}
                {offering.remoteStatusKey ? <p>{t(offering.remoteStatusKey)}</p> : null}
              </div>
            ) : null}
            {offering.hasAssessmentMetadata ? (
              <div className="mt-3 space-y-2 rounded-xl border border-pnu-border bg-white px-3 py-2 text-xs text-pnu-muted">
                <div className="flex flex-wrap gap-1.5">
                  {offering.presentationRequirementKey ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
                      {t(offering.presentationRequirementKey)}
                    </span>
                  ) : null}
                  {offering.groupProjectRequirementKey ? (
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-800">
                      {t(offering.groupProjectRequirementKey)}
                    </span>
                  ) : null}
                  {offering.assignmentRequirementKey ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
                      {t(offering.assignmentRequirementKey)}
                    </span>
                  ) : null}
                </div>
                {offering.examInformation ? (
                  <p>{t('courseMetadata.examInformation', { information: offering.examInformation })}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-pnu-muted">
              <span>{t('course.credits', { count: course.credits })}</span>
              {course.majorName || course.department ? (
                <>
                  <span aria-hidden="true">&middot;</span>
                  <span>{formatMajorName(course.majorName || course.department)}</span>
                </>
              ) : null}
            </div>
            {course.matchHint ? (
              <p className="mt-3 text-sm text-pnu-muted">{course.matchHint}</p>
            ) : null}
            {addedCourseIds.has(Number(course.id)) ? (
              <button
                type="button"
                onClick={() => dropFromTimetable(Number(course.id))}
                disabled={actionCourseId === Number(course.id)}
                className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                title={t('academic.confirmDrop') || 'Remove from timetable'}
              >
                <Check className="h-4 w-4 stroke-[3] group-hover:hidden" />
                <Trash2 className="hidden h-4 w-4 group-hover:inline" />
                <span className="group-hover:hidden">{t('timetable.added')}</span>
                <span className="hidden group-hover:inline">{t('common.remove') || 'Remove from Timetable'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openTimetableModal(course)}
                disabled={actionCourseId === Number(course.id)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-pnu-blue px-3 py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.99] hover:bg-pnu-blue-light disabled:opacity-50"
              >
                <CalendarPlus className="h-4 w-4" />
                {actionCourseId === Number(course.id) ? t('common.loading') : t('academic.addToTimetable')}
              </button>
            )}
          </article>
          )
        })}
      </div>
      {selectedCourse ? (
        <AddTimetableModal
          course={selectedCourse}
          academicYear={academicYear}
          semester={semester}
          submitting={actionCourseId === Number(selectedCourse.id)}
          onClose={() => setSelectedCourse(null)}
          onSubmit={addToTimetable}
        />
      ) : null}
    </div>
  )
}

