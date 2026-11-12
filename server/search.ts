import { ARTICLE_SELECT, toArticle, type Article, type ArticleRow, type DB } from './db.ts'
import { Failure } from './errors.ts'
import { ingest, makeExcerpt, parseFeed, toEntry, type Entry } from './feeds.ts'
import { readText, request } from './http.ts'

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

interface Provider {
  id: string
  name: string
  site: string
  icon: string | null
  available: () => boolean
  search: (query: string, now: number) => Promise<Entry[]>
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await request(url, { headers: { 'user-agent': BROWSER, ...headers }, timeoutMs: 20_000 })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  return readText(res)
}

/** Bing News links pass through a click tracker; the article's own address is in its `url` parameter. */
export function unwrapBing(link: string | undefined): string | undefined {
  if (!link) return link
  try {
    const url = new URL(link)
    if (url.hostname.endsWith('bing.com') && url.pathname.includes('apiclick')) return url.searchParams.get('url') ?? link
  } catch {
    return link
  }
  return link
}

async function searchNews(query: string, now: number): Promise<Entry[]> {
  const feed = await parseFeed(await fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`))
  return feed.items.flatMap((item) => {
    const entry = toEntry({ ...item, link: unwrapBing(item.link) }, now)
    if (!entry) return []
    const image = item.newsImage ? `${item.newsImage.replace(/^http:/, 'https:')}&w=800&h=450&c=14` : entry.image
    return [{ ...entry, image, publisher: item.newsSource?.trim() || null }]
  })
}

export interface BilibiliVideo {
  title?: string
  bvid?: string
  pic?: string
  author?: string
  pubdate?: number
  description?: string
}

export function bilibiliEntry(video: BilibiliVideo, now: number): Entry | null {
  const title = makeExcerpt({ contentSnippet: video.title })
  if (!video.bvid || !title) return null
  return {
    url: `https://www.bilibili.com/video/${video.bvid}`,
    title,
    excerpt: makeExcerpt({ contentSnippet: video.description }),
    image: video.pic ? video.pic.replace(/^(https?:)?\/\//, 'https://') : null,
    author: video.author ?? null,
    publisher: video.author ?? null,
    publishedAt: video.pubdate ? Math.min(video.pubdate * 1000, now) : now,
  }
}

let bilibiliCookie: { value: string; at: number } | null = null

/** Bilibili's search API only answers clients that carry the anonymous cookies its homepage hands out. */
async function bilibiliSession(now: number): Promise<string> {
  if (!bilibiliCookie || now - bilibiliCookie.at > 60 * 60 * 1000) {
    const res = await request('https://www.bilibili.com/', { headers: { 'user-agent': BROWSER } })
    await res.body?.cancel().catch(() => {})
    bilibiliCookie = { value: res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; '), at: now }
  }
  return bilibiliCookie.value
}

async function searchBilibili(query: string, now: number): Promise<Entry[]> {
  const body = await fetchText(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&keyword=${encodeURIComponent(query)}`,
    { cookie: await bilibiliSession(now), referer: 'https://www.bilibili.com/' },
  )
  const data = JSON.parse(body) as { code: number; message?: string; data?: { result?: BilibiliVideo[] } }
  if (data.code !== 0) throw new Error(data.message ?? `Bilibili code ${data.code}`)
  return (data.data?.result ?? []).flatMap((video) => bilibiliEntry(video, now) ?? [])
}

const rsshub = () => process.env.RSSHUB_URL?.replace(/\/+$/, '')

async function searchWeibo(query: string, now: number): Promise<Entry[]> {
  const feed = await parseFeed(await fetchText(`${rsshub()}/weibo/keyword/${encodeURIComponent(query)}`))
  return feed.items.flatMap((item) => {
    const entry = toEntry(item, now, 'https://weibo.com')
    return entry ? [{ ...entry, publisher: entry.author }] : []
  })
}

const PROVIDERS: Provider[] = [
  { id: 'news', name: 'News', site: 'https://www.bing.com/news', icon: null, available: () => true, search: searchNews },
  {
    id: 'bilibili',
    name: 'Bilibili',
    site: 'https://www.bilibili.com',
    icon: 'https://www.bilibili.com/favicon.ico',
    available: () => true,
    search: searchBilibili,
  },
  {
    id: 'weibo',
    name: 'Weibo',
    site: 'https://weibo.com',
    icon: 'https://weibo.com/favicon.ico',
    available: () => Boolean(rsshub()),
    search: searchWeibo,
  },
]

export const availableProviders = () => PROVIDERS.filter((provider) => provider.available()).map(({ id, name }) => ({ id, name }))

function provider(id: string): Provider {
  const found = PROVIDERS.find((candidate) => candidate.id === id && candidate.available())
  if (!found) throw new Failure(400, 'search_unavailable', 'That search is not available')
  return found
}

/** A source that follows a search stores it as `search:<provider>:<query>` in place of a feed address. */
export function parseSearchUrl(feedUrl: string): { provider: string; query: string } | null {
  const match = feedUrl.match(/^search:([a-z]+):(.+)$/)
  return match ? { provider: match[1], query: match[2] } : null
}

export async function searchEntries(providerId: string, query: string, now: number): Promise<Entry[]> {
  return provider(providerId).search(query, now)
}

export function followedSearch(providerId: string, query: string) {
  const { name, site, icon } = provider(providerId)
  return { title: `${query} (${name})`, siteUrl: site, feedUrl: `search:${providerId}:${query}`, icon }
}

/** One-off results live under a hidden, unfollowed source per provider so they can be read, liked and saved like any story. */
function resultsBucket(db: DB, userId: number, found: Provider): number {
  const feedUrl = `search:${found.id}`
  db.prepare(
    `INSERT OR IGNORE INTO sources (user_id, kind, title, site_url, feed_url, icon_url, followed)
     VALUES (?, 'results', ?, ?, ?, ?, 0)`,
  ).run(userId, found.name, found.site, feedUrl, found.icon)
  return db.prepare('SELECT id FROM sources WHERE user_id = ? AND feed_url = ?').pluck().get(userId, feedUrl) as number
}

export async function searchAndStore(db: DB, userId: number, providerId: string, query: string): Promise<Article[]> {
  const found = provider(providerId)
  const now = Date.now()
  let entries: Entry[]
  try {
    entries = await found.search(query, now)
  } catch (error) {
    throw new Failure(502, 'search_failed', `${found.name} search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  ingest(db, { id: resultsBucket(db, userId, found), user_id: userId }, entries, now)
  const byUrl = db.prepare(`${ARTICLE_SELECT} WHERE a.user_id = ? AND a.url = ?`)
  return entries.flatMap((entry) => {
    const row = byUrl.get(userId, entry.url) as ArticleRow | undefined
    return row ? [toArticle(row)] : []
  })
}
