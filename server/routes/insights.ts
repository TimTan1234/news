import type { FastifyInstance } from 'fastify'
import { storedBriefing, writeBriefing, type Briefing } from '../ai.ts'
import { ARTICLE_SELECT, toArticle, type Article, type ArticleRow, type DB } from '../db.ts'
import { currentTrends } from '../trending.ts'
import { isDay } from './articles.ts'

const DAY = 24 * 60 * 60 * 1000

function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10)
}

export function streak(readDays: Set<string>, today: string): number {
  let cursor = readDays.has(today) ? today : shiftDay(today, -1)
  let length = 0
  while (readDays.has(cursor)) {
    length++
    cursor = shiftDay(cursor, -1)
  }
  return length
}

function withArticles(db: DB, result: { briefing: Briefing; createdAt: number }) {
  const byId = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ?`)
  const articles: Record<number, Article> = {}
  for (const section of result.briefing.sections) {
    for (const story of section.stories) {
      for (const id of story.articleIds) {
        const row = byId.get(id) as ArticleRow | undefined
        if (row) articles[id] = toArticle(row)
      }
    }
  }
  return { ...result, articles }
}

export function insightRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/trending', () => currentTrends(db))

  app.get('/api/activity', () => {
    const rows = db
      .prepare(
        `SELECT h.tracker_id, h.created_at AS hit_at, h.seen_at AS hit_seen, k.phrase, x.*
         FROM tracker_hits h
         JOIN trackers k ON k.id = h.tracker_id
         JOIN (${ARTICLE_SELECT}) x ON x.id = h.article_id
         ORDER BY x.published_at DESC LIMIT 150`,
      )
      .all() as (ArticleRow & { tracker_id: number; hit_at: number; hit_seen: number | null; phrase: string })[]
    return rows.map((row) => ({
      tracker: { id: row.tracker_id, phrase: row.phrase },
      seen: row.hit_seen !== null,
      article: toArticle(row),
    }))
  })

  app.get('/api/activity/count', () => ({
    unseen: db.prepare('SELECT COUNT(*) FROM tracker_hits WHERE seen_at IS NULL').pluck().get() as number,
  }))

  app.post('/api/activity/seen', () => {
    db.prepare('UPDATE tracker_hits SET seen_at = ? WHERE seen_at IS NULL').run(Date.now())
    return { ok: true }
  })

  app.get<{ Querystring: { day?: string } }>('/api/stats', (req, reply) => {
    const { day } = req.query
    if (!isDay(day)) return reply.code(400).send({ error: 'day must be YYYY-MM-DD' })
    const counts = new Map(
      (db.prepare('SELECT day, count FROM reading_days').all() as { day: string; count: number }[]).map((row) => [row.day, row.count]),
    )
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = shiftDay(day, index - 6)
      return { day: date, count: counts.get(date) ?? 0 }
    })
    return {
      streak: streak(new Set(counts.keys()), day),
      today: counts.get(day) ?? 0,
      week,
      saved: db.prepare('SELECT COUNT(*) FROM articles WHERE saved_at IS NOT NULL').pluck().get() as number,
      liked: db.prepare('SELECT COUNT(*) FROM articles WHERE liked_at IS NOT NULL').pluck().get() as number,
      topics: db
        .prepare(
          `SELECT t.name, t.slug, COUNT(*) AS count
           FROM articles a JOIN sources s ON s.id = a.source_id JOIN topics t ON t.id = s.topic_id
           WHERE a.read_at >= ? GROUP BY t.id ORDER BY count DESC, t.position`,
        )
        .all(Date.now() - 30 * DAY),
    }
  })

  app.get<{ Querystring: { day?: string } }>('/api/briefing', (req, reply) => {
    const { day } = req.query
    if (!isDay(day)) return reply.code(400).send({ error: 'day must be YYYY-MM-DD' })
    const stored = storedBriefing(db, day)
    return stored ? withArticles(db, stored) : { briefing: null }
  })

  app.post<{ Body: { day?: string } }>('/api/briefing', async (req, reply) => {
    const { day } = req.body ?? {}
    if (!isDay(day)) return reply.code(400).send({ error: 'day must be YYYY-MM-DD' })
    return withArticles(db, await writeBriefing(db, day))
  })
}
