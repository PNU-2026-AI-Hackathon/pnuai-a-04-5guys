import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { Notification } from '@/types/api'
import { useLanguage } from '@/context/LanguageContext'
import { noticeHref } from '@/utils/notices'

interface LatestNoticeCardProps {
  notice: Notification | null
}

export function LatestNoticeCard({ notice }: LatestNoticeCardProps) {
  const { t } = useLanguage()

  if (!notice) {
    return (
      <section className="shrink-0">
        <h2 className="mb-1 px-0.5 text-[14px] font-semibold tracking-tight text-pnu-text">
          {t('home.latestNotice')}
        </h2>
        <div className="rounded-[16px] bg-white px-3 py-2 text-[12px] text-pnu-muted shadow-sm ring-1 ring-black/5">
          {t('home.noNotifications')}
        </div>
      </section>
    )
  }

  const href = noticeHref(notice)
  const className =
    'block rounded-[16px] bg-white px-3 py-2 shadow-sm ring-1 ring-black/5 transition active:scale-[0.99]'

  return (
    <section className="shrink-0">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-pnu-text">
          {t('home.latestNotice')}
        </h2>
        <Link
          to="/notifications"
          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-pnu-blue"
        >
          {t('common.viewAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Link to={href} className={className}>
        <p className="truncate text-[13px] font-semibold text-pnu-text">{notice.title}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-pnu-muted">
          {notice.body}
        </p>
      </Link>
    </section>
  )
}
