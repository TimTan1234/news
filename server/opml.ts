import { decodeHTML, escapeAttribute } from 'entities'
import type { DB } from './db.ts'
import { attributes } from './http.ts'

export interface OpmlSource {
  topic: string
  title: string
  siteUrl: string
  feedUrl: string
}

export function exportOpml(db: DB, userId: number): string {
  const topics = db.prepare('SELECT id, name FROM topics WHERE user_id = ? ORDER BY position, id').all(userId) as {
    id: number
    name: string
  }[]
  // Sources that follow a search have no feed address another reader could use.
  const sources = db.prepare(`SELECT title, site_url, feed_url FROM sources WHERE topic_id = ? AND feed_url LIKE 'http%' ORDER BY id`)
  const body = topics
    .map((topic) => {
      const rows = sources.all(topic.id) as { title: string; site_url: string; feed_url: string }[]
      const outlines = rows.map(
        (row) =>
          `      <outline type="rss" text="${escapeAttribute(row.title)}" xmlUrl="${escapeAttribute(row.feed_url)}" htmlUrl="${escapeAttribute(row.site_url)}"/>`,
      )
      return `    <outline text="${escapeAttribute(topic.name)}">\n${outlines.join('\n')}\n    </outline>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Pulse sources</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`
}

export function parseOpml(xml: string, fallbackTopic = 'Imported'): OpmlSource[] {
  const found: OpmlSource[] = []
  const stack: string[] = []
  for (const [tag, closing, , selfClosing] of xml.matchAll(/<(\/?)outline\b([^>]*?)(\/?)>/gi)) {
    if (closing) {
      stack.pop()
      continue
    }
    const attrs = attributes(tag)
    const label = decodeHTML(attrs.text ?? attrs.title ?? '')
    const feedUrl = attrs.xmlurl && decodeHTML(attrs.xmlurl)
    if (feedUrl) {
      let siteUrl = attrs.htmlurl ? decodeHTML(attrs.htmlurl) : ''
      try {
        siteUrl ||= new URL(feedUrl).origin
        found.push({ topic: stack.at(-1) || fallbackTopic, title: label || new URL(feedUrl).hostname, siteUrl, feedUrl })
      } catch {
        continue
      }
    }
    if (!selfClosing) stack.push(feedUrl ? stack.at(-1) ?? '' : label)
  }
  return found
}
