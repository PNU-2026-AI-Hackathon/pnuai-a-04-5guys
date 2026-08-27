import type { Notification } from '@/types/api'
import { isScholarshipNotice, scholarshipNoticePath } from '@/utils/noticeFeed'

/**
 * Always route to the in-app detail page so the notice renders through our
 * i18n and translation pipeline. The original board post is linked from
 * within that page instead of being the click target itself.
 */
export function noticeHref(notice: Pick<Notification, 'id' | 'channel'>): string {
  if (isScholarshipNotice(notice)) return scholarshipNoticePath(notice)
  return `/notifications/${notice.id}`
}
