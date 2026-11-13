import type { FastifyInstance } from 'fastify'
import type { DB } from '../db.ts'
import { discover } from '../discover.ts'
import { Failure } from '../errors.ts'
import {
  confirmInterest,
  listInterests,
  listSuggestions,
  roundDue,
  roundRunning,
  roundStatus,
  setAvoided,
  startRound,
  suggestionOf,
} from '../recommend.ts'
import { followedSearch } from '../search.ts'
import { asLang } from './articles.ts'
import { addSource, addTopic, ownsTopic, type FoundSource } from './library.ts'

export function suggestionRoutes(app: FastifyInstance, db: DB): void {
  const start = (userId: number, lang: unknown) => startRound(db, userId, asLang(lang), (error) => app.log.error(error))

  const suggestion = (userId: number, id: string) => {
    const found = suggestionOf(db, userId, Number(id))
    if (!found) throw new Failure(404, 'not_found', 'Suggestion not found')
    return found
  }

  const has = (userId: number, feedUrl: string) =>
    Boolean(db.prepare('SELECT 1 FROM sources WHERE user_id = ? AND feed_url = ?').get(userId, feedUrl))

  /** What following a suggestion could add: the site's own feed for a news story, and a search for its subject. */
  async function followable(userId: number, found: NonNullable<ReturnType<typeof suggestionOf>>) {
    const search = followedSearch(found.provider, (JSON.parse(found.queries) as string[])[0])
    const site = found.provider === 'news' ? await discover(new URL(found.url).origin) : null
    return {
      site: site && !has(userId, site.feedUrl) ? (site as FoundSource) : null,
      search: has(userId, search.feedUrl) ? null : (search as FoundSource),
    }
  }

  app.get<{ Querystring: { lang?: string } }>('/api/suggestions', (req) => {
    if (roundDue(db, req.userId)) start(req.userId, req.query.lang)
    return { running: roundRunning(req.userId), ...roundStatus(db, req.userId), items: listSuggestions(db, req.userId) }
  })

  app.post<{ Body: { lang?: string } }>('/api/suggestions/round', (req) => {
    start(req.userId, req.body?.lang)
    return { running: true }
  })

  app.get<{ Params: { id: string } }>('/api/suggestions/:id/follow', async (req) => {
    const found = suggestion(req.userId, req.params.id)
    const { site, search } = await followable(req.userId, found)
    const topics = db.prepare('SELECT id, name FROM topics WHERE user_id = ? ORDER BY position, id').all(req.userId) as { id: number; name: string }[]
    const fits = topics.find((topic) => topic.name.toLowerCase() === found.topic?.toLowerCase())
    return {
      subject: found.label,
      site: site && { title: site.title },
      search: search && { title: search.title },
      topicId: fits?.id ?? null,
      newTopic: fits ? null : found.topic,
    }
  })

  app.post<{ Params: { id: string }; Body: { what?: string; topicId?: number; newTopic?: string } }>('/api/suggestions/:id/follow', async (req) => {
    const found = suggestion(req.userId, req.params.id)
    const { what, topicId, newTopic } = req.body ?? {}
    const options = await followable(req.userId, found)
    const source = what === 'site' ? options.site : options.search
    if (!source) throw new Failure(409, 'source_exists', 'That source is already in your list')

    const name = newTopic?.trim()
    let topic: number
    if (name) {
      const existing = db.prepare('SELECT id FROM topics WHERE user_id = ? AND name = ? COLLATE NOCASE').pluck().get(req.userId, name) as number | undefined
      topic = existing ?? addTopic(db, req.userId, name)
    } else if (topicId && ownsTopic(db, req.userId, topicId)) {
      topic = topicId
    } else {
      throw new Failure(400, 'topic_required', 'Choose a topic')
    }
    const added = await addSource(db, req.userId, topic, source)
    confirmInterest(db, req.userId, Number(req.params.id))
    return added
  })

  app.get('/api/interests', (req) => listInterests(db, req.userId))

  app.patch<{ Params: { id: string }; Body: { avoided?: boolean } }>('/api/interests/:id', (req) => {
    if (!setAvoided(db, req.userId, Number(req.params.id), req.body?.avoided === true)) throw new Failure(404, 'not_found', 'Subject not found')
    return { ok: true }
  })
}
