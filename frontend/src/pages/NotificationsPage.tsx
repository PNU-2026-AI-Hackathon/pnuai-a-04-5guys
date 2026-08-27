import { useEffect, useMemo, useState } from 'react'
import { PushToggle } from '@/components/notifications/PushToggle'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  Clock3,
  FileText,
  Filter,
  FlaskConical,
  Gift,
  Globe2,
  Laptop,
  Megaphone,
  Plane,
  Sparkles,
  Star,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/api'
import { LatestNoticeCarousel } from '@/components/home/LatestNoticeCarousel'
import { useLanguage } from '@/context/LanguageContext'
import { useNoticeRefresh } from '@/context/NoticeRefreshContext'
import type { NoticeChannel, Notification, ScholarshipItem } from '@/types/api'
import { noticeHref } from '@/utils/notices'
import { mergeNoticeFeed } from '@/utils/noticeFeed'
import { useSavedNotices } from '@/utils/savedNotices'

const CARD_SHADOW = '0 8px 24px rgba(15,23,42,0.06)'

type FeedTab = 'latest' | 'important'
type ChannelFilter = 'all' | NoticeChannel

type DisplayNotice = Notification & {
  channel: NoticeChannel
  source: string | null
  daysLeft: number | null
  Icon: LucideIcon
  iconTone: string
  dotTone: string
  channelLabelKey: string
  channelTextTone: string
}

function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null
  const target = new Date(dateIso)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function inferChannel(n: Notification): NoticeChannel {
  if (n.channel) return n.channel
  const hay = `${n.title} ${n.body} ${n.source ?? ''}`.toLowerCase()
  if (/scholarship|gift|aid|장학|bursary|stipend/.test(hay)) return 'scholarship'
  if (/international|visa|dorm|exchange|외국인|국제|기숙사/.test(hay)) return 'international'
  if (/department|학과|major|course registration|research|engineering|computer/.test(hay)) {
    return 'department'
  }
  if (n.category === 'GENERAL') return 'general'
  return 'general'
}

function pickVisual(n: Notification, channel: NoticeChannel): {
  Icon: LucideIcon
  iconTone: string
  dotTone: string
  channelLabelKey: string
  channelTextTone: string
} {
  const hay = `${n.title} ${n.body}`.toLowerCase()

  if (/visa|document|extension/.test(hay)) {
    return {
      Icon: FileText,
      iconTone: 'bg-[#DBEAFE] text-[#2563EB]',
      dotTone: 'bg-[#2563EB]',
      channelLabelKey: 'notices.channelInternational',
      channelTextTone: 'text-[#E11D48]',
    }
  }
  if (/scholarship|gift|aid|장학|bursary|stipend/.test(hay) || channel === 'scholarship') {
    return {
      Icon: Gift,
      iconTone: 'bg-[#DCFCE7] text-[#16A34A]',
      dotTone: 'bg-[#16A34A]',
      channelLabelKey: 'notices.channelScholarship',
      channelTextTone: 'text-[#16A34A]',
    }
  }
  if (/dorm|housing|plane|flight/.test(hay)) {
    return {
      Icon: Plane,
      iconTone: 'bg-[#FEE2E2] text-[#E11D48]',
      dotTone: 'bg-[#E11D48]',
      channelLabelKey: 'notices.channelInternational',
      channelTextTone: 'text-[#E11D48]',
    }
  }
  if (/research|lab|flask/.test(hay)) {
    return {
      Icon: FlaskConical,
      iconTone: 'bg-[#E0F2FE] text-[#0284C7]',
      dotTone: 'bg-[#0284C7]',
      channelLabelKey: 'notices.channelDepartment',
      channelTextTone: 'text-[#7C3AED]',
    }
  }
  if (/meetup|orientation|community|people/.test(hay)) {
    return {
      Icon: Users,
      iconTone: 'bg-[#FCE7F3] text-[#DB2777]',
      dotTone: 'bg-[#DB2777]',
      channelLabelKey: 'notices.channelInternational',
      channelTextTone: 'text-[#E11D48]',
    }
  }
  if (/registration|course|laptop|computer/.test(hay) || channel === 'department') {
    return {
      Icon: Laptop,
      iconTone: 'bg-[#F3E8FF] text-[#7C3AED]',
      dotTone: 'bg-[#7C3AED]',
      channelLabelKey: 'notices.channelDepartment',
      channelTextTone: 'text-[#7C3AED]',
    }
  }
  if (channel === 'international') {
    return {
      Icon: Globe2,
      iconTone: 'bg-[#FEE2E2] text-[#E11D48]',
      dotTone: 'bg-[#E11D48]',
      channelLabelKey: 'notices.channelInternational',
      channelTextTone: 'text-[#E11D48]',
    }
  }
  return {
    Icon: Megaphone,
    iconTone: 'bg-[#FFEDD5] text-[#EA580C]',
    dotTone: 'bg-[#EA580C]',
    channelLabelKey: 'notices.channelGeneral',
    channelTextTone: 'text-[#EA580C]',
  }
}

