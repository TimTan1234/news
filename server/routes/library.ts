import type { FastifyInstance } from 'fastify'
import { deleteArticles, type DB } from '../db.ts'
import { discover } from '../discover.ts'
import { refreshAll, refreshSource } from '../feeds.ts'
import { exportOpml, parseOpml } from '../opml.ts'
import { matchNewTracker } from '../trackers.ts'

const SOURCE_SELECT = `
  SELECT s.id, s.title, s.site_url AS siteUrl, s.feed_url AS feedUrl, s.icon_url AS icon,
         s.followed, s.error, s.fetched_at AS fetchedAt, s.topic_id AS topicId,
         (SELECT COUNT(*) FROM articles a WHERE a.source_id = s.id) AS articles
  FROM sources s
`

interface SourceRecord {
  id: number
  followed: number | boolean
}

const present = <T extends SourceRecord>(row: T) => ({ ...row, followed: row.followed === 1 })

function slugify(db: DB, name: string): string {
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'topic'
  const taken = db.prepare('SELECT 1 FROM topics WHERE slug = ?')
  let slug = base
  for (let n = 2; taken.get(slug); n++) slug = `${base}-${n}`
  return slug
}

function addTopic(db: DB, name: string): number {
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM topics').pluck().get() as number
  return Number(
    db.prepare('INSERT INTO topics (name, slug, position) VALUES (?, ?, ?)').run(name, slugify(db, name), position).lastInsertRowid,
  )
}

function removeSource(db: DB, id: number): void {
  deleteArticles(db, 'source_id = ?', id)
  db.prepare('DELETE FROM sources WHERE id = ?').run(id)
}

export function libraryRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/topics', () =>
    db
      .prepare(
        `SELECT t.id, t.name, t.slug, (SELECT COUNT(*) FROM sources s WHERE s.topic_id = t.id) AS sources
         FROM topics t ORDER BY t.position, t.id`,
      )
      .all(),
  )

  app.post<{ Body: { name?: string } }>('/api/topics', (req, reply) => {
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'Name is required' })
    return { id: addTopic(db, name) }
  })

  app.patch<{ Params: { id: string }; Body: { name?: string } }>('/api/topics/:id', (req, reply) => {
    const name = req.body?.name?.trim()
    if (!name) return reply.code(400).send({ error: 'Name is required' })
    db.prepare('UPDATE topics SET name = ? WHERE id = ?').run(name, Number(req.params.id))
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/topics/:id', (req) => {
    const id = Number(req.params.id)
    db.transaction(() => {
      const sources = db.prepare('SELECT id FROM sources WHERE topic_id = ?').pluck().all(id) as number[]
      sources.forEach((source) => removeSource(db, source))
      db.prepare('DELETE FROM topics WHERE id = ?').run(id)
    })()
    return { ok: true }
  })

  app.get('/api/sources', () => (db.prepare(`${SOURCE_SELECT} ORDER BY s.title COLLATE NOCASE`).all() as SourceRecord[]).map(present))

  app.post<{ Body: { url?: string; topicId?: number } }>('/api/sources', async (req, reply) => {
    const { url, topicId } = req.body ?? {}
    if (!url?.trim() || !topicId) return reply.code(400).send({ error: 'A URL and a topic are required' })
    const found = await discover(url)
    if (!found) return reply.code(422).send({ error: 'No feed found at that address' })
    const existing = db.prepare('SELECT id FROM sources WHERE feed_url = ?').pluck().get(found.feedUrl) as number | undefined
    if (existing) return reply.code(409).send({ error: 'That source is already in your list' })
    const id = Number(
      db
        .prepare('INSERT INTO sources (topic_id, title, site_url, feed_url) VALUES (?, ?, ?, ?)')
        .run(topicId, found.title, found.siteUrl, found.feedUrl).lastInsertRowid,
    )
    await refreshSource(db, id)
    return present(db.prepare(`${SOURCE_SELECT} WHERE s.id = ?`).get(id) as SourceRecord)
  })

  app.patch<{ Params: { id: string }; Body: { followed?: boolean; topicId?: number; title?: string } }>(
    '/api/sources/:id',
    (req) => {
      const id = Number(req.params.id)
      const { followed, topicId, title } = req.body ?? {}
      if (followed !== undefined) db.prepare('UPDATE sources SET followed = ? WHERE id = ?').run(followed ? 1 : 0, id)
      if (topicId) db.prepare('UPDATE sources SET topic_id = ? WHERE id = ?').run(topicId, id)
      if (title?.trim()) db.prepare('UPDATE sources SET title = ? WHERE id = ?').run(title.trim(), id)
      if (followed) void refreshSource(db, id).catch((error) => app.log.error(error))
      return { ok: true }
    },
  )

  app.delete<{ Params: { id: string } }>('/api/sources/:id', (req) => {
    db.transaction(() => removeSource(db, Number(req.params.id)))()
    return { ok: true }
  })

  app.get('/api/trackers', () =>
    db
      .prepare(
        `SELECT t.id, t.phrase,
                (SELECT COUNT(*) FROM tracker_hits h WHERE h.tracker_id = t.id) AS hits,
                (SELECT COUNT(*) FROM tracker_hits h WHERE h.tracker_id = t.id AND h.seen_at IS NULL) AS unseen
         FROM trackers t ORDER BY t.created_at DESC`,
      )
      .all(),
  )

  app.post<{ Body: { phrase?: string } }>('/api/trackers', (req, reply) => {
    const phrase = req.body?.phrase?.trim().replace(/\s+/g, ' ')
    if (!phrase) return reply.code(400).send({ error: 'Keyword is required' })
    if (db.prepare('SELECT 1 FROM trackers WHERE phrase = ?').get(phrase)) {
      return reply.code(409).send({ error: 'You already track that keyword' })
    }
    const id = Number(db.prepare('INSERT INTO trackers (phrase, created_at) VALUES (?, ?)').run(phrase, Date.now()).lastInsertRowid)
    return { id, hits: matchNewTracker(db, id) }
  })

  app.delete<{ Params: { id: string } }>('/api/trackers/:id', (req) => {
    const id = Number(req.params.id)
    db.transaction(() => {
      db.prepare('DELETE FROM tracker_hits WHERE tracker_id = ?').run(id)
      db.prepare('DELETE FROM trackers WHERE id = ?').run(id)
    })()
    return { ok: true }
  })

  app.get('/api/opml', (_req, reply) =>
    reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pulse-sources.opml"')
      .send(exportOpml(db)),
  )

  app.post<{ Body: { xml?: string } }>('/api/opml', (req, reply) => {
    const sources = parseOpml(req.body?.xml ?? '')
    if (sources.length === 0) return reply.code(422).send({ error: 'No feeds found in that file' })
    const topicByName = db.prepare('SELECT id FROM topics WHERE name = ? COLLATE NOCASE').pluck()
    const insert = db.prepare('INSERT OR IGNORE INTO sources (topic_id, title, site_url, feed_url) VALUES (?, ?, ?, ?)')
    let added = 0
    db.transaction(() => {
      for (const source of sources) {
        const topicId = (topicByName.get(source.topic) as number | undefined) ?? addTopic(db, source.topic)
        added += insert.run(topicId, source.title, source.siteUrl, source.feedUrl).changes
      }
    })()
    void refreshAll(db).catch((error) => app.log.error(error))
    return { added }
  })
}
