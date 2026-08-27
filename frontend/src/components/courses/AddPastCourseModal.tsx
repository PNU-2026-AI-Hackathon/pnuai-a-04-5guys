import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Search, X } from 'lucide-react'
import { api } from '@/api'
import { useLanguage } from '@/context/LanguageContext'
import type { CourseCatalogItem, Enrollment } from '@/types/api'
import { formatMajorName } from '@/utils/formatMajor'

interface AddPastCourseModalProps {
  existingEnrollments: Enrollment[]
  onClose: () => void
  onAdded: () => void | Promise<void>
}

export function AddPastCourseModal({
  existingEnrollments,
  onClose,
  onAdded,
}: AddPastCourseModalProps) {
  const { t } = useLanguage()
  const [now] = useState(() => new Date())
  const defaultTerm = now.getMonth() + 1 >= 7 ? 'Spring' : 'Fall'
  const defaultYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1
  const [query, setQuery] = useState('')
  const [courses, setCourses] = useState<CourseCatalogItem[]>([])
  const [year, setYear] = useState(defaultYear)
  const [term, setTerm] = useState(defaultTerm)
  const [finalGrade, setFinalGrade] = useState('')
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const years = useMemo(
    () => Array.from({ length: 10 }, (_, index) => now.getFullYear() - index),
    [now],
  )

  const uniqueCourses = useMemo(() => {
    const seen = new Set<string>()
    return courses.filter((course) => {
      const identity = String(
        course.officialCourseNumber
        || `${course.nameKo}|${course.nameEn}|${course.credits}`,
      ).trim().toLowerCase()
      if (seen.has(identity)) return false
      seen.add(identity)
      return true
    })
  }, [courses])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const result = await api.getCourseCatalog({
          page: 1,
          pageSize: 100,
          search: query,
          myMajor: query.trim().length === 0,
          sortBy: 'NAME',
          sortDirection: 'ASC',
          academicYear: now.getFullYear(),
          semester: now.getMonth() + 1 >= 7 ? '2' : '1',
        })
        setCourses(result.items)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('academic.loadError'))
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [now, query, t])

  async function addCourse(course: CourseCatalogItem) {
    setAddingId(course.id)
    setError('')
    try {
      await api.addPastCourse(Number(course.id), `${year}-${term}`, {
        finalGrade: finalGrade || null,
        creditsEarned: finalGrade
          ? (['F', 'NP', 'U'].includes(finalGrade) ? 0 : course.credits)
          : null,
      })
      await onAdded()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.errorFallback'))
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/35 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-pnu-border px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-pnu-text">{t('courses.addPastCourse')}</h2>
            <p className="text-xs text-pnu-muted">{t('courses.addPastCourseHelp')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-black/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-4 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pnu-muted">{t('courseCatalog.academicYear')}</span>
              <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-sm">
                {years.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pnu-muted">{t('courseCatalog.semester')}</span>
              <select value={term} onChange={(event) => setTerm(event.target.value)} className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-sm">
                {['Spring', 'Summer', 'Fall', 'Winter'].map((item) => <option key={item} value={item}>{t(`courseCatalog.${item.toLowerCase()}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-pnu-muted">{t('courses.finalGrade')}</span>
            <select value={finalGrade} onChange={(event) => setFinalGrade(event.target.value)} className="w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-sm" aria-label={t('courses.finalGrade')}>
              <option value="">{t('courses.gradeUnknown')}</option>
              {['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'F', 'P', 'NP', 'S', 'U'].map((grade) => <option key={grade}>{grade}</option>)}
            </select>
            <span className="mt-1.5 flex items-center gap-1 text-[10px] text-pnu-muted">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              {finalGrade ? t('courses.gradeAutoCredits') : t('courses.pendingDoesNotCount')}
            </span>
          </label>
        </div>

        <div className="relative px-4 py-3">
          <Search className="absolute left-7 top-6 h-4 w-4 text-pnu-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('courseCatalog.searchPlaceholder')}
            className="w-full rounded-xl border border-pnu-border py-2 pl-9 pr-3 text-sm"
          />
        </div>
        {error ? <p className="mx-4 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}

        <div className="flex items-center justify-between border-t border-pnu-border px-4 py-2 text-[10px] font-semibold text-pnu-muted">
          <span>{t('courses.catalogMatches', { count: uniqueCourses.length })}</span>
          {!query.trim() ? <span>{t('courseCatalog.myMajor')}</span> : null}
        </div>

        <div className="max-h-[45vh] overflow-y-auto border-t border-pnu-border">
          {loading ? <p className="p-6 text-center text-sm text-pnu-muted">{t('common.loading')}</p> : null}
          {!loading && uniqueCourses.length === 0 ? <p className="p-8 text-center text-sm text-pnu-muted">{t('courses.noCatalogMatches')}</p> : null}
          {!loading && uniqueCourses.map((course) => {
            const exists = existingEnrollments.some((item) =>
              Number(item.catalog_course_id || item.course_id) === Number(course.id)
              && item.semester === `${year}-${term}`)
            return (
              <div key={course.id} className="flex items-center gap-3 border-b border-pnu-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-pnu-blue">
                    {course.officialCourseNumber || course.nameKo || ''}
                  </p>
                  <p className="truncate text-sm font-bold text-pnu-text">{course.nameEn || course.nameKo}</p>
                  <p className="truncate text-xs text-pnu-muted">
                    {[formatMajorName(course.majorName || course.department), `${course.credits} ${t('courses.creditsUnit')}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={exists || addingId === course.id}
                  onClick={() => addCourse(course)}
                  className="rounded-xl bg-pnu-blue px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"
                >
                  {exists ? t('courses.alreadyAdded') : addingId === course.id ? t('common.loading') : t('common.add')}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
