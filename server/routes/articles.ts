import type { FastifyInstance } from 'fastify'
import { ARTICLE_COLUMNS, ARTICLE_FROM, ARTICLE_SELECT, toArticle, type ArticleRow, type DB } from '../db.ts'
import { summarize } from '../ai.ts'
import { refreshAll } from '../feeds.ts'
import { readable } from '../reader.ts'

const DAY = 24 * 60 * 60 * 1000
const STORY_WINDOW = 2 * DAY
const STORIES_PER_SOURCE = 10

export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function ftsQuery(text: string): string | null {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)
  if (!tokens) return null
  return tokens.map((token, index) => `"${token}"${index === tokens.length - 1 ? '*' : ''}`).join(' ')
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
    const where = ['a.hidden_at IS NULL']
    const params: unknown[] = []

    if (filter === 'saved') where.push('a.saved_at IS NOT NULL')
    else if (filter === 'liked') where.push('a.liked_at IS NOT NULL')
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
      const match = ftsQuery(q)
      if (!match) return { items: [], nextCursor: null }
      where.push('a.id IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)')
      params.push(match)
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
      : (db.prepare('SELECT MAX(published_at) FROM articles WHERE seen_at IS NOT NULL').pluck().get() as number | null)
    return {
      items: page.map(toArticle),
      nextCursor: rows.length > limit && last ? `${last.published_at}_${last.id}` : null,
      seenMark,
    }
  })

  app.get('/api/stories', () => {
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT ${ARTICLE_COLUMNS},
                  ROW_NUMBER() OVER (PARTITION BY a.source_id ORDER BY a.published_at DESC, a.id DESC) AS position
           ${ARTICLE_FROM}
           WHERE s.followed = 1 AND a.hidden_at IS NULL AND a.published_at >= ?
         ) WHERE position <= ? ORDER BY published_at, id`,
      )
      .all(Date.now() - STORY_WINDOW, STORIES_PER_SOURCE) as ArticleRow[]

    const bySource = new Map<number, ReturnType<typeof toArticle>[]>()
    for (const row of rows) {
      const list = bySource.get(row.source_id) ?? []
      list.push(toArticle(row))
      bySource.set(row.source_id, list)
    }
    return [...bySource.values()]
      .map((items) => ({
        source: items[0].source,
        topic: items[0].topic,
        unseen: items.filter((item) => !item.seen).length,
        latest: items.at(-1)!.publishedAt,
        items,
      }))
      .sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0) || b.latest - a.latest)
  })

  app.get<{ Params: { id: string } }>('/api/articles/:id', (req, reply) => {
    const id = Number(req.params.id)
    const row = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ?`).get(id) as ArticleRow | undefined
    if (!row) return reply.code(404).send({ error: 'Article not found' })
    const bullets = db.prepare('SELECT bullets FROM summaries WHERE article_id = ?').pluck().get(id) as string | undefined
    return { article: toArticle(row), summary: bullets ? (JSON.parse(bullets) as string[]) : null }
  })

  app.get<{ Params: { id: string } }>('/api/articles/:id/reader', async (req, reply) => {
    const id = Number(req.params.id)
    const url = db.prepare('SELECT url FROM articles WHERE id = ?').pluck().get(id) as string | undefined
    if (!url) return reply.code(404).send({ error: 'Article not found' })
    const { html } = await readable(db, id, url)
    return { html }
  })

  app.post<{ Params: { id: string } }>('/api/articles/:id/summary', async (req, reply) => {
    const bullets = await summarize(db, Number(req.params.id))
    if (!bullets) return reply.code(404).send({ error: 'Article not found' })
    return { bullets }
  })

  for (const [action, column] of [['like', 'liked_at'], ['save', 'saved_at'], ['hide', 'hidden_at']] as const) {
    app.post<{ Params: { id: string }; Body: { on?: boolean } }>(`/api/articles/:id/${action}`, (req) => {
      const on = req.body?.on !== false
      db.prepare(`UPDATE articles SET ${column} = ? WHERE id = ?`).run(on ? Date.now() : null, Number(req.params.id))
      return { ok: true }
    })
  }

  app.post<{ Params: { id: string }; Body: { day?: string } }>('/api/articles/:id/read', (req, reply) => {
    const { day } = req.body ?? {}
    if (!isDay(day)) return reply.code(400).send({ error: 'day must be YYYY-MM-DD' })
    const now = Date.now()
    const first = db
      .prepare('UPDATE articles SET read_at = ?, seen_at = COALESCE(seen_at, ?) WHERE id = ? AND read_at IS NULL')
      .run(now, now, Number(req.params.id)).changes
    if (first) {
      db.prepare('INSERT INTO reading_days (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').run(day)
    }
    return { ok: true }
  })

  app.post<{ Body: { ids?: number[] } }>('/api/articles/seen', (req) => {
    const mark = db.prepare('UPDATE articles SET seen_at = ? WHERE id = ? AND seen_at IS NULL')
    const now = Date.now()
    db.transaction(() => {
      for (const id of req.body?.ids ?? []) mark.run(now, Number(id))
    })()
    return { ok: true }
  })

  app.post('/api/refresh', () => refreshAll(db))
}
