import Parser from 'rss-parser'
import { decodeHTML } from 'entities'
import { deleteArticles, type DB } from './db.ts'
import { attributes, fetchHtml, pool, readText, request } from './http.ts'
import { parseSearchUrl, searchDue, searchEntries, searchTracked } from './search.ts'
import { matchNewArticles } from './trackers.ts'

const DAY = 24 * 60 * 60 * 1000
export const RETENTION = 30 * DAY

interface MediaNode {
  $?: { url?: string; medium?: string; type?: string; width?: string }
}

export interface FeedItem {
  title?: string
  link?: string
  isoDate?: string
  creator?: unknown
  author?: unknown
  summary?: string
  content?: string
  contentSnippet?: string
  contentEncoded?: string
  enclosure?: { url?: string; type?: string }
  mediaContent?: MediaNode[]
  mediaThumbnail?: MediaNode[]
  mediaGroup?: { 'media:content'?: MediaNode[]; 'media:thumbnail'?: MediaNode[] }
  newsSource?: string
  newsImage?: string
}

export interface Entry {
  url: string
  title: string
  excerpt: string
  image: string | null
  author: string | null
  /** The outlet or account behind an item, when the feed itself is a search across many of them. */
  publisher?: string | null
  publishedAt: number
}

const parser = new Parser<{ title?: string; link?: string }, FeedItem>({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
      ['content:encoded', 'contentEncoded'],
      ['News:Source', 'newsSource'],
      ['News:Image', 'newsImage'],
    ],
  },
})

export function parseFeed(xml: string) {
  return parser.parseString(xml)
}

const IMAGE_FILE = /\.(avif|gif|jpe?g|png|webp)(\?|$)/i

function absolute(url: string | undefined, base?: string): string | null {
  if (!url) return null
  try {
    const resolved = new URL(decodeHTML(url.trim()), base)
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null
  } catch {
    return null
  }
}

function fromMedia(nodes: MediaNode[] | undefined): string | undefined {
  const images = (nodes ?? [])
    .map((node) => node.$)
    .filter((attrs): attrs is NonNullable<MediaNode['$']> => {
      if (!attrs?.url) return false
      if (attrs.medium) return attrs.medium === 'image'
      if (attrs.type) return attrs.type.startsWith('image/')
      return true
    })
  images.sort((a, b) => Number(b.width ?? 0) - Number(a.width ?? 0))
  return images[0]?.url
}

function fromMarkup(html: string | undefined): string | undefined {
  if (!html) return undefined
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    if (!attrs.src || attrs.width === '1' || attrs.height === '1') continue
    return attrs.src
  }
  return undefined
}

export function pickImage(item: FeedItem, base?: string): string | null {
  const enclosure =
    item.enclosure?.url && (item.enclosure.type?.startsWith('image/') || IMAGE_FILE.test(item.enclosure.url))
      ? item.enclosure.url
      : undefined
  const candidate =
    fromMedia(item.mediaContent) ??
    fromMedia(item.mediaThumbnail) ??
    fromMedia(item.mediaGroup?.['media:content']) ??
    fromMedia(item.mediaGroup?.['media:thumbnail']) ??
    enclosure ??
    fromMarkup(item.contentEncoded) ??
    fromMarkup(item.content) ??
    fromMarkup(item.summary)
  return absolute(candidate, base)
}

