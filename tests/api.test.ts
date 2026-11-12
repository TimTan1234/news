import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.ts'
import { openDb, type DB } from '../server/db.ts'
import { streak } from '../server/routes/insights.ts'
import { ftsQuery } from '../server/routes/articles.ts'

let db: DB
let app: ReturnType<typeof buildApp>
const now = Date.now()

const get = async (url: string) => (await app.inject({ method: 'GET', url })).json()
const post = async (url: string, payload: object = {}) => (await app.inject({ method: 'POST', url, payload })).json()

beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO topics (id, name, slug, position) VALUES (1, 'AI', 'ai', 0), (2, 'Games', 'games', 1);
    INSERT INTO sources (id, topic_id, title, site_url, feed_url, followed) VALUES
      (1, 1, 'Alpha', 'https://alpha.example', 'https://alpha.example/feed', 1),
      (2, 2, 'Beta', 'https://beta.example', 'https://beta.example/feed', 1),
      (3, 2, 'Gamma', 'https://gamma.example', 'https://gamma.example/feed', 0);
  `)
  const insert = db.prepare(
    'INSERT INTO articles (id, source_id, url, title, excerpt, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (let id = 1; id <= 12; id++) {
    const source = id === 12 ? 3 : (id % 2) + 1
    // Articles 5 and 6 share a timestamp so pagination has to break the tie by id.
    const published = now - (id === 6 ? 5 : id) * 60_000
    insert.run(id, source, `https://x.example/${id}`, id === 3 ? 'Transformer breakthrough' : `Story ${id}`, 'body', published, now)
  }
  app = buildApp(db, { clientDir: '/nonexistent' })
})

describe('feed', () => {
  it('pages through followed sources without gaps or repeats', async () => {
    const seen: number[] = []
    let cursor: string | null = null
    do {
      const page: { items: { id: number }[]; nextCursor: string | null } = await get(
        `/api/feed?limit=4${cursor ? `&cursor=${cursor}` : ''}`,
      )
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(seen).toEqual([1, 2, 3, 4, 6, 5, 7, 8, 9, 10, 11])
  })

  it('filters by topic and searches titles by prefix', async () => {
    const games = await get('/api/feed?topic=games&limit=50')
    expect(games.items.every((item: { topic: { slug: string } }) => item.topic.slug === 'games')).toBe(true)
    expect(games.items).toHaveLength(6)
    const search = await get('/api/feed?q=transf')
    expect(search.items.map((item: { id: number }) => item.id)).toEqual([3])
    expect((await get('/api/feed?q=%22%20')).items).toEqual([])
  })

  it('hides hidden articles and lists saved ones', async () => {
    await post('/api/articles/1/hide')
    await post('/api/articles/2/save')
    await post('/api/articles/4/save')
    await post('/api/articles/4/save', { on: false })
    expect((await get('/api/feed')).items[0].id).toBe(2)
    expect((await get('/api/feed?filter=saved')).items.map((item: { id: number }) => item.id)).toEqual([2])
  })

  it('reports how far the reader has already seen', async () => {
    expect((await get('/api/feed')).seenMark).toBeNull()
    await post('/api/articles/seen', { ids: [3, 4] })
    const feed = await get('/api/feed')
    expect(feed.seenMark).toBe(feed.items.find((item: { id: number }) => item.id === 3).publishedAt)
    expect(feed.items.find((item: { id: number }) => item.id === 4).seen).toBe(true)
  })
})

describe('stories', () => {
  it('groups recent articles by source, oldest first, unseen sources ahead', async () => {
    await post('/api/articles/seen', { ids: [2, 4, 6, 8, 10] })
    const stories = await get('/api/stories')
    expect(stories.map((story: { source: { title: string } }) => story.source.title)).toEqual(['Beta', 'Alpha'])
    expect(stories[0].unseen).toBe(6)
    expect(stories[0].items.map((item: { id: number }) => item.id)).toEqual([11, 9, 7, 5, 3, 1])
    expect(stories[1].unseen).toBe(0)
  })
})

describe('reading', () => {
  it('counts an article once per reading day', async () => {
    await post('/api/articles/1/read', { day: '2026-11-12' })
    await post('/api/articles/1/read', { day: '2026-11-12' })
    await post('/api/articles/2/read', { day: '2026-11-12' })
    const stats = await get('/api/stats?day=2026-11-12')
    expect(stats.today).toBe(2)
    expect(stats.week.at(-1)).toEqual({ day: '2026-11-12', count: 2 })
    expect(stats.streak).toBe(1)
    expect(stats.topics).toEqual([
      { name: 'AI', slug: 'ai', count: 1 },
      { name: 'Games', slug: 'games', count: 1 },
    ])
  })

  it('keeps a streak alive until a full day is missed', () => {
    const days = new Set(['2026-11-09', '2026-11-10', '2026-11-11'])
    expect(streak(days, '2026-11-11')).toBe(3)
    expect(streak(days, '2026-11-12')).toBe(3)
    expect(streak(days, '2026-11-13')).toBe(0)
    expect(streak(new Set(['2026-02-28', '2026-03-01']), '2026-03-01')).toBe(2)
  })
})

describe('trackers', () => {
  it('surfaces matches in activity and clears the unseen count', async () => {
    const created = await post('/api/trackers', { phrase: 'transformer' })
    expect(created.hits).toBe(1)
    expect((await get('/api/activity/count')).unseen).toBe(1)
    const activity = await get('/api/activity')
    expect(activity[0]).toMatchObject({ tracker: { phrase: 'transformer' }, seen: false, article: { id: 3 } })
    await post('/api/activity/seen')
    expect((await get('/api/activity/count')).unseen).toBe(0)
    expect((await app.inject({ method: 'POST', url: '/api/trackers', payload: { phrase: 'Transformer' } })).statusCode).toBe(409)
  })
})

describe('library', () => {
  it('removes a topic together with its sources and their articles', async () => {
    await post('/api/trackers', { phrase: 'story' })
    const response = await app.inject({ method: 'DELETE', url: '/api/topics/2' })
    expect(response.statusCode).toBe(200)
    expect((await get('/api/topics')).map((topic: { slug: string }) => topic.slug)).toEqual(['ai'])
    expect(db.prepare('SELECT COUNT(*) FROM articles').pluck().get()).toBe(5)
  })

  it('gives new topics a unique slug', async () => {
    await post('/api/topics', { name: 'AI' })
    expect((await get('/api/topics')).map((topic: { slug: string }) => topic.slug)).toEqual(['ai', 'games', 'ai-2'])
  })
})

describe('ftsQuery', () => {
  it('quotes terms so punctuation cannot break the query', () => {
    expect(ftsQuery('gpt-5 "launch')).toBe('"gpt" "5" "launch"*')
    expect(ftsQuery('  ')).toBeNull()
  })
})
