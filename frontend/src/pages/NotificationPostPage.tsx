import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays, ExternalLink, FileCheck, Users } from 'lucide-react'
import type { Notification } from '@/types/api'
import { PageHeader } from '@/components/layout/PageHeader'
import { useLanguage } from '@/context/LanguageContext'
import { useNoticeRefresh } from '@/context/NoticeRefreshContext'
import { loadSavedNotices } from '@/utils/savedNotices'

function formatSafeDate(
  value: string | null | undefined,
  locale: string,
): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString(locale)
}

export function NotificationPostPage() {
  const { notificationId } = useParams()
  const { locale, t } = useLanguage()
  const { notifications, loading, error } = useNoticeRefresh()
  const notification = useMemo<Notification | null>(() => {
    const current = notifications.find((item) => item.id === notificationId)
    const saved = loadSavedNotices().find((item) => item.id === notificationId)
    return current ?? saved ?? null
  }, [notificationId, notifications])

  const formattedDate = formatSafeDate(notification?.date, locale)

  return (
    <div>
      <PageHeader title={notification?.title ?? t('notifications.title')} back />

      <div className="px-5 py-5">
        {loading ? <p className="text-sm text-pnu-muted">{t('notifications.loading')}</p> : null}
        {error ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        {!loading && !notification && !error ? (
          <p className="text-sm text-pnu-muted">{t('common.errorFallback')}</p>
        ) : null}
        {notification ? (
          <article className="rounded-2xl border border-pnu-border bg-white p-4 shadow-sm">
            {notification.category || formattedDate ? (
              <div className="mb-3 flex items-center justify-between gap-3">
                {notification.category ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-pnu-blue">
                    {notification.category}
                  </span>
                ) : null}
                {formattedDate ? (
                  <span className="inline-flex items-center gap-1 text-xs text-pnu-muted">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formattedDate}
                  </span>
                ) : null}
              </div>
            ) : null}
            <h1 className="text-lg font-bold text-pnu-text">{notification.title}</h1>
            {notification.translationLanguage ? (
              <div className="mt-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-pnu-blue">
                  {t('notices.translatedContent')}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-pnu-muted">
                  {t('notices.translationNote')}
                </p>
              </div>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-pnu-muted">
              {notification.body}
            </p>
            {notification.matchHint ? (
              <p className="mt-3 rounded-xl bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700">
                {notification.matchHint}
              </p>
            ) : null}
            {notification.originalBody && notification.originalBody !== notification.body ? (
              <section className="mt-4 rounded-xl bg-pnu-surface px-3 py-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-pnu-muted">
                  {t('notices.originalContent')}
                </h2>
                {notification.originalTitle && notification.originalTitle !== notification.title ? (
                  <p className="mt-2 text-sm font-bold text-pnu-text">
                    {notification.originalTitle}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-pnu-muted">
                  {notification.originalBody}
                </p>
              </section>
            ) : null}
            {notification.eligibility || (notification.requiredDocuments && notification.requiredDocuments.length > 0) ? (
              <section className="mt-4 space-y-2 rounded-xl bg-blue-50 px-3 py-3">
                {notification.eligibility ? (
                  <div className="flex items-start gap-2 text-sm text-pnu-text">
                    <Users className="mt-0.5 h-4 w-4 shrink-0 text-pnu-blue" />
                    <span>
                      <span className="font-bold">{t('notices.eligibility')}: </span>
                      {notification.eligibility}
                    </span>
                  </div>
                ) : null}
                {notification.requiredDocuments && notification.requiredDocuments.length > 0 ? (
                  <div className="flex items-start gap-2 text-sm text-pnu-text">
                    <FileCheck className="mt-0.5 h-4 w-4 shrink-0 text-pnu-blue" />
                    <span>
                      <span className="font-bold">{t('notices.requiredDocuments')}: </span>
                      {notification.requiredDocuments.join(', ')}
                    </span>
                  </div>
                ) : null}
              </section>
            ) : null}
            {notification.sourceUrl ? (
              <a
                href={notification.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-pnu-border px-3 py-2 text-sm font-bold text-pnu-blue transition hover:bg-blue-50"
              >
                <ExternalLink className="h-4 w-4" />
                {t('notices.viewOriginal')}
              </a>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  )
}