function toDisplay(n: Notification): DisplayNotice {
  const channel = inferChannel(n)
  const visual = pickVisual(n, channel)
  return {
    ...n,
    channel,
    source: n.source ?? null,
    daysLeft: daysUntil(n.date),
    read: n.read ?? false,
    ...visual,
  }
}

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function NotificationsPage() {
  const { language, locale, t } = useLanguage()
  const {
    notifications: personalizedNotices,
    loading,
    error,
  } = useNoticeRefresh()
  const [scholarships, setScholarships] = useState<ScholarshipItem[]>([])
  const [feedTab, setFeedTab] = useState<FeedTab>('latest')
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const { toggle: toggleSavedNotice, isSaved: isNoticeSaved } = useSavedNotices()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true
    api
      // Supplementary to the notice feed — the page is useful without them, so
      // a failure degrades to an empty list rather than a toast.
      .getScholarships({ suppressToast: true })
      .then((items) => {
        if (active) setScholarships(items)
      })
      .catch(() => {
        if (active) setScholarships([])
      })
    return () => {
      active = false
    }
  }, [language])

  const notifications = useMemo(
    () => mergeNoticeFeed(personalizedNotices, scholarships),
    [personalizedNotices, scholarships],
  )

  const catalog = useMemo(() => notifications.map(toDisplay), [notifications])

  const summaryItems = useMemo(
    () =>
      catalog
        .filter((notice) => (notice.kind ?? 'NOTICE') === 'NOTICE')
        .slice(0, 4),
    [catalog],
  )

  const feedItems = useMemo(() => {
    let list = [...catalog].sort(
      (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
    )
    if (feedTab === 'important') list = list.filter((n) => n.priority === 'HIGH')
    if (channelFilter !== 'all') list = list.filter((n) => n.channel === channelFilter)
    return list
  }, [catalog, channelFilter, feedTab])

  const feedTabs: { id: FeedTab; labelKey: string; icon: LucideIcon }[] = [
    { id: 'latest', labelKey: 'notices.tabLatest', icon: Clock3 },
    { id: 'important', labelKey: 'notices.tabImportant', icon: Star },
  ]
  const channelFilters: { id: ChannelFilter; labelKey: string }[] = [
    { id: 'all', labelKey: 'notices.filterAll' },
    { id: 'department', labelKey: 'notices.channelDepartment' },
    { id: 'international', labelKey: 'notices.channelInternational' },
    { id: 'scholarship', labelKey: 'notices.channelScholarship' },
    { id: 'general', labelKey: 'notices.channelGeneral' },
  ]

  function toggleBookmark(notice: Notification) {
    toggleSavedNotice(notice)
  }

  return (
    <div className="min-h-full bg-[#F5F7FB]">
      <header className="sticky top-0 z-10 bg-[#F5F7FB]/95 px-3 pb-2 pt-2.5 backdrop-blur-xl">
        <div className="flex items-start gap-2 pt-0.5">
          <button
            type="button"
            aria-label={t('common.goBack')}
            onClick={() => navigate(-1)}
            className="mt-0.5 rounded-xl bg-white p-1.5 text-pnu-muted shadow-sm ring-1 ring-black/8 transition hover:text-pnu-blue"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold leading-none tracking-tight text-pnu-text">
              {t('notices.title')}
            </h1>
            <p className="mt-1 text-[12px] font-medium text-pnu-muted">
              {t('notices.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <div className="px-3 pt-2">
        <PushToggle />
      </div>

      <div className="space-y-4 px-3 pb-6 pt-1">
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        {loading ? (
          <p className="py-8 text-center text-[13px] text-pnu-muted">
            {t('notifications.loading')}
          </p>
        ) : null}

        {!loading && summaryItems.length > 0 ? (
          <LatestNoticeCarousel notices={summaryItems} showHeader={false} />
        ) : null}

        {!loading ? (
          <section id="latest">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <h2 className="text-[14px] font-bold tracking-tight text-pnu-text">
                {t('notices.latest')}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setFeedTab('latest')
                  setChannelFilter('all')
                  setFilterOpen(false)
                }}
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#7C3AED]"
              >
                {t('common.viewAll')}
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>

            <div className="mb-2.5 flex items-center gap-1.5">
              <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {feedTabs.map(({ id, labelKey, icon: Icon }) => {
                  const active = feedTab === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFeedTab(id)}
                      className={[
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                        active
                          ? 'bg-[#F3E8FF] text-[#7C3AED] ring-1 ring-[#7C3AED]/30'
                          : 'bg-white text-pnu-muted ring-1 ring-black/8',
                      ].join(' ')}
                    >
                      <Icon className="h-3 w-3" strokeWidth={2} />
                      {t(labelKey)}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                aria-expanded={filterOpen}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${filterOpen || channelFilter !== 'all' ? 'bg-[#F3E8FF] text-[#7C3AED] ring-[#7C3AED]/30' : 'bg-white text-pnu-muted ring-black/8'}`}
              >
                <Filter className="h-3 w-3" strokeWidth={2} />
                {t('notices.filter')}
              </button>
            </div>

            {filterOpen ? (
              <div className="mb-3 flex flex-wrap gap-1.5 rounded-xl bg-white p-2.5 ring-1 ring-black/8">
                {channelFilters.map(({ id, labelKey }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChannelFilter(id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${channelFilter === id ? 'bg-[#7C3AED] text-white' : 'bg-pnu-surface text-pnu-muted'}`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            ) : null}

            {feedItems.length === 0 ? (
              <p
                className="rounded-[16px] bg-white px-4 py-8 text-center text-[13px] text-pnu-muted"
                style={{ boxShadow: CARD_SHADOW }}
              >
                {t('notices.empty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {feedItems.map((item) => {
                  const Icon = item.Icon
                  const saved = isNoticeSaved(item.id)
                  const href = noticeHref(item)
                  return (
                    <li key={item.id}>
                      <div
                        className="flex items-start gap-2 rounded-[16px] bg-white px-2.5 py-3"
                        style={{ boxShadow: CARD_SHADOW }}
                      >
                        <span
                          className={`mt-4 h-1.5 w-1.5 shrink-0 rounded-full ${item.dotTone}`}
                        />
                        <Link
                          to={href}
                          className="flex min-w-0 flex-1 items-start gap-2.5"
                        >
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${item.iconTone}`}
                          >
                            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[10px] font-bold ${item.channelTextTone}`}>
                              {t(item.channelLabelKey)}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-[13px] font-bold leading-snug text-pnu-text">
                              {item.title}
                            </p>
                            {item.source ? (
                              <p className="mt-0.5 truncate text-[11px] font-medium text-pnu-muted">
                                {item.source}
                              </p>
                            ) : null}
                          </div>
                        </Link>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {formatDate(item.date, locale) ? (
                            <span className="text-[10px] font-medium text-pnu-muted">
                              {formatDate(item.date, locale)}
                            </span>
                          ) : null}
                          <div className="flex items-center gap-1">
                            <ChevronRight
                              className="h-3.5 w-3.5 text-pnu-muted opacity-40"
                              strokeWidth={2}
                            />
                            <button
                              type="button"
                              onClick={() => toggleBookmark(item)}
                              className={[
                                'rounded-md p-0.5 transition',
                                saved ? 'text-[#7C3AED]' : 'text-pnu-muted',
                              ].join(' ')}
                              aria-label={t('notices.bookmark')}
                            >
                              <Bookmark
                                className="h-3.5 w-3.5"
                                strokeWidth={2}
                                fill={saved ? 'currentColor' : 'none'}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : null}

        {!loading && !bannerDismissed ? (
          <section
            className="relative flex items-center gap-3 rounded-[16px] bg-[#F3E8FF] px-3.5 py-3"
            style={{ boxShadow: CARD_SHADOW }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#7C3AED] text-white">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 pr-4">
              <p className="text-[11px] font-medium leading-snug text-[#5B21B6]">
                {t('notices.aiBannerBody')}
              </p>
              <Link
                to="/ai"
                className="mt-2 inline-flex rounded-[10px] bg-[#7C3AED] px-2.5 py-1.5 text-[11px] font-bold text-white transition active:scale-95"
              >
                {t('notices.enableAiAlerts')}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              className="absolute right-2 top-2 rounded-md p-1 text-[#7C3AED]/70"
              aria-label={t('common.clear')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </section>
        ) : null}
      </div>
    </div>
  )
}
