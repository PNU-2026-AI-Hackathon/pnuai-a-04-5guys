import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bookmark,
  ChevronRight,
  ExternalLink,
  Flame,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { api } from '@/api'
import type { ProgramItem } from '@/types/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { useLanguage } from '@/context/LanguageContext'
import { getProgramIconForItem } from '@/utils/programIcons'

const CARD_SHADOW = '0 8px 24px rgba(15,23,42,0.06)'
const RECOMMENDED_LIMIT = 3

type AiProgramItem = ProgramItem & {
  score?: number
  matchHint?: string
  aiRecommended?: boolean
}

type ProgramTab = 'recommended' | 'all'
type ProgramStatusFilter = 'ALL' | 'CLOSING' | 'OPEN' | 'CLOSED'
type ProgramSortKey = 'RELEVANCE' | 'DEADLINE' | 'NAME' | 'CATEGORY'
type ProgramSortDirection = 'ASC' | 'DESC'

function parseDaysLeft(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const raw = dateStr.trim()
  const match = /^D-(\d+)$/i.exec(raw)
  if (match) return Number(match[1])

  const iso = raw.replace(/\./g, '-')
  const target = new Date(iso)
  if (!Number.isNaN(target.getTime())) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    target.setHours(0, 0, 0, 0)
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }
  return null
}

function StatusPill({
  dateStr,
  t,
}: {
  dateStr?: string | null
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const daysLeft = parseDaysLeft(dateStr)
  if (daysLeft !== null && daysLeft < 0) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
        {t('programs.closed')}
      </span>
    )
  }
  if (daysLeft !== null && daysLeft <= 3 && daysLeft >= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
        <Flame className="h-3 w-3" strokeWidth={2.2} />
        {t('scholarships.closingInDays', { count: daysLeft })}
      </span>
    )
  }
  if (daysLeft !== null && daysLeft <= 10 && daysLeft >= 0) {
    return (
      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-600">
        {daysLeft <= 7
          ? t('scholarships.closingInWeek')
          : t('scholarships.closingInDays', { count: daysLeft })}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
      {t('scholarships.open')}
    </span>
  )
}

