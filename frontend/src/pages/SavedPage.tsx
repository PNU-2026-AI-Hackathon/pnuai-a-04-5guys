import { Link } from 'react-router-dom'
import { Bookmark, Megaphone } from 'lucide-react'
import { CareerJobRow } from '@/components/career/CareerJobRow'
import { PageHeader } from '@/components/layout/PageHeader'
import { useLanguage } from '@/context/LanguageContext'
import { noticeHref } from '@/utils/notices'
import { useSavedJobs } from '@/utils/savedJobs'
import { useSavedNotices } from '@/utils/savedNotices'

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

export function SavedPage() {
  const { locale, t } = useLanguage()
  const { saved: savedJobs, toggle: toggleJob, isSaved: isJobSaved } = useSavedJobs()
  const {
    saved: savedNotices,
    toggle: toggleNotice,
    isSaved: isNoticeSaved,
  } = useSavedNotices()

  const totalCount = savedJobs.length + savedNotices.length
  const isEmpty = totalCount === 0

  return (
    <div className="pb-8">
      <PageHeader title={t('profile.saved')} back />

      <div className="space-y-5 px-4 pt-3">
        <p className="px-1 text-[12px] text-pnu-muted">{t('profile.savedHint')}</p>

        {isEmpty ? (
          <div className="flex flex-col items-center rounded-[22px] bg-white px-6 py-12 text-center shadow-sm ring-1 ring-black/5">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-pnu-blue/10 text-pnu-blue">
              <Bookmark className="h-7 w-7" />
            </div>
            <p className="text-[15px] font-semibold text-pnu-text">{t('profile.saved')}</p>
            <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-pnu-muted">
              {t('profile.savedEmpty')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <Link
                to="/notifications"
                className="rounded-full bg-[#F2F2F7] px-4 py-2 text-[13px] font-semibold text-pnu-text transition hover:bg-pnu-blue hover:text-white"
              >
                {t('profile.savedBrowseNotices')}
              </Link>
              <Link
                to="/career-opportunities"
                className="rounded-full bg-[#F2F2F7] px-4 py-2 text-[13px] font-semibold text-pnu-text transition hover:bg-pnu-blue hover:text-white"
              >
                {t('profile.savedBrowseJobs')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            {savedNotices.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-[15px] font-bold text-pnu-text">
                    {t('profile.savedNotices')}
                  </h2>
                  <span className="text-[12px] font-semibold text-pnu-muted">
                    {t('profile.savedCount', { count: savedNotices.length })}
                  </span>
                </div>
                <ul className="space-y-2">
                  {savedNotices.map((notice) => {
                    const href = noticeHref(notice)
                    const saved = isNoticeSaved(notice.id)
                    const formattedDate = formatDate(notice.date, locale)
                    const content = (
                      <>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#F3E8FF] text-[#7C3AED]">
                          <Megaphone className="h-[18px] w-[18px]" strokeWidth={1.9} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[13px] font-bold leading-snug text-pnu-text">
                            {notice.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] font-medium text-pnu-muted">
                            {notice.source || t('notices.title')}
                          </p>
                        </div>
                      </>
                    )

                    return (
                      <li
                        key={notice.id}
                        className="flex items-start gap-2 rounded-[16px] bg-white px-2.5 py-3 shadow-sm ring-1 ring-black/5"
                      >
                        <Link to={href} className="flex min-w-0 flex-1 items-start gap-2.5">
                          {content}
                        </Link>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {formattedDate ? (
                            <span className="text-[10px] font-medium text-pnu-muted">
                              {formattedDate}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleNotice(notice)}
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
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}

            {savedJobs.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-[15px] font-bold text-pnu-text">
                    {t('profile.savedJobs')}
                  </h2>
                  <span className="text-[12px] font-semibold text-pnu-muted">
                    {t('profile.savedCount', { count: savedJobs.length })}
                  </span>
                </div>
                <div className="overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 ring-black/5">
                  <div className="divide-y divide-pnu-border/80">
                    {savedJobs.map((opportunity) => (
                      <CareerJobRow
                        key={opportunity.id}
                        opportunity={opportunity}
                        variant="latest"
                        bookmarked={isJobSaved(opportunity.id)}
                        onToggleBookmark={toggleJob}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
