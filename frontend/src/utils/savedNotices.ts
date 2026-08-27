import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Notification } from '@/types/api'

export const SAVED_NOTICES_KEY = 'hey_pnu_saved_notices'
export const SAVED_NOTICES_EVENT = 'hey_pnu_saved_notices_changed'

function isSavedNotice(value: unknown): value is Notification {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.body === 'string' &&
    (item.date == null || typeof item.date === 'string')
  )
}

export function loadSavedNotices(): Notification[] {
  try {
    const raw = localStorage.getItem(SAVED_NOTICES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedNotice)
  } catch {
    return []
  }
}

function persistSavedNotices(notices: Notification[]) {
  localStorage.setItem(SAVED_NOTICES_KEY, JSON.stringify(notices))
  window.dispatchEvent(new Event(SAVED_NOTICES_EVENT))
}

export function toggleSavedNotice(notice: Notification): Notification[] {
  const current = loadSavedNotices()
  const exists = current.some((item) => item.id === notice.id)
  const next = exists
    ? current.filter((item) => item.id !== notice.id)
    : [
        {
          id: notice.id,
          kind: notice.kind,
          title: notice.title,
          body: notice.body,
          date: notice.date,
          postedDate: notice.postedDate ?? null,
          deadline: notice.deadline ?? null,
          dueDate: notice.dueDate ?? null,
          updatedAt: notice.updatedAt ?? null,
          languages: notice.languages ?? [],
          category: notice.category,
          priority: notice.priority,
          source: notice.source ?? null,
          channel: notice.channel ?? null,
          sourceUrl: notice.sourceUrl ?? null,
          originalTitle: notice.originalTitle ?? null,
          originalBody: notice.originalBody ?? null,
          translationLanguage: notice.translationLanguage ?? null,
          score: notice.score ?? null,
          matchHint: notice.matchHint ?? null,
          status: notice.status ?? null,
          read: notice.read ?? false,
        },
        ...current,
      ]
  persistSavedNotices(next)
  return next
}

export function useSavedNotices() {
  const [saved, setSaved] = useState<Notification[]>(() => loadSavedNotices())

  useEffect(() => {
    const refresh = () => setSaved(loadSavedNotices())
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_NOTICES_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(SAVED_NOTICES_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SAVED_NOTICES_EVENT, refresh)
    }
  }, [])

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved])

  const toggle = useCallback((notice: Notification) => {
    setSaved(toggleSavedNotice(notice))
  }, [])

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds])

  return { saved, savedIds, toggle, isSaved }
}
