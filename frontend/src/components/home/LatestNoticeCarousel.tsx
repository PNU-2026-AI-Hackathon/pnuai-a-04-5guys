import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Sparkles } from 'lucide-react'
import type { Notification } from '@/types/api'
import { useLanguage } from '@/context/LanguageContext'
import { noticeHref } from '@/utils/notices'
import sanjini from '@/assets/pnu-character.png'

interface LatestNoticeCarouselProps {
  notices: Notification[]
  /** When false, only the AI summary card is rendered (no section title). */
  showHeader?: boolean
}

const CARD_SHADOW = '0 12px 32px rgba(15,23,42,0.08)'

function formatRelativeTime(
  dateStr: string | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string | null {
  if (!dateStr) return null
  const parsed = new Date(dateStr).getTime()
  if (Number.isNaN(parsed)) return null

  const diffMs = Date.now() - parsed
  const minutes = Math.max(0, Math.floor(diffMs / 60000))
  if (minutes < 60) return t('home.timeAgoMinutes', { count: Math.max(1, minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return t('home.timeAgoHours', { count: hours })
  const days = Math.floor(hours / 24)
  return t('home.timeAgoDays', { count: days })
}

export function LatestNoticeCarousel({
  notices,
  showHeader = true,
}: LatestNoticeCarouselProps) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const slides = useMemo(
    () =>
      notices
        .filter((notice) => notice.kind === 'NOTICE')
        .slice(0, 5),
    [notices],
  )
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [slides.length])

  useEffect(() => {
    if (slides.length <= 1) return
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % slides.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [slides.length])

  if (slides.length === 0) {
    if (!showHeader) return null
    return (
      <section className="shrink-0">
        <div className="mb-2.5 px-0.5">
          <h2 className="text-[15px] font-bold tracking-tight text-pnu-text">
            {t('home.latestNotice')}
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-pnu-muted">
            {t('home.latestNoticeSubtitle')}
          </p>
        </div>
        <div
          className="rounded-[24px] bg-white px-4 py-4 text-[12px] text-pnu-muted"
          style={{ boxShadow: CARD_SHADOW }}
        >
          {t('home.noNotifications')}
        </div>
      </section>
    )
  }

  const notice = slides[index] ?? slides[0]
  const href = noticeHref(notice)
  const relativeTime = formatRelativeTime(notice.date, t)

  return (
    <section className="shrink-0">
      {showHeader ? (
        <div className="mb-2.5 flex items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-[15px] font-bold tracking-tight text-pnu-text">
              {t('home.latestNotice')}
            </h2>
            <p className="mt-0.5 text-[11px] font-medium text-pnu-muted">
              {t('home.latestNoticeSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="relative z-10 -mb-2 -mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-[11px] font-semibold text-pnu-blue transition active:scale-[0.98]"
            aria-label={t('notices.viewAllNotices')}
          >
            {t('common.viewAll')}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div
        className="overflow-hidden rounded-[24px] bg-white px-4 pb-3 pt-4 transition active:scale-[0.99]"
        style={{ boxShadow: CARD_SHADOW }}
      >
        <Link to={href} className="block">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-pnu-blue/10 px-2.5 py-1 text-[10px] font-bold text-pnu-blue">
              <Sparkles className="h-3 w-3" strokeWidth={2.2} />
              {t('home.aiSummary')}
            </span>
            {relativeTime ? (
              <span className="text-[11px] font-medium text-pnu-muted">
                {relativeTime}
              </span>
            ) : null}
          </div>

          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-snug tracking-tight text-pnu-text">
                {notice.title}
              </p>
              <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-pnu-muted">
                {notice.body}
              </p>
            </div>
            <img
              src={sanjini}
              alt=""
              className="h-16 w-16 shrink-0 object-contain object-bottom"
              draggable={false}
            />
          </div>
        </Link>

        {slides.length > 1 ? (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {slides.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Notice ${i + 1}`}
                onClick={() => setIndex(i)}
                className={[
                  'h-1.5 rounded-full transition-all active:scale-[0.98]',
                  i === index ? 'w-4 bg-pnu-blue' : 'w-1.5 bg-[#C5D8F5]',
                ].join(' ')}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
