import { useSyncExternalStore } from 'react'
import { api, today, type Article } from '../api/client.ts'
import { queryClient } from '../api/query.ts'
import { toast } from './toast.ts'

interface Flags {
  liked: boolean
  saved: boolean
  seen: boolean
  read: boolean
  hidden: boolean
}

export type FlaggedArticle = Article & { hidden: boolean }

const overrides = new Map<number, Partial<Flags>>()
const listeners = new Set<() => void>()
let version = 0

function patch(id: number, change: Partial<Flags>): void {
  overrides.set(id, { ...overrides.get(id), ...change })
  version++
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function withFlags(article: Article): FlaggedArticle {
  return { ...article, hidden: false, ...overrides.get(article.id) }
}

/** Re-renders the caller whenever any article's flags change. */
export function useFlagChanges(): number {
  return useSyncExternalStore(subscribe, () => version)
}

export function useFlags(article: Article): FlaggedArticle {
  useFlagChanges()
  return withFlags(article)
}

async function send(id: number, change: Partial<Flags>, undo: Partial<Flags>, request: () => Promise<unknown>, refresh: string[]) {
  patch(id, change)
  try {
    await request()
    for (const key of refresh) void queryClient.invalidateQueries({ queryKey: [key] })
  } catch {
    patch(id, undo)
    toast('That did not save. Check the connection and try again.')
  }
}

export function setLiked(article: Article, on: boolean): void {
  void send(article.id, { liked: on }, { liked: !on }, () => api(`/api/articles/${article.id}/like`, { body: { on } }), ['library', 'stats'])
}

export function setSaved(article: Article, on: boolean): void {
  void send(article.id, { saved: on }, { saved: !on }, () => api(`/api/articles/${article.id}/save`, { body: { on } }), ['library', 'stats'])
}

export function hide(article: Article): void {
  void send(article.id, { hidden: true }, { hidden: false }, () => api(`/api/articles/${article.id}/hide`, { body: { on: true } }), [])
}

export function markRead(article: Article): void {
  if (withFlags(article).read) return
  void send(
    article.id,
    { read: true, seen: true },
    { read: false },
    () => api(`/api/articles/${article.id}/read`, { body: { day: today() } }),
    ['stats'],
  )
}

const pendingSeen = new Set<number>()
let seenTimer: ReturnType<typeof setTimeout> | undefined

function flushSeen(): void {
  clearTimeout(seenTimer)
  seenTimer = undefined
  if (pendingSeen.size === 0) return
  const ids = [...pendingSeen]
  pendingSeen.clear()
  void fetch('/api/articles/seen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
    keepalive: true,
  }).catch(() => {})
}

export function markSeen(article: Article): void {
  if (withFlags(article).seen) return
  patch(article.id, { seen: true })
  pendingSeen.add(article.id)
  seenTimer ??= setTimeout(flushSeen, 1500)
}

addEventListener('pagehide', flushSeen)
