import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(frontendRoot, relativePath), 'utf8')

const context = read('src/context/NoticeRefreshContext.tsx')
assert.match(context, /NOTICE_REFRESH_INTERVAL_MS\s*=\s*60_000/)
assert.match(context, /document\.visibilityState\s*===\s*'visible'/)
assert.match(context, /visibilitychange/)
assert.match(context, /requestInFlight/)
assert.match(context, /api\.getPersonalizedNotifications\(\)/)

const app = read('src/App.tsx')
assert.match(app, /<NoticeRefreshProvider>/)

const apiIndex = read('src/api/index.ts')
assert.match(apiIndex, /export const isMockApi = false/)
assert.match(apiIndex, /export const api: HeyPnuApi = realApi/)
assert.doesNotMatch(apiIndex, /mockApi/)

for (const consumer of [
  'src/components/layout/AppShell.tsx',
  'src/pages/HomePage.tsx',
  'src/pages/NotificationsPage.tsx',
  'src/pages/NotificationPostPage.tsx',
]) {
  assert.match(read(consumer), /useNoticeRefresh\(\)/, `${consumer} must use the shared notice feed`)
}

const noticeLinks = read('src/utils/notices.ts')
assert.match(noticeLinks, /return `\/notifications\/\$\{notice\.id\}`/)
assert.doesNotMatch(noticeLinks, /if \(notice\.sourceUrl\) return notice\.sourceUrl/)

for (const consumer of [
  'src/components/home/LatestNoticeCard.tsx',
  'src/components/home/LatestNoticeCarousel.tsx',
  'src/components/notifications/NotificationCard.tsx',
  'src/pages/NotificationsPage.tsx',
  'src/pages/SavedPage.tsx',
]) {
  assert.doesNotMatch(
    read(consumer),
    /isExternalNotice/,
    `${consumer} must open notice details inside the app`,
  )
}

const noticeDetail = read('src/pages/NotificationPostPage.tsx')
assert.match(noticeDetail, /href=\{notification\.sourceUrl\}/)
assert.match(noticeDetail, /t\('notices\.viewOriginal'\)/)
assert.match(noticeDetail, /notification\.originalBody/)
assert.match(noticeDetail, /t\('notices\.translationNote'\)/)

console.log('Notice refresh frontend tests passed: 24 assertions')
