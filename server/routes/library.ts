import type { FastifyInstance } from 'fastify'
import { deleteArticles, type DB } from '../db.ts'
import { discover } from '../discover.ts'
import { Failure } from '../errors.ts'
import { refreshSource, refreshUser } from '../feeds.ts'
import { exportOpml, parseOpml } from '../opml.ts'
import { availableProviders, followedSearch, searchAndStore } from '../search.ts'
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

function slugify(db: DB, userId: number, name: string): string {
  const base = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'topic'
  const taken = db.prepare('SELECT 1 FROM topics WHERE user_id = ? AND slug = ?')
  let slug = base
  for (let n = 2; taken.get(userId, slug); n++) slug = `${base}-${n}`
  return slug
}

function addTopic(db: DB, userId: number, name: string): number {
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM topics WHERE user_id = ?').pluck().get(userId) as number
  return Number(
    db
      .prepare('INSERT INTO topics (user_id, name, slug, position) VALUES (?, ?, ?, ?)')
      .run(userId, name, slugify(db, userId, name), position).lastInsertRowid,
  )
}

function removeSource(db: DB, id: number): void {
  deleteArticles(db, 'source_id = ?', id)
  db.prepare('DELETE FROM sources WHERE id = ?').run(id)
}

export function libraryRoutes(app: FastifyInstance, db: DB): void {
  const ownsTopic = (userId: number, id: number) => Boolean(db.prepare('SELECT 1 FROM topics WHERE id = ? AND user_id = ?').get(id, userId))
  const ownsSource = (userId: number, id: number) =>
    Boolean(db.prepare(`SELECT 1 FROM sources WHERE id = ? AND user_id = ? AND kind = 'feed'`).get(id, userId))

  app.get('/api/topics', (req) =>
    db
      .prepare(
        `SELECT t.id, t.name, t.slug, (SELECT COUNT(*) FROM sources s WHERE s.topic_id = t.id) AS sources
         FROM topics t WHERE t.user_id = ? ORDER BY t.position, t.id`,
      )
      .all(req.userId),
  )

  app.post<{ Body: { name?: string } }>('/api/topics', (req) => {
    const name = req.body?.name?.trim()
    if (!name) throw new Failure(400, 'name_required', 'Name is required')
    return { id: addTopic(db, req.userId, name) }
  })

  app.delete<{ Params: { id: string } }>('/api/topics/:id', (req) => {
    const id = Number(req.params.id)
    if (!ownsTopic(req.userId, id)) throw new Failure(404, 'not_found', 'Topic not found')
    db.transaction(() => {
      const sources = db.prepare('SELECT id FROM sources WHERE topic_id = ?').pluck().all(id) as number[]
      sources.forEach((source) => removeSource(db, source))
      db.prepare('DELETE FROM topics WHERE id = ?').run(id)
    })()
    return { ok: true }
  })

  app.get('/api/sources', (req) =>
    (
      db.prepare(`${SOURCE_SELECT} WHERE s.user_id = ? AND s.kind = 'feed' ORDER BY s.title COLLATE NOCASE`).all(req.userId) as SourceRecord[]
    ).map(present),
  )

  app.post<{ Body: { url?: string; search?: { provider?: string; query?: string }; topicId?: number } }>(
    '/api/sources',
    async (req) => {
      const { url, search, topicId } = req.body ?? {}
      if (!topicId || !ownsTopic(req.userId, topicId)) throw new Failure(400, 'topic_required', 'Choose a topic')

      let found: { title: string; siteUrl: string; feedUrl: string; icon?: string | null }
      if (search?.provider && search.query?.trim()) {
        found = followedSearch(search.provider, search.query.trim())
      } else {
        if (!url?.trim()) throw new Failure(400, 'address_required', 'Enter a site or feed address')
        const discovered = await discover(url)
        if (!discovered) throw new Failure(422, 'feed_not_found', 'No feed found at that address')
        found = discovered
      }

      if (db.prepare('SELECT 1 FROM sources WHERE user_id = ? AND feed_url = ?').get(req.userId, found.feedUrl)) {
        throw new Failure(409, 'source_exists', 'That source is already in your list')
      }
      const id = Number(
        db
          .prepare('INSERT INTO sources (user_id, topic_id, title, site_url, feed_url, icon_url) VALUES (?, ?, ?, ?, ?, ?)')
          .run(req.userId, topicId, found.title, found.siteUrl, found.feedUrl, found.icon ?? null).lastInsertRowid,
      )
      await refreshSource(db, req.userId, id)
      return present(db.prepare(`${SOURCE_SELECT} WHERE s.id = ?`).get(id) as SourceRecord)
    },
  )

  app.patch<{ Params: { id: string }; Body: { followed?: boolean } }>('/api/sources/:id', (req) => {
    const id = Number(req.params.id)
    if (!ownsSource(req.userId, id)) throw new Failure(404, 'not_found', 'Source not found')
    const { followed } = req.body ?? {}
    if (followed !== undefined) db.prepare('UPDATE sources SET followed = ? WHERE id = ?').run(followed ? 1 : 0, id)
    if (followed) void refreshSource(db, req.userId, id).catch((error) => app.log.error(error))
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/sources/:id', (req) => {
    const id = Number(req.params.id)
    if (!ownsSource(req.userId, id)) throw new Failure(404, 'not_found', 'Source not found')
    db.transaction(() => removeSource(db, id))()
    return { ok: true }
  })

  app.get('/api/search/providers', () => availableProviders())

  app.get<{ Querystring: { q?: string; provider?: string } }>('/api/search', async (req) => {
    const query = req.query.q?.trim()
    if (!query || !req.query.provider) return { items: [] }
    return { items: await searchAndStore(db, req.userId, req.query.provider, query) }
  })

  app.get('/api/trackers', (req) =>
    db
      .prepare(
        `SELECT t.id, t.phrase,
                (SELECT COUNT(*) FROM tracker_hits h WHERE h.tracker_id = t.id) AS hits,
                (SELECT COUNT(*) FROM tracker_hits h WHERE h.tracker_id = t.id AND h.seen_at IS NULL) AS unseen
         FROM trackers t WHERE t.user_id = ? ORDER BY t.created_at DESC`,
      )
      .all(req.userId),
  )

  app.post<{ Body: { phrase?: string } }>('/api/trackers', (req) => {
    const phrase = req.body?.phrase?.trim().replace(/\s+/g, ' ')
    if (!phrase) throw new Failure(400, 'keyword_required', 'Keyword is required')
    if (db.prepare('SELECT 1 FROM trackers WHERE user_id = ? AND phrase = ?').get(req.userId, phrase)) {
      throw new Failure(409, 'tracker_exists', 'You already track that keyword')
    }
    const id = Number(
      db.prepare('INSERT INTO trackers (user_id, phrase, created_at) VALUES (?, ?, ?)').run(req.userId, phrase, Date.now()).lastInsertRowid,
    )
    return { id, hits: matchNewTracker(db, id) }
  })

  app.delete<{ Params: { id: string } }>('/api/trackers/:id', (req) => {
    const id = Number(req.params.id)
    if (!db.prepare('SELECT 1 FROM trackers WHERE id = ? AND user_id = ?').get(id, req.userId)) {
      throw new Failure(404, 'not_found', 'Keyword not found')
    }
    db.transaction(() => {
      db.prepare('DELETE FROM tracker_hits WHERE tracker_id = ?').run(id)
      db.prepare('DELETE FROM trackers WHERE id = ?').run(id)
    })()
    return { ok: true }
  })

  app.get('/api/opml', (req, reply) =>
    reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pulse-sources.opml"')
      .send(exportOpml(db, req.userId)),
  )

  app.post<{ Body: { xml?: string } }>('/api/opml', (req) => {
    const sources = parseOpml(req.body?.xml ?? '')
    if (sources.length === 0) throw new Failure(422, 'opml_empty', 'No feeds found in that file')
    const topicByName = db.prepare('SELECT id FROM topics WHERE user_id = ? AND name = ? COLLATE NOCASE').pluck()
    const insert = db.prepare('INSERT OR IGNORE INTO sources (user_id, topic_id, title, site_url, feed_url) VALUES (?, ?, ?, ?, ?)')
    let added = 0
    db.transaction(() => {
      for (const source of sources) {
        const topicId = (topicByName.get(req.userId, source.topic) as number | undefined) ?? addTopic(db, req.userId, source.topic)
        added += insert.run(req.userId, topicId, source.title, source.siteUrl, source.feedUrl).changes
      }
    })()
    void refreshUser(db, req.userId).catch((error) => app.log.error(error))
    return { added }
  })
}
