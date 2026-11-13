import type { FastifyInstance } from 'fastify'
import { ARTICLE_COLUMNS, ARTICLE_FROM, ARTICLE_SELECT, toArticle, type ArticleRow, type DB } from '../db.ts'
import { summarize, type Lang } from '../ai.ts'
import { Failure } from '../errors.ts'
import { refreshUser } from '../feeds.ts'
import { recordOutcome } from '../recommend.ts'
import { readable } from '../reader.ts'
import { alsoReporting, firstReport } from '../stories.ts'

const DAY = 24 * 60 * 60 * 1000
const STORY_WINDOW = 2 * DAY
const STORIES_PER_SOURCE = 10

export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
export const asLang = (value: unknown): Lang => (value === 'zh' ? 'zh' : 'en')

const notFound = () => new Failure(404, 'not_found', 'Article not found')

export function ftsQuery(text: string): string | null {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)
  if (!tokens) return null
  return tokens.map((token, index) => `"${token}"${index === tokens.length - 1 ? '*' : ''}`).join(' ')
}

const UNSPACED = /[぀-ヿ㐀-鿿가-힯]/

/**
 * The full-text index splits on spaces, which Chinese, Japanese and Korean do not use,
 * so those queries match as substrings instead.
 */
export function searchClause(text: string): { sql: string; params: string[] } | null {
  if (UNSPACED.test(text)) {
    const terms = text.split(/\s+/).filter(Boolean)
    return {
      sql: terms.map(() => `(a.title LIKE ? ESCAPE '\\' OR a.excerpt LIKE ? ESCAPE '\\')`).join(' AND '),
      params: terms.flatMap((term) => {
        const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`
        return [pattern, pattern]
      }),
    }
  }
  const match = ftsQuery(text)
  return match ? { sql: 'a.id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)', params: [match] } : null
}

interface FeedQuery {
  topic?: string
  source?: string
  filter?: string
  q?: string
  tracker?: string
  cursor?: string
  limit?: string
}

export function articleRoutes(app: FastifyInstance, db: DB): void {
  app.get<{ Querystring: FeedQuery }>('/api/feed', (req) => {
    const { topic, source, filter, q, tracker, cursor } = req.query
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 60)
    const where = ['a.user_id = ?', 'a.hidden_at IS NULL']
    const params: unknown[] = [req.userId]

    if (filter === 'saved') where.push('a.saved_at IS NOT NULL')
    else if (filter === 'liked') where.push('a.liked_at IS NOT NULL')
    // A search covers the account's own sources, followed or not, and leaves one-off web results out.
    else if (q !== undefined) where.push(`s.kind = 'feed'`)
    else if (!source) where.push('s.followed = 1')

    if (topic) {
      where.push('t.slug = ?')
      params.push(topic)
    }
    if (source) {
      where.push('s.id = ?')
      params.push(Number(source))
    }
    if (tracker) {
      where.push('a.id IN (SELECT article_id FROM tracker_hits WHERE tracker_id = ?)')
      params.push(Number(tracker))
    }
    if (q !== undefined) {
      const clause = searchClause(q)
      if (!clause) return { items: [], nextCursor: null }
      where.push(clause.sql)
      params.push(...clause.params)
    }
    // The home feed shows a story once, under the source that reported it first; every other view lists each article.
    const byStory = !filter && q === undefined && !source && !tracker
    if (byStory) {
      const first = firstReport({ topic })
      where.push(first.sql)
      params.push(...first.params)
    }
    if (cursor) {
      const [publishedAt, id] = cursor.split('_').map(Number)
      where.push('(a.published_at, a.id) < (?, ?)')
      params.push(publishedAt, id)
    }

    const rows = db
      .prepare(`${ARTICLE_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.published_at DESC, a.id DESC LIMIT ?`)
      .all(...params, limit + 1) as ArticleRow[]
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    const seenMark = cursor
      ? undefined
      : (db.prepare('SELECT MAX(published_at) FROM articles WHERE user_id = ? AND seen_at IS NOT NULL').pluck().get(req.userId) as
          | number
          | null)
    const also = byStory ? alsoReporting(db, page.map((row) => row.id)) : null
    return {
      items: page.map((row) => (also ? { ...toArticle(row), also: also.get(row.id) ?? [] } : toArticle(row))),
      nextCursor: rows.length > limit && last ? `${last.published_at}_${last.id}` : null,
      seenMark,
    }
  })

  app.get('/api/stories', (req) => {
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT ${ARTICLE_COLUMNS},
                  ROW_NUMBER() OVER (PARTITION BY a.source_id ORDER BY a.published_at DESC, a.id DESC) AS position
           ${ARTICLE_FROM}
           WHERE a.user_id = ? AND s.followed = 1 AND a.hidden_at IS NULL AND a.published_at >= ?
         ) WHERE position <= ? ORDER BY published_at, id`,
      )
      .all(req.userId, Date.now() - STORY_WINDOW, STORIES_PER_SOURCE) as ArticleRow[]

    const bySource = new Map<number, { title: string; items: ReturnType<typeof toArticle>[] }>()
    for (const row of rows) {
      const group = bySource.get(row.source_id) ?? { title: row.source_title, items: [] }
      group.items.push(toArticle(row))
      bySource.set(row.source_id, group)
    }
    return [...bySource.values()]
      .map(({ title, items }) => ({
        source: { ...items[0].source, title },
        topic: items[0].topic,
        unseen: items.filter((item) => !item.seen).length,
        latest: items.at(-1)!.publishedAt,
        items,
      }))
      .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.latest - a.latest)
  })

  app.get<{ Params: { id: string } }>('/api/articles/:id', (req) => {
    const id = Number(req.params.id)
    const row = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ? AND a.user_id = ?`).get(id, req.userId) as ArticleRow | undefined
    if (!row) throw notFound()
    const summary = db.prepare('SELECT lang, bullets FROM summaries WHERE article_id = ?').get(id) as
      | { lang: string; bullets: string }
      | undefined
    return {
      article: toArticle(row),
      summary: summary ? { lang: summary.lang, bullets: JSON.parse(summary.bullets) as string[] } : null,
    }
  })

  app.get<{ Params: { id: string } }>('/api/articles/:id/reader', async (req) => {
    const id = Number(req.params.id)
    const url = db.prepare('SELECT url FROM articles WHERE id = ? AND user_id = ?').pluck().get(id, req.userId) as string | undefined
    if (!url) throw notFound()
    const { html } = await readable(db, id, url)
    return { html }
  })

  app.post<{ Params: { id: string }; Body: { lang?: string } }>('/api/articles/:id/summary', async (req) => {
    const bullets = await summarize(db, req.userId, Number(req.params.id), asLang(req.body?.lang))
    if (!bullets) throw notFound()
    return { bullets }
  })

  for (const [action, column] of [['like', 'liked_at'], ['save', 'saved_at'], ['hide', 'hidden_at']] as const) {
    app.post<{ Params: { id: string }; Body: { on?: boolean } }>(`/api/articles/:id/${action}`, (req) => {
      const on = req.body?.on !== false
      db.prepare(`UPDATE articles SET ${column} = ? WHERE id = ? AND user_id = ?`).run(
        on ? Date.now() : null, Number(req.params.id), req.userId,
      )
      if (on) recordOutcome(db, req.userId, Number(req.params.id), action === 'hide' ? 'dismissed' : 'accepted')
      return { ok: true }
    })
  }

  app.post<{ Params: { id: string }; Body: { day?: string } }>('/api/articles/:id/read', (req) => {
    const { day } = req.body ?? {}
    if (!isDay(day)) throw new Failure(400, 'bad_request', 'day must be YYYY-MM-DD')
    const now = Date.now()
    const first = db
      .prepare(
        'UPDATE articles SET read_at = ?, seen_at = COALESCE(seen_at, ?) WHERE id = ? AND user_id = ? AND read_at IS NULL',
      )
      .run(now, now, Number(req.params.id), req.userId).changes
    if (first) {
      db.prepare(
        'INSERT INTO reading_days (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1',
      ).run(req.userId, day)
      recordOutcome(db, req.userId, Number(req.params.id), 'accepted', now)
    }
    return { ok: true }
  })

  app.post<{ Body: { ids?: number[] } }>('/api/articles/seen', (req) => {
    // Seeing one report of a story counts for the others, so their sources' rings do not offer it again.
    const mark = db.prepare(
      `UPDATE articles SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL AND (id = ? OR id IN (
         SELECT theirs.article_id FROM story_articles mine JOIN story_articles theirs ON theirs.story_id = mine.story_id
         WHERE mine.article_id = ?))`,
    )
    const now = Date.now()
    db.transaction(() => {
      for (const id of req.body?.ids ?? []) mark.run(now, req.userId, Number(id), Number(id))
    })()
    return { ok: true }
  })

  app.post('/api/refresh', (req) => refreshUser(db, req.userId))
}
