import type { CourseLanguageFilter, CourseSortKey, SortDirection } from '@/types/api'
import { useLanguage } from '@/context/LanguageContext'

interface CourseListControlsProps {
  language: CourseLanguageFilter
  sortBy: CourseSortKey
  direction: SortDirection
  onLanguageChange: (value: CourseLanguageFilter) => void
  onSortChange: (value: CourseSortKey) => void
  onDirectionChange: (value: SortDirection) => void
  allowRelevance?: boolean
  allowCode?: boolean
}

const selectClassName = 'w-full rounded-xl border border-pnu-border bg-[#FAFBFD] px-3 py-2.5 text-xs text-pnu-text outline-none transition focus:border-pnu-blue-light focus:ring-2 focus:ring-pnu-blue-light/20'
const labelClassName = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-pnu-muted'

export function CourseListControls({
  language,
  sortBy,
  direction,
  onLanguageChange,
  onSortChange,
  onDirectionChange,
  allowRelevance = false,
  allowCode = true,
}: CourseListControlsProps) {
  const { t } = useLanguage()
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2 min-w-0">
        <span className={labelClassName}>{t('courseCatalog.languageFilter')}</span>
        <select value={language} onChange={(event) => onLanguageChange(event.target.value as CourseLanguageFilter)} className={selectClassName}>
          <option value="ALL">{t('courseCatalog.allLanguages')}</option>
          <option value="ENGLISH">{t('courseOffering.englishTaught')}</option>
          <option value="KOREAN">{t('courseOffering.korean')}</option>
          <option value="MIXED">{t('courseOffering.mixedLanguage')}</option>
          <option value="OTHER">{t('courseOffering.otherLanguage')}</option>
          <option value="UNKNOWN">{t('courseCatalog.languageUnknown')}</option>
        </select>
      </label>
      <label className="min-w-0">
        <span className={labelClassName}>{t('courseCatalog.sortBy')}</span>
        <select value={sortBy} onChange={(event) => onSortChange(event.target.value as CourseSortKey)} className={selectClassName}>
          {allowRelevance ? <option value="RELEVANCE">{t('courseCatalog.sortRelevance')}</option> : null}
          <option value="NAME">{t('courseCatalog.sortName')}</option>
          <option value="CREDITS">{t('courseCatalog.sortCredits')}</option>
          {allowCode ? <option value="CODE">{t('courseCatalog.sortCode')}</option> : null}
        </select>
      </label>
      <label className="min-w-0">
        <span className={labelClassName}>{t('courseCatalog.sortDirection')}</span>
        <select value={direction} onChange={(event) => onDirectionChange(event.target.value as SortDirection)} className={selectClassName}>
          <option value="ASC">{t('courseCatalog.ascending')}</option>
          <option value="DESC">{t('courseCatalog.descending')}</option>
        </select>
      </label>
    </div>
  )
}
