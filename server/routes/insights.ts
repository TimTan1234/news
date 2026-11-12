import type { FastifyInstance } from 'fastify'
import { storedBriefing, writeBriefing, type Briefing } from '../ai.ts'
import { ARTICLE_SELECT, toArticle, type Article, type ArticleRow, type DB } from '../db.ts'
import { Failure } from '../errors.ts'
import { currentTrends } from '../trending.ts'
import { asLang, isDay } from './articles.ts'

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

function requireDay(day: unknown): string {
  if (!isDay(day)) throw new Failure(400, 'bad_request', 'day must be YYYY-MM-DD')
  return day
}

function withArticles(db: DB, userId: number, result: { briefing: Briefing; createdAt: number }) {
  const byId = db.prepare(`${ARTICLE_SELECT} WHERE a.id = ? AND a.user_id = ?`)
  const articles: Record<number, Article> = {}
  for (const section of result.briefing.sections) {
    for (const story of section.stories) {
      for (const id of story.articleIds) {
        const row = byId.get(id, userId) as ArticleRow | undefined
        if (row) articles[id] = toArticle(row)
      }
    }
  }
  return { ...result, articles }
}

export function insightRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/trending', (req) => currentTrends(db, req.userId))

  app.get('/api/activity', (req) => {
    const rows = db
      .prepare(
        `SELECT h.tracker_id, h.seen_at AS hit_seen, k.phrase, x.*
         FROM tracker_hits h
         JOIN trackers k ON k.id = h.tracker_id
         JOIN (${ARTICLE_SELECT}) x ON x.id = h.article_id
         WHERE k.user_id = ?
         ORDER BY x.published_at DESC LIMIT 150`,
      )
      .all(req.userId) as (ArticleRow & { tracker_id: number; hit_seen: number | null; phrase: string })[]
    return rows.map((row) => ({
      tracker: { id: row.tracker_id, phrase: row.phrase },
      seen: row.hit_seen !== null,
      article: toArticle(row),
    }))
  })

  const unseenHits = `FROM tracker_hits WHERE seen_at IS NULL AND tracker_id IN (SELECT id FROM trackers WHERE user_id = ?)`

  app.get('/api/activity/count', (req) => ({
    unseen: db.prepare(`SELECT COUNT(*) ${unseenHits}`).pluck().get(req.userId) as number,
  }))

  app.post('/api/activity/seen', (req) => {
    db.prepare(
      'UPDATE tracker_hits SET seen_at = ? WHERE seen_at IS NULL AND tracker_id IN (SELECT id FROM trackers WHERE user_id = ?)',
    ).run(Date.now(), req.userId)
    return { ok: true }
  })

  app.get<{ Querystring: { day?: string } }>('/api/stats', (req) => {
    const day = requireDay(req.query.day)
    const counts = new Map(
      (db.prepare('SELECT day, count FROM reading_days WHERE user_id = ?').all(req.userId) as { day: string; count: number }[]).map(
        (row) => [row.day, row.count],
      ),
    )
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = shiftDay(day, index - 6)
      return { day: date, count: counts.get(date) ?? 0 }
    })
    const total = (column: string) =>
      db.prepare(`SELECT COUNT(*) FROM articles WHERE user_id = ? AND ${column} IS NOT NULL`).pluck().get(req.userId) as number
    return {
      streak: streak(new Set(counts.keys()), day),
      today: counts.get(day) ?? 0,
      week,
      saved: total('saved_at'),
      liked: total('liked_at'),
      topics: db
        .prepare(
          `SELECT t.name, t.slug, COUNT(*) AS count
           FROM articles a JOIN sources s ON s.id = a.source_id JOIN topics t ON t.id = s.topic_id
           WHERE a.user_id = ? AND a.read_at >= ? GROUP BY t.id ORDER BY count DESC, t.position`,
        )
        .all(req.userId, Date.now() - 30 * DAY),
    }
  })

  app.get<{ Querystring: { day?: string; lang?: string } }>('/api/briefing', (req) => {
    const stored = storedBriefing(db, req.userId, requireDay(req.query.day), asLang(req.query.lang))
    return stored ? withArticles(db, req.userId, stored) : { briefing: null }
  })

  app.post<{ Body: { day?: string; lang?: string } }>('/api/briefing', async (req) =>
    withArticles(db, req.userId, await writeBriefing(db, req.userId, requireDay(req.body?.day), asLang(req.body?.lang))),
  )
}
