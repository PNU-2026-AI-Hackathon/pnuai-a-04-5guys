import { useMemo, useState } from 'react'
import { Award, Check, X } from 'lucide-react'
import { api } from '@/api'
import { useLanguage } from '@/context/LanguageContext'
import type { Enrollment } from '@/types/api'

const QUICK_GRADES = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0', 'P', 'F']
const OTHER_GRADES = ['NP', 'S', 'U']
const TERMS = ['Spring', 'Summer', 'Fall', 'Winter'] as const

export function EditPastCourseModal({
  enrollment,
  onClose,
  onSaved,
}: {
  enrollment: Enrollment
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useLanguage()
  const parsedSemester = enrollment.semester.match(/^(\d{4})-(Spring|Summer|Fall|Winter)$/)
  const currentYear = new Date().getFullYear()
  const initialYear = parsedSemester ? Number(parsedSemester[1]) : currentYear - 1
  const [year, setYear] = useState(initialYear)
  const [term, setTerm] = useState<(typeof TERMS)[number]>(
    parsedSemester ? parsedSemester[2] as (typeof TERMS)[number] : 'Fall',
  )
  const [finalGrade, setFinalGrade] = useState(enrollment.final_grade || '')
  const courseCredits = enrollment.credit ?? enrollment.credits_earned ?? 0
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const semester = `${year}-${term}`
  const years = useMemo(() => Array.from(new Set([
    initialYear,
    ...Array.from({ length: 10 }, (_, index) => currentYear - index),
  ])).sort((a, b) => b - a), [currentYear, initialYear])

  async function save() {
    if (!finalGrade) {
      setError(t('courses.selectGradeWarning'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const isFailing = ['F', 'NP', 'U'].includes(finalGrade)
      await api.updateEnrollment(enrollment.enrollment_id, {
        semester,
        finalGrade,
        creditsEarned: isFailing ? 0 : courseCredits,
      })
      await onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('common.errorFallback'))
    } finally {
      setSaving(false)
    }
  }

  function chooseGrade(grade: string) {
    setFinalGrade(grade)
    setError('')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-black/6 px-4 py-3.5">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-pnu-blue">
              {enrollment.official_course_number || enrollment.course_name || ''}
            </span>
            <h2 className="truncate text-[16px] font-bold text-pnu-text">
              {enrollment.course_name_en || enrollment.course_name || t('courses.untitled')}
            </h2>
            <p className="text-[11px] text-pnu-muted">
              {enrollment.professor || t('courses.professorUnknown')} · {semester}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-pnu-muted hover:bg-black/5" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between rounded-xl bg-pnu-surface px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-pnu-blue" />
              <span className="text-xs font-semibold text-pnu-text">{t('courseTable.credits')}</span>
            </div>
            <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-pnu-blue">
              {courseCredits} {t('courses.creditsUnit')} · {t('courses.autoIncluded')}
            </span>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold text-pnu-text">{t('courses.selectGrade')}</label>
            <div className="grid grid-cols-5 gap-2">
              {QUICK_GRADES.map((grade) => {
                const selected = finalGrade === grade
                const failing = grade === 'F'
                return (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => chooseGrade(grade)}
                    className={`flex h-10 items-center justify-center rounded-xl text-xs font-bold transition ${
                      selected
                        ? 'bg-pnu-blue text-white ring-2 ring-pnu-blue ring-offset-1'
                        : failing
                          ? 'border border-red-200 bg-red-50 text-red-600'
                          : 'border border-pnu-border bg-white text-pnu-text hover:border-pnu-blue/50'
                    }`}
                  >
                    {selected ? <Check className="mr-1 h-3 w-3 stroke-[3]" /> : null}
                    {grade}
                  </button>
                )
              })}
            </div>
            <label className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-pnu-muted">
              <span>{t('courses.otherGrades')}</span>
              <select
                value={OTHER_GRADES.includes(finalGrade) ? finalGrade : ''}
                onChange={(event) => event.target.value && chooseGrade(event.target.value)}
                className="min-w-[9rem] rounded-lg border border-pnu-border bg-white px-2.5 py-2 text-xs text-pnu-text"
              >
                <option value="">{t('courses.chooseOther')}</option>
                {OTHER_GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
              </select>
            </label>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-pnu-text">{t('courses.semesterTaken')}</label>
            <div className="grid grid-cols-2 gap-2">
              <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs font-medium">
                {years.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={term} onChange={(event) => setTerm(event.target.value as (typeof TERMS)[number])} className="rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs font-medium">
                {TERMS.map((item) => <option key={item} value={item}>{t(`courseCatalog.${item.toLowerCase()}`)}</option>)}
              </select>
            </div>
          </div>

          <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-700">
            {t('courses.graduationSyncHelp')}
          </p>
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}
        </div>

        <footer className="grid shrink-0 grid-cols-[0.8fr_1.2fr] gap-2 border-t border-pnu-border bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-pnu-border bg-white py-3 text-xs font-bold text-pnu-muted">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={save} disabled={saving || !finalGrade} className="rounded-xl bg-pnu-blue px-4 py-3 text-xs font-bold text-white shadow-sm disabled:opacity-40">
            {saving ? t('common.loading') : t('courses.recordGrade')}
          </button>
        </footer>
      </div>
    </div>
  )
}
