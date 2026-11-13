import { messages } from '../i18n/index.ts'
import { sessionStore } from '../state/session.ts'

export interface SourceRef {
  id: number
  title: string
  icon: string | null
  site: string
  /** False for the hidden source that holds one-off search results. */
  managed: boolean
}

export interface Article {
  id: number
  url: string
  title: string
  excerpt: string
  image: string | null
  author: string | null
  publishedAt: number
  seen: boolean
  read: boolean
  liked: boolean
  saved: boolean
  hasSummary: boolean
  source: SourceRef
  topic: { slug: string; name: string } | null
}

export interface StoredSummary {
  lang: string
  bullets: string[]
}

export interface SearchProvider {
  id: string
  name: string
}

export interface Suggestion {
  article: Article
  provider: string
  /** Written by the model in `lang`; absent when the round ran without one. */
  reason: string | null
  lang: string | null
  interest: { id: number; label: string; kind: 'near' | 'lateral' | 'wildcard' }
}

export interface SuggestionList {
  running: boolean
  ranAt: number | null
  problem: string | null
  items: Suggestion[]
}

export interface FollowOptions {
  subject: string
  site: { title: string } | null
  search: { title: string } | null
  topicId: number | null
  newTopic: string | null
}

export interface Interest {
  id: number
  label: string
  kind: 'near' | 'lateral' | 'wildcard'
  origin: 'tracker' | 'history' | 'ai'
  state: 'trial' | 'active' | 'deferred' | 'rejected' | 'avoided'
  shown: number
  accepted: number
}

/** The instance's one Xiaohongshu login. */
export interface Connection {
  configured: boolean
  connected: boolean
  account: string | null
  challenged: boolean
}

export interface LoginCode {
  image: string
  lasts: number
}

export type ActivityKind = 'watched' | 'liked' | 'saved' | 'followed'

/** One of the reader's own accounts on another platform, which suggestions learn from. */
export interface Account {
  platform: string
  name: string
  /** Whether Pulse signs in to it, or the reader's browser extension reads it. */
  via: 'login' | 'extension'
  connected: boolean
  account: string | null
  syncedAt: number | null
  problem: string | null
  activity: Partial<Record<ActivityKind, number>>
}

/** A sign-in under way: a QR code to scan, or a code to enter at an address. */
export interface AccountLogin {
  image?: string
  code?: string
  url?: string
  lasts: number
  every: number
}

export interface User {
  id: number
  username: string
  /** The admin looks after what the whole instance shares, such as the Xiaohongshu login. */
  admin: boolean
}

export interface FeedPage {
  items: Article[]
  nextCursor: string | null
  seenMark?: number | null
}

export interface FeedParams {
  topic?: string
  source?: number
  filter?: 'saved' | 'liked'
  q?: string
  tracker?: number
}

export interface Story {
  source: SourceRef
  topic: Article['topic']
  unseen: number
  latest: number
  items: Article[]
}

export interface Topic {
  id: number
  name: string
  slug: string
  sources: number
}

export interface Source {
  id: number
  title: string
  siteUrl: string
  feedUrl: string
  icon: string | null
  followed: boolean
  error: string | null
  fetchedAt: number | null
  topicId: number
  articles: number
}

export interface Tracker {
  id: number
  phrase: string
  hits: number
  unseen: number
}

export interface Trend {
  phrase: string
  sources: number
  articles: number
}

export interface ActivityHit {
  tracker: { id: number; phrase: string }
  seen: boolean
  article: Article
}

export interface Stats {
  streak: number
  today: number
  week: { day: string; count: number }[]
  saved: number
  liked: number
  topics: { name: string; slug: string; count: number }[]
}

export interface Briefing {
  overview: string
  sections: { topic: string; stories: { title: string; summary: string; articleIds: number[] }[] }[]
}

export interface BriefingResult {
  briefing: Briefing | null
  createdAt?: number
  articles?: Record<number, Article>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The message for a failure in the current language, falling back to the server's own wording. */
export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined
  return (code && messages().errors[code]) || (error instanceof Error && error.message) || messages().errors.fallback
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = options.body !== undefined
  const res = await fetch(path, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (data?.code === 'signed_out') sessionStore.set({ status: 'out', user: null })
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, data?.code, res.status)
  }
  return data as T
}

export function today(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
