import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import sanitizeHtml from 'sanitize-html'
import type { DB } from './db.ts'
import { fetchHtml } from './http.ts'

export interface Readable {
  html: string | null
  text: string
}

const MIN_TEXT = 400

function resolve(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function clean(html: string, base: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'h2', 'h3', 'h4', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup',
      'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'loading', 'referrerpolicy'],
    },
    transformTags: {
      h1: 'h2',
      a: (tagName, attribs) => {
        const href = resolve(attribs.href, base)
        const kept: Record<string, string> = href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {}
        return { tagName, attribs: kept }
      },
      img: (tagName, attribs) => {
        const src = resolve(attribs.src ?? attribs['data-src'], base)
        const kept: Record<string, string> = src
          ? { src, alt: attribs.alt ?? '', loading: 'lazy', referrerpolicy: 'no-referrer' }
          : {}
        return { tagName, attribs: kept }
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  })
}

export function extract(pageHtml: string, url: string): Readable {
  const { document } = parseHTML(pageHtml)
  const article = new Readability(document as unknown as Document).parse()
  const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!article?.content || text.length < MIN_TEXT) return { html: null, text: '' }
  return { html: clean(article.content, url), text }
}

export async function readable(db: DB, articleId: number, url: string): Promise<Readable> {
  const cached = db.prepare('SELECT html, text FROM reader_cache WHERE article_id = ?').get(articleId) as Readable | undefined
  if (cached) return cached
  let result: Readable = { html: null, text: '' }
  try {
    const page = await fetchHtml(url, { timeoutMs: 15_000, maxBytes: 3_000_000 })
    if (page) result = extract(page, url)
  } catch {
    return result
  }
  db.prepare('INSERT OR REPLACE INTO reader_cache (article_id, html, text) VALUES (?, ?, ?)').run(
    articleId, result.html, result.text,
  )
  return result
}
