export interface SourceRef {
  id: number
  title: string
  icon: string | null
  site: string
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
  topic: { slug: string; name: string }
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

export class ApiError extends Error {}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = options.body !== undefined
  const res = await fetch(path, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`)
  return data as T
}

export function today(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