function plain(html: unknown): string {
  if (typeof html !== 'string') return ''
  return decodeHTML(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Some feeds give the author as a nested element (`<author><name>…</name></author>`) instead of text. */
function authorName(value: unknown): string | null {
  const nested = (value as { name?: unknown[] } | undefined)?.name?.[0]
  return plain(typeof value === 'string' ? value : nested) || null
}

export function makeExcerpt(item: FeedItem): string {
  let text = plain(item.summary) || plain(item.contentSnippet) || plain(item.content) || plain(item.contentEncoded)
  const aggregator = text.match(/Points:\s*(\d+)\s*#\s*Comments:\s*(\d+)/)
  if (aggregator) return `${aggregator[1]} points, ${aggregator[2]} comments`
  text = text
    .replace(/\s*The post .+ appeared first on .+$/i, '')
    .replace(/\s*(\[(…|\.\.\.)\]|Read more\s*(…|\.\.\.|»)?|Continue reading\s*(…|\.\.\.|→)?)\s*$/i, '')
    .trim()
  if (text.length <= 280) return text
  const cut = text.slice(0, 280)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 200)).replace(/[\s,;:.]+$/, '')}…`
}

export function normalizeUrl(link: string | undefined, base?: string): string | null {
  const href = absolute(link, base)
  if (!href) return null
  const url = new URL(href)
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key)
  }
  url.hash = ''
  return url.href
}

export function toEntry(item: FeedItem, now: number, base?: string): Entry | null {
  const url = normalizeUrl(item.link, base)
  const title = plain(item.title)
  if (!url || !title) return null
  const parsed = item.isoDate ? Date.parse(item.isoDate) : NaN
  const publishedAt = Number.isNaN(parsed) ? now : Math.min(parsed, now)
  if (publishedAt < now - RETENTION) return null
  return {
    url,
    title,
    excerpt: makeExcerpt(item),
    image: pickImage(item, base),
    author: authorName(item.creator) ?? authorName(item.author),
    publishedAt,
  }
}

export interface SourceRow {
  id: number
  user_id: number
  site_url: string
  feed_url: string
  etag: string | null
  last_modified: string | null
  fetched_at: number | null
}

/** Followed sources in ingest order: within an account, a story carried by two feeds stays with the earlier one. */
function followedSources(db: DB, userId?: number): SourceRow[] {
  return db
    .prepare(
      `SELECT s.id, s.user_id, s.site_url, s.feed_url, s.etag, s.last_modified, s.fetched_at
       FROM sources s LEFT JOIN topics t ON t.id = s.topic_id
       WHERE s.followed = 1 AND (? IS NULL OR s.user_id = ?)
       ORDER BY s.user_id, t.position, s.id`,
    )
    .all(userId ?? null, userId ?? null) as SourceRow[]
}

function dueSources(db: DB, userId?: number): SourceRow[] {
  const now = Date.now()
  return followedSources(db, userId).filter((source) => searchDue(source.feed_url, source.fetched_at, now))
}

export function ingest(db: DB, source: Pick<SourceRow, 'id' | 'user_id'>, entries: Entry[], now = Date.now()): number[] {
  const order = new Map(followedSources(db, source.user_id).map((followed, index) => [followed.id, index]))
  const existing = db.prepare('SELECT id, source_id FROM articles WHERE user_id = ? AND url = ?')
  const insert = db.prepare(
    `INSERT INTO articles (user_id, source_id, url, title, excerpt, image_url, author, publisher, published_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const reassign = db.prepare('UPDATE articles SET source_id = ? WHERE id = ?')
  const added: number[] = []
  db.transaction(() => {
    for (const entry of entries) {
      const found = existing.get(source.user_id, entry.url) as { id: number; source_id: number } | undefined
      if (!found) {
        const { lastInsertRowid } = insert.run(
          source.user_id, source.id, entry.url, entry.title, entry.excerpt, entry.image, entry.author,
          entry.publisher ?? null, entry.publishedAt, now,
        )
        added.push(Number(lastInsertRowid))
      } else if ((order.get(source.id) ?? Infinity) < (order.get(found.source_id) ?? Infinity)) {
        reassign.run(source.id, found.id)
      }
    }
  })()
  return added
}

type Fetched =
  | { entries: Entry[]; etag: string | null; lastModified: string | null }
  | { unchanged: true }
  | { error: string }

async function fetchSource(source: SourceRow, now: number): Promise<Fetched> {
  try {
    const search = parseSearchUrl(source.feed_url)
    if (search) return { entries: await searchEntries(search.provider, search.query, now), etag: null, lastModified: null }
    const headers: Record<string, string> = { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }
    if (source.etag) headers['if-none-match'] = source.etag
    if (source.last_modified) headers['if-modified-since'] = source.last_modified
    const res = await request(source.feed_url, { headers, timeoutMs: 20_000 })
    if (res.status === 304) return { unchanged: true }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { error: `HTTP ${res.status}` }
    }
    const feed = await parseFeed(await readText(res))
    const entries = feed.items
      .map((item) => toEntry(item, now, source.site_url))
      .filter((entry): entry is Entry => entry !== null)
    return { entries, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function metaImage(html: string, base: string): string | null {
  let fallback: string | null = null
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key === 'og:image' || key === 'og:image:secure_url') return absolute(attrs.content, base)
    if (key === 'twitter:image' || key === 'twitter:image:src') fallback ??= absolute(attrs.content, base)
  }
  return fallback
}

/**
 * Looks up a picture for stories that came without one. Left to itself it covers what will be shown:
 * stories from the accounts' own sources, suggestions and keyword matches, not every stored search result.
 */
export async function fillMissingImages(db: DB, only: { sourceId?: number; articleIds?: number[] } = {}): Promise<void> {
  const params = only.articleIds ?? (only.sourceId === undefined ? [] : [only.sourceId])
  const scope = only.articleIds
    ? `a.id IN (${only.articleIds.map(() => '?').join(', ') || 'NULL'})`
    : only.sourceId !== undefined
      ? 'a.source_id = ?'
      : `(s.kind = 'feed'
          OR EXISTS (SELECT 1 FROM suggestions g WHERE g.article_id = a.id)
          OR EXISTS (SELECT 1 FROM tracker_hits h WHERE h.article_id = a.id))`
  const pending = db
    .prepare(
      `SELECT a.id, a.url FROM articles a JOIN sources s ON s.id = a.source_id
       WHERE a.image_url IS NULL AND a.image_checked = 0 AND ${scope}
       ORDER BY a.published_at DESC LIMIT 40`,
    )
    .all(...params) as { id: number; url: string }[]
  const store = db.prepare('UPDATE articles SET image_url = ?, image_checked = 1 WHERE id = ?')
  await pool(pending, 5, async ({ id, url }) => {
    const html = await fetchHtml(url, { timeoutMs: 8_000, maxBytes: 300_000 }).catch(() => null)
    store.run(html ? metaImage(html, url) : null, id)
  })
}

export function siteIcon(html: string | null, siteUrl: string): string {
  let best: { href: string; weight: number } | null = null
  for (const [tag] of (html ?? '').matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    const rel = (attrs.rel ?? '').toLowerCase()
    const href = absolute(attrs.href, siteUrl)
    if (!href || !rel.includes('icon') || rel.includes('mask')) continue
    const size = Number(attrs.sizes?.split('x')[0] ?? 0)
    const weight = (rel.includes('apple-touch') ? 1000 : 0) + size
    if (!best || weight > best.weight) best = { href, weight }
  }
  return best?.href ?? new URL('/favicon.ico', siteUrl).href
}

async function fillMissingIcons(db: DB): Promise<void> {
  const pending = db.prepare(`SELECT id, site_url FROM sources WHERE icon_url IS NULL AND feed_url NOT LIKE 'search:%'`).all() as { id: number; site_url: string }[]
  const store = db.prepare('UPDATE sources SET icon_url = ? WHERE id = ?')
  await pool(pending, 5, async ({ id, site_url }) => {
    const html = await fetchHtml(site_url, { timeoutMs: 8_000, maxBytes: 200_000 }).catch(() => null)
    store.run(siteIcon(html, site_url), id)
  })
}

export function prune(db: DB, now = Date.now()): number {
  return deleteArticles(
    db,
    'published_at < ? AND liked_at IS NULL AND saved_at IS NULL AND read_at IS NULL',
    now - RETENTION,
  )
}

export interface RefreshResult {
  added: number
  failed: number
}

let running: Promise<RefreshResult> | null = null

type Tracked = { user_id: number; phrase: string }

export function refreshAll(db: DB): Promise<RefreshResult> {
  const trackers = db.prepare('SELECT user_id, phrase FROM trackers').all() as Tracked[]
  running ??= refresh(db, dueSources(db), trackers).finally(() => {
    running = null
  })
  return running
}

export function refreshUser(db: DB, userId: number): Promise<RefreshResult> {
  const trackers = db.prepare('SELECT user_id, phrase FROM trackers WHERE user_id = ?').all(userId) as Tracked[]
  return refresh(db, dueSources(db, userId), trackers)
}

export function refreshSource(db: DB, userId: number, sourceId: number): Promise<RefreshResult> {
  return refresh(db, followedSources(db, userId).filter((source) => source.id === sourceId), [], { sourceId })
}

async function refresh(db: DB, sources: SourceRow[], trackers: Tracked[] = [], images: { sourceId?: number } = {}): Promise<RefreshResult> {
  const now = Date.now()
  const [fetched, tracked] = await Promise.all([
    pool(sources, 6, (source) => fetchSource(source, now)),
    searchTracked(db, trackers, now),
  ])
  const succeed = db.prepare('UPDATE sources SET etag = ?, last_modified = ?, fetched_at = ?, error = NULL WHERE id = ?')
  const touch = db.prepare('UPDATE sources SET fetched_at = ?, error = NULL WHERE id = ?')
  const fail = db.prepare('UPDATE sources SET fetched_at = ?, error = ? WHERE id = ?')
  const added = tracked.added
  let failed = tracked.failed
  sources.forEach((source, index) => {
    const result = fetched[index]
    if ('error' in result) {
      failed++
      fail.run(now, result.error, source.id)
    } else if ('unchanged' in result) {
      touch.run(now, source.id)
    } else {
      added.push(...ingest(db, source, result.entries, now))
      succeed.run(result.etag, result.lastModified, now, source.id)
    }
  })
  matchNewArticles(db, added, now)
  await Promise.all([fillMissingImages(db, images), fillMissingIcons(db)])
  prune(db, now)
  return { added: added.length, failed }
}
