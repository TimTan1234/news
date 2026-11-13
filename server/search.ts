import { ARTICLE_SELECT, toArticle, type Article, type ArticleRow, type DB } from './db.ts'
import { Failure } from './errors.ts'
import { ingest, makeExcerpt, parseFeed, toEntry, type Entry } from './feeds.ts'
import { BROWSER, pool, readText, request } from './http.ts'
import { matchNewArticles } from './trackers.ts'
import * as xiaohongshu from './xiaohongshu.ts'

interface Provider {
  id: string
  name: string
  site: string
  icon: string | null
  available: () => boolean
  /** Whether the provider can take a search for every tracked keyword and every followed search at every refresh. */
  background: boolean
  /** Set where Chinese phrases find nothing worth the request. */
  latinOnly?: boolean
  /** The most searches one round of suggestions may spend here, where the provider meters them. */
  perRound?: number
  search: (query: string, now: number) => Promise<Entry[]>
}

const DAY = 24 * 60 * 60 * 1000
const CJK = /[\u3400-\u9fff]/

async function fetchJson<T>(url: string, options: { headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<T> {
  const res = await request(url, { ...options, headers: { accept: 'application/json', ...options.headers }, timeoutMs: 20_000 })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  return JSON.parse(await readText(res)) as T
}

async function fetchText(url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<string> {
  const res = await request(url, { headers: { 'user-agent': BROWSER, ...headers }, timeoutMs })
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
  // The API wraps the matched words in <em>; dropping the tags first keeps the title's own spacing.
  const title = makeExcerpt({ contentSnippet: video.title?.replace(/<\/?em\b[^>]*>/g, '') })
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

/** RSSHub opens Weibo in a browser of its own, which can take most of a minute when it has to start a session. */
async function searchWeibo(query: string, now: number): Promise<Entry[]> {
  const feed = await parseFeed(await fetchText(`${rsshub()}/weibo/keyword/${encodeURIComponent(query)}`, {}, 60_000))
  return feed.items.flatMap((item) => {
    const entry = toEntry(item, now, 'https://weibo.com')
    if (!entry) return []
    // RSSHub opens each post's title with its author, who is already shown as the publisher.
    const lead = `${entry.author}: `
    return [{ ...entry, title: entry.author && entry.title.startsWith(lead) ? entry.title.slice(lead.length) : entry.title, publisher: entry.author }]
  })
}

export interface HackerNewsHit {
  objectID: string
  title?: string | null
  url?: string | null
  author?: string
  points?: number | null
  num_comments?: number | null
  created_at_i?: number
}

export function hackerNewsEntry(hit: HackerNewsHit, now: number): Entry | null {
  const title = hit.title?.trim()
  if (!title) return null
  return {
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title,
    excerpt: `${hit.points ?? 0} points, ${hit.num_comments ?? 0} comments`,
    image: null,
    author: hit.author ?? null,
    publisher: 'Hacker News',
    publishedAt: hit.created_at_i ? Math.min(hit.created_at_i * 1000, now) : now,
  }
}

async function searchHackerNews(query: string, now: number): Promise<Entry[]> {
  const data = await fetchJson<{ hits?: HackerNewsHit[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=20&query=${encodeURIComponent(query)}`,
  )
  return (data.hits ?? []).flatMap((hit) => hackerNewsEntry(hit, now) ?? [])
}

export interface GitHubRepo {
  full_name?: string
  html_url?: string
  description?: string | null
  pushed_at?: string
  stargazers_count?: number
  owner?: { login?: string }
}

export function gitHubEntry(repo: GitHubRepo, now: number): Entry | null {
  if (!repo.full_name || !repo.html_url) return null
  const pushed = repo.pushed_at ? Date.parse(repo.pushed_at) : NaN
  const stars = repo.stargazers_count ?? 0
  return {
    url: repo.html_url,
    title: repo.full_name,
    excerpt: repo.description?.trim() ? `${repo.description.trim()} (${stars} stars)` : `${stars} stars`,
    image: `https://opengraph.githubassets.com/1/${repo.full_name}`,
    author: repo.owner?.login ?? null,
    publisher: 'GitHub',
    publishedAt: Number.isFinite(pushed) ? Math.min(pushed, now) : now,
  }
}

/** Repositories that match and were pushed to in the last two weeks, the most starred first. */
async function searchGitHub(query: string, now: number): Promise<Entry[]> {
  const since = new Date(now - 14 * DAY).toISOString().slice(0, 10)
  const data = await fetchJson<{ items?: GitHubRepo[] }>(
    `https://api.github.com/search/repositories?sort=stars&order=desc&per_page=20&q=${encodeURIComponent(`${query} pushed:>${since}`)}`,
    { headers: { accept: 'application/vnd.github+json' } },
  )
  return (data.items ?? []).flatMap((repo) => gitHubEntry(repo, now) ?? [])
}

export interface YouTubeItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    channelTitle?: string
    publishedAt?: string
    thumbnails?: Record<string, { url?: string } | undefined>
  }
}

export function youTubeEntry(item: YouTubeItem, now: number): Entry | null {
  const snippet = item.snippet
  const title = makeExcerpt({ contentSnippet: snippet?.title })
  if (!item.id?.videoId || !title) return null
  const published = snippet?.publishedAt ? Date.parse(snippet.publishedAt) : NaN
  const thumbnails = snippet?.thumbnails ?? {}
  return {
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    title,
    excerpt: makeExcerpt({ contentSnippet: snippet?.description }),
    image: (thumbnails.high ?? thumbnails.medium ?? thumbnails.default)?.url ?? null,
    author: snippet?.channelTitle ?? null,
    publisher: snippet?.channelTitle ?? null,
    publishedAt: Number.isFinite(published) ? Math.min(published, now) : now,
  }
}

/** Each search costs 100 of the Data API's 10,000 daily units, so YouTube stays out of the background refresh and a round spends only a few. */
async function searchYouTube(query: string, now: number): Promise<Entry[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'relevance',
    maxResults: '20',
    publishedAfter: new Date(now - 14 * DAY).toISOString(),
    q: query,
    key: process.env.YOUTUBE_API_KEY ?? '',
  })
  const data = await fetchJson<{ items?: YouTubeItem[] }>(`https://www.googleapis.com/youtube/v3/search?${params}`)
  return (data.items ?? []).flatMap((item) => youTubeEntry(item, now) ?? [])
}

export function xiaohongshuEntry(note: xiaohongshu.Note, now: number): Entry | null {
  const card = note.noteCard
  const title = card?.displayTitle?.trim()
  if (!note.id || !title) return null
  const cover = card?.cover?.urlDefault || card?.cover?.urlPre || card?.cover?.url
  const author = card?.user?.nickname || card?.user?.nickName || null
  // A note's page only opens with the token its search result came with.
  const token = note.xsecToken ? `?xsec_token=${encodeURIComponent(note.xsecToken)}&xsec_source=pc_search` : ''
  return {
    url: `https://www.xiaohongshu.com/explore/${note.id}${token}`,
    title,
    excerpt: `${card?.interactInfo?.likedCount || 0} 赞，${card?.interactInfo?.commentCount || 0} 评论`,
    image: cover ? cover.replace(/^http:/, 'https:') : null,
    author,
    publisher: author,
    // Search results carry no date; the search itself is limited to the last week.
    publishedAt: now,
  }
}

/** Runs in the signed-in browser of the Xiaohongshu service, so it stays out of the background refresh and a round spends only a few. */
async function searchXiaohongshu(query: string, now: number): Promise<Entry[]> {
  return (await xiaohongshu.search(query)).flatMap((note) => xiaohongshuEntry(note, now) ?? [])
}

const PROVIDERS: Provider[] = [
  { id: 'news', name: 'News', site: 'https://www.bing.com/news', icon: null, available: () => true, background: true, search: searchNews },
  {
    id: 'bilibili',
    name: 'Bilibili',
    site: 'https://www.bilibili.com',
    icon: 'https://www.bilibili.com/favicon.ico',
    available: () => true,
    background: true,
    search: searchBilibili,
  },
  {
    id: 'weibo',
    name: 'Weibo',
    site: 'https://weibo.com',
    icon: 'https://weibo.com/favicon.ico',
    available: () => Boolean(rsshub()),
    background: true,
    search: searchWeibo,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    site: 'https://www.youtube.com',
    icon: 'https://www.youtube.com/favicon.ico',
    available: () => Boolean(process.env.YOUTUBE_API_KEY),
    background: false,
    perRound: 4,
    search: searchYouTube,
  },
  {
    id: 'xiaohongshu',
    name: 'Xiaohongshu',
    site: 'https://www.xiaohongshu.com',
    icon: 'https://www.xiaohongshu.com/favicon.ico',
    available: () => xiaohongshu.connection().connected,
    background: false,
    perRound: 3,
    search: searchXiaohongshu,
  },
  {
    id: 'hackernews',
    name: 'Hacker News',
    site: 'https://news.ycombinator.com',
    icon: 'https://news.ycombinator.com/favicon.ico',
    available: () => true,
    background: true,
    latinOnly: true,
    search: searchHackerNews,
  },
  {
    id: 'github',
    name: 'GitHub',
    site: 'https://github.com',
    icon: 'https://github.com/favicon.ico',
    available: () => true,
    background: false,
    latinOnly: true,
    perRound: 8,
    search: searchGitHub,
  },
]

/** The providers worth asking about a phrase when looking for stories to suggest. */
export const discoveryProviders = (query: string) =>
  PROVIDERS.filter((found) => found.available() && !(found.latinOnly && CJK.test(query))).map(({ id, name, perRound }) => ({ id, name, perRound }))

export const providerName = (id: string) => PROVIDERS.find((found) => found.id === id)?.name ?? id

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

/** A followed search on a provider that meters its searches runs once a day; the rest run at every refresh. */
export function searchDue(feedUrl: string, fetchedAt: number | null, now: number): boolean {
  const search = parseSearchUrl(feedUrl)
  const found = search && PROVIDERS.find((candidate) => candidate.id === search.provider)
  return !found || found.background || fetchedAt === null || now - fetchedAt >= DAY
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

/** Runs one search and stores what it finds; returns the article id of every result, new or already stored. */
export async function searchInto(db: DB, userId: number, providerId: string, query: string, now = Date.now()): Promise<number[]> {
  const found = provider(providerId)
  let entries: Entry[]
  try {
    entries = await found.search(query, now)
  } catch (error) {
    if (error instanceof Failure) throw error
    throw new Failure(502, 'search_failed', `${found.name} search failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  matchNewArticles(db, ingest(db, { id: resultsBucket(db, userId, found), user_id: userId }, entries, now), now)
  const byUrl = db.prepare('SELECT id FROM articles WHERE user_id = ? AND url = ?').pluck()
  return entries.flatMap((entry) => (byUrl.get(userId, entry.url) as number | undefined) ?? [])
}

export async function searchAndStore(db: DB, userId: number, providerId: string, query: string): Promise<Article[]> {
  const byId = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ?`)
  return (await searchInto(db, userId, providerId, query)).map((id) => toArticle(byId.get(id) as ArticleRow))
}

/**
 * Runs every available search for each tracked phrase and stores what comes back, so a keyword
 * reaches stories that none of the account's own sources carry. Returns the ids of the new articles.
 */
export async function searchTracked(
  db: DB,
  trackers: { user_id: number; phrase: string }[],
  now = Date.now(),
): Promise<{ added: number[]; failed: number }> {
  const jobs = trackers.flatMap((tracker) =>
    PROVIDERS.filter((found) => found.available() && found.background && !(found.latinOnly && CJK.test(tracker.phrase))).map((found) => ({
      tracker,
      found,
    })),
  )
  let failed = 0
  const added = await pool(jobs, 4, async ({ tracker, found }) => {
    try {
      const entries = await found.search(tracker.phrase, now)
      return ingest(db, { id: resultsBucket(db, tracker.user_id, found), user_id: tracker.user_id }, entries, now)
    } catch {
      failed++
      return []
    }
  })
  return { added: added.flat(), failed }
}