export function ProgramsPage() {
  const { language, t } = useLanguage()
  const [programs, setPrograms] = useState<AiProgramItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<ProgramTab>('all')
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState<ProgramStatusFilter>('ALL')
  const [sortBy, setSortBy] = useState<ProgramSortKey>('DEADLINE')
  const [sortDirection, setSortDirection] = useState<ProgramSortDirection>('ASC')
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    // getPrograms() already returns AI-ranked programs (score + matchHint),
    // so a separate ai-dashboard request is unnecessary here — one round trip,
    // one translation warm, faster first paint.
    api
      .getPrograms()
      .then((allPrograms) => {
        if (cancelled) return

        const sorted = [...allPrograms].sort(
          (a, b) => (b.score ?? 0) - (a.score ?? 0),
        )
        const recommendedIds = new Set(sorted
          .filter((program) => {
            const daysLeft = parseDaysLeft(program.date)
            return daysLeft === null || daysLeft >= 0
          })
          .slice(0, RECOMMENDED_LIMIT)
          .map((program) => String(program.id)))

        setPrograms(
          sorted.map((p) => ({
            ...p,
            aiRecommended: recommendedIds.has(String(p.id)),
          })),
        )
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('academic.loadError'))
          setPrograms([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [language, t])

  const recommendedPrograms = useMemo(
    () => programs.filter((program) => program.aiRecommended),
    [programs],
  )

  useEffect(() => {
    if (!loading && recommendedPrograms.length === 0 && tab === 'recommended') {
      setTab('all')
    }
  }, [loading, recommendedPrograms.length, tab])

  const categories = useMemo(() => Array.from(new Set(
    programs.map((program) => program.category).filter((value): value is string => Boolean(value)),
  )).sort((a, b) => a.localeCompare(b)), [programs])

  const rawVisible = tab === 'recommended' ? recommendedPrograms : programs

  const filteredPrograms = useMemo(() => {
    const q = query.trim().toLowerCase()
    const direction = sortDirection === 'DESC' ? -1 : 1
    return rawVisible
      .filter((program) => {
        if (categoryFilter !== 'ALL' && program.category !== categoryFilter) return false
        const daysLeft = parseDaysLeft(program.date)
        if (statusFilter === 'CLOSING' && !(daysLeft !== null && daysLeft >= 0 && daysLeft <= 10)) return false
        if (statusFilter === 'OPEN' && !(daysLeft === null || daysLeft > 10)) return false
        if (statusFilter === 'CLOSED' && !(daysLeft !== null && daysLeft < 0)) return false
        if (!q) return true
        const haystack = [program.title, program.category, program.description, program.matchHint]
          .filter(Boolean).join(' ').toLowerCase()
        return haystack.includes(q)
      })
      .sort((a, b) => {
        let comparison: number
        if (sortBy === 'RELEVANCE') comparison = Number(a.score || 0) - Number(b.score || 0)
        else if (sortBy === 'NAME') comparison = a.title.localeCompare(b.title)
        else if (sortBy === 'CATEGORY') comparison = String(a.category || '').localeCompare(String(b.category || ''))
        else {
          const aDeadline = parseDaysLeft(a.date)
          const bDeadline = parseDaysLeft(b.date)
          const deadlineRank = (value: number | null) => value === null
            ? Number.MAX_SAFE_INTEGER - 1
            : value < 0 ? Number.MAX_SAFE_INTEGER : value
          comparison = deadlineRank(aDeadline) - deadlineRank(bDeadline)
        }
        return comparison * direction || a.title.localeCompare(b.title)
      })
  }, [categoryFilter, query, rawVisible, sortBy, sortDirection, statusFilter])

  const showTopThree = tab === 'all'
    && !query.trim()
    && categoryFilter === 'ALL'
    && statusFilter === 'ALL'

  const listPrograms = useMemo(() => {
    if (!showTopThree) return filteredPrograms
    const topIds = new Set(recommendedPrograms.map((program) => String(program.id)))
    return filteredPrograms.filter((program) => !topIds.has(String(program.id)))
  }, [filteredPrograms, recommendedPrograms, showTopThree])

  const tabs: { id: ProgramTab; labelKey: 'academic.recommendedForYou' | 'academic.allPrograms' }[] = [
    { id: 'recommended', labelKey: 'academic.recommendedForYou' },
    { id: 'all', labelKey: 'academic.allPrograms' },
  ]

  function toggleSave(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function renderProgramCard(program: AiProgramItem) {
    const Icon = getProgramIconForItem(program)
    const isRecommended = Boolean(program.aiRecommended)
    const isSaved = savedIds.has(String(program.id))

    return (
      <Link
        key={program.id}
        to={`/academic/programs/${program.id}`}
        className="flex items-start gap-3 rounded-[18px] bg-white p-3.5 transition active:scale-[0.99]"
        style={{ boxShadow: CARD_SHADOW }}
      >
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${
            isRecommended
              ? 'bg-[#F3E8FF] text-[#7C3AED]'
              : 'bg-[#E0F2FE] text-[#0284C7]'
          }`}
        >
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <p className="text-[14px] font-bold leading-snug tracking-tight text-pnu-text">
              {program.title}
            </p>
            <button
              type="button"
              onClick={(e) => toggleSave(String(program.id), e)}
              className="mt-0.5 p-0.5 text-pnu-muted hover:text-[#7C3AED]"
              aria-label="Save program"
            >
              <Bookmark
                className="h-4 w-4"
                fill={isSaved ? '#7C3AED' : 'none'}
                stroke={isSaved ? '#7C3AED' : 'currentColor'}
                strokeWidth={1.8}
              />
            </button>
          </div>

          {program.category ? (
            <p className="mt-0.5 text-[12px] font-semibold text-[#7C3AED]">
              {program.category}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill dateStr={program.date} t={t} />
            {isRecommended ? (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                ✨ {t('programs.recommended')}
              </span>
            ) : null}
            {program.date ? (
              <span className="text-[11px] font-bold text-pnu-blue">
                {program.date}
              </span>
            ) : null}
          </div>

          {isRecommended && program.matchHint ? (
            <p className="mt-2 rounded-[12px] bg-violet-50/80 px-2.5 py-1.5 text-[11px] leading-relaxed text-violet-800">
              {program.matchHint}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center self-center pl-1">
          {program.sourceUrl ? (
            <a
              href={program.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-full bg-blue-50 p-1.5 text-pnu-blue transition hover:bg-blue-100"
              title={t('academic.viewAnnouncement')}
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2} />
            </a>
          ) : (
            <ChevronRight className="h-4 w-4 text-pnu-muted opacity-40" strokeWidth={2} />
          )}
        </div>
      </Link>
    )
  }

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <PageHeader title={t('academic.programs')} subtitle={t('academic.programsSubtitle')} back />

      <div className="space-y-4 px-3 pb-6 pt-1">
        {/* Search bar & tab filters */}
        <div className="space-y-2.5">
          <label className="relative min-w-0 flex-1 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pnu-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('programs.searchPlaceholder')}
              className="w-full rounded-[14px] border border-black/8 bg-white py-2.5 pl-9 pr-3 text-[13px] text-pnu-text outline-none placeholder:text-pnu-muted focus:border-[#7C3AED]/40"
            />
          </label>

          <div className="flex gap-1.5">
            {tabs.map(({ id, labelKey }) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={[
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition',
                    active
                      ? 'bg-[#7C3AED] text-white shadow-sm'
                      : 'bg-white text-pnu-muted ring-1 ring-black/8',
                  ].join(' ')}
                >
                  {id === 'recommended' ? (
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  ) : null}
                  {t(labelKey)} ({id === 'recommended' ? recommendedPrograms.length : programs.length})
                </button>
              )
            })}
          </div>

          <div className="rounded-[16px] border border-black/8 bg-white p-3" style={{ boxShadow: CARD_SHADOW }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[#7C3AED]" />
                <span className="text-[12px] font-bold text-pnu-text">{t('programs.filters')}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('ALL')
                  setStatusFilter('ALL')
                  setSortBy('DEADLINE')
                  setSortDirection('ASC')
                  setQuery('')
                }}
                className="text-[10px] font-bold text-[#7C3AED]"
              >
                {t('courseCatalog.resetFilters')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                <option value="ALL">{t('programs.allCategories')}</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProgramStatusFilter)} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                <option value="ALL">{t('programs.allStatuses')}</option>
                <option value="OPEN">{t('programs.open')}</option>
                <option value="CLOSING">{t('programs.closingSoon')}</option>
                <option value="CLOSED">{t('programs.closed')}</option>
              </select>
              <select value={sortBy} onChange={(event) => {
                const value = event.target.value as ProgramSortKey
                setSortBy(value)
                if (value === 'RELEVANCE') setSortDirection('DESC')
              }} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                <option value="RELEVANCE">{t('programs.sortRelevance')}</option>
                <option value="DEADLINE">{t('programs.sortDeadline')}</option>
                <option value="NAME">{t('programs.sortName')}</option>
                <option value="CATEGORY">{t('programs.sortCategory')}</option>
              </select>
              <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as ProgramSortDirection)} className="min-w-0 rounded-xl border border-pnu-border bg-[#FAFBFD] px-2.5 py-2 text-xs">
                <option value="ASC">{t('courseCatalog.ascending')}</option>
                <option value="DESC">{t('courseCatalog.descending')}</option>
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}

        {loading ? (
          <p className="py-8 text-center text-[13px] text-pnu-muted">{t('academic.loading')}</p>
        ) : null}

        {!loading && !error && showTopThree && recommendedPrograms.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-[#7C3AED]" />
                <h2 className="text-[14px] font-bold tracking-tight text-[#7C3AED]">{t('programs.topThree')}</h2>
              </div>
              <span className="text-[10px] font-semibold text-pnu-muted">{t('programs.basedOnProfile')}</span>
            </div>
            {recommendedPrograms.map((program) => renderProgramCard(program))}
          </section>
        ) : null}

        {!loading && !error && filteredPrograms.length === 0 ? (
          <p
            className="rounded-[16px] bg-white px-4 py-8 text-center text-[13px] text-pnu-muted"
            style={{ boxShadow: CARD_SHADOW }}
          >
            {t('academic.noPrograms')}
          </p>
        ) : null}

        {!loading && !error && listPrograms.length > 0 ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[12px] font-bold text-pnu-text">
                {tab === 'recommended' ? t('programs.topThree') : t('academic.allPrograms')}
              </p>
              <span className="text-[10px] font-semibold text-pnu-muted">{t('programs.results', { count: filteredPrograms.length })}</span>
            </div>
            {listPrograms.map((program) => renderProgramCard(program))}
          </section>
        ) : null}
      </div>
    </div>
  )
}
