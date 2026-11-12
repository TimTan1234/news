import { parseFeed } from './feeds.ts'
import { attributes, readText, request } from './http.ts'

export interface Discovered {
  feedUrl: string
  siteUrl: string
  title: string
}

const COMMON_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']

export function feedLinks(html: string, base: string): string[] {
  const links: string[] = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    if (!attrs.href || !/alternate/i.test(attrs.rel ?? '') || !/(rss|atom)\+xml/i.test(attrs.type ?? '')) continue
    try {
      links.push(new URL(attrs.href, base).href)
    } catch {
      continue
    }
  }
  return links
}

async function load(url: string): Promise<{ body: string; url: string } | null> {
  try {
    const res = await request(url, { timeoutMs: 12_000 })
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return null
    }
    return { body: await readText(res, 5_000_000), url: res.url || url }
  } catch {
    return null
  }
}

async function asFeed(body: string, url: string, site?: string): Promise<Discovered | null> {
  try {
    const feed = await parseFeed(body)
    if (feed.items.length === 0 && !feed.title) return null
    const siteUrl = site ?? feed.link ?? new URL(url).origin
    return { feedUrl: url, siteUrl, title: feed.title?.trim() || new URL(siteUrl).hostname.replace(/^www\./, '') }
  } catch {
    return null
  }
}

export async function discover(input: string): Promise<Discovered | null> {
  const start = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`
  const page = await load(start)
  if (!page) return null

  const direct = await asFeed(page.body, page.url)
  if (direct) return direct

  const candidates = [...feedLinks(page.body, page.url), ...COMMON_PATHS.map((path) => new URL(path, page.url).href)]
  for (const candidate of candidates) {
    const loaded = await load(candidate)
    const feed = loaded && (await asFeed(loaded.body, loaded.url, page.url))
    if (feed) return feed
  }
  return null
}
