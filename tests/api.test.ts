import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app.ts'
import { hashPassword } from '../server/auth.ts'
import { openDb, type DB } from '../server/db.ts'
import { streak } from '../server/routes/insights.ts'
import { ftsQuery, searchClause } from '../server/routes/articles.ts'

let db: DB
let app: ReturnType<typeof buildApp>
let ana: string
let ben: string
const now = Date.now()

async function signIn(username: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'correct horse' } })
  return String(response.headers['set-cookie']).split(';')[0]
}

const call = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, cookie: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { cookie } })
const get = async (url: string, cookie = ana) => (await call('GET', url, cookie)).json()
const post = async (url: string, payload: object = {}, cookie = ana) => (await call('POST', url, cookie, payload)).json()

beforeEach(async () => {
  db = openDb(':memory:')
  const password = hashPassword('correct horse')
  db.prepare(`INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', ?, 0), (2, 'ben', ?, 0)`).run(password, password)
  db.exec(`
    INSERT INTO topics (id, user_id, name, slug, position) VALUES (1, 1, 'AI', 'ai', 0), (2, 1, 'Games', 'games', 1), (3, 2, 'Games', 'games', 0);
    INSERT INTO sources (id, user_id, topic_id, title, site_url, feed_url, followed) VALUES
      (1, 1, 1, 'Alpha', 'https://alpha.example', 'https://alpha.example/feed', 1),
      (2, 1, 2, 'Beta', 'https://beta.example', 'https://beta.example/feed', 1),
      (3, 1, 2, 'Gamma', 'https://gamma.example', 'https://gamma.example/feed', 0),
      (4, 2, 3, 'Beta', 'https://beta.example', 'https://beta.example/feed', 1);
  `)
  const insert = db.prepare(
    'INSERT INTO articles (id, user_id, source_id, url, title, excerpt, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  for (let id = 1; id <= 12; id++) {
    const source = id === 12 ? 3 : (id % 2) + 1
    // Articles 5 and 6 share a timestamp so pagination has to break the tie by id.
    const published = now - (id === 6 ? 5 : id) * 60_000
    insert.run(id, 1, source, `https://x.example/${id}`, id === 3 ? 'Transformer breakthrough' : `Story ${id}`, 'body', published, now)
  }
  insert.run(20, 2, 4, 'https://x.example/1', 'Story 1', 'body', now - 60_000, now)
  insert.run(21, 2, 4, 'https://x.example/zh', '库洛公布鸣潮3.8版本前瞻', '新角色莉莉登场', now - 120_000, now)
  app = buildApp(db, { clientDir: '/nonexistent' })
  ana = await signIn('ana')
  ben = await signIn('ben')
})

describe('accounts', () => {
  it('turns away requests without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/feed' })
    expect(response.statusCode).toBe(401)
    expect(response.json().code).toBe('signed_out')
  })

  it('registers an account with the default sources and signs it in', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Cleo', password: 'long enough' } })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    expect(response.json().user.username).toBe('Cleo')
    expect((await get('/api/topics', cookie)).map((topic: { name: string }) => topic.name)).toEqual(['AI', 'Games', 'Tech'])
    expect(await get('/api/sources', cookie)).toHaveLength(27)
    expect((await get('/api/auth/me', cookie)).user.username).toBe('Cleo')
  })

  it('names the default topics in the language the account was created in', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: '小明同学', password: 'long enough', lang: 'zh' } })
    const cookie = String(response.headers['set-cookie']).split(';')[0]
    expect((await get('/api/topics', cookie)).map((topic: { name: string }) => topic.name)).toEqual(['AI', '游戏', '科技'])
  })

  it('refuses weak passwords, bad usernames and taken names', async () => {
    const register = async (username: string, password: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } })).json().code
    expect(await register('dee', 'short')).toBe('password_short')
    expect(await register('a b', 'long enough')).toBe('username_invalid')
    expect(await register('ANA', 'long enough')).toBe('username_taken')
  })

  it('rejects a wrong password and ends the session on sign-out', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password: 'nope' } })
    expect(wrong.statusCode).toBe(401)
    await call('POST', '/api/auth/logout', ana)
    expect((await call('GET', '/api/feed', ana)).statusCode).toBe(401)
    expect((await get('/api/auth/me', ana)).user).toBeNull()
  })

  it('keeps each account to its own stories', async () => {
    expect((await get('/api/feed', ben)).items.map((item: { id: number }) => item.id)).toEqual([20, 21])
    expect((await call('GET', '/api/articles/1', ben)).statusCode).toBe(404)
    await post('/api/articles/1/like', {}, ben)
    await post('/api/articles/seen', { ids: [1, 2] }, ben)
    const untouched = (await get('/api/feed')).items.find((item: { id: number }) => item.id === 1)
    expect(untouched).toMatchObject({ liked: false, seen: false })
  })

  it('keeps each account to its own sources, topics and keywords', async () => {
    expect((await get('/api/sources', ben)).map((source: { id: number }) => source.id)).toEqual([4])
    expect((await call('DELETE', '/api/sources/1', ben)).statusCode).toBe(404)
    expect((await call('DELETE', '/api/topics/1', ben)).statusCode).toBe(404)
    expect((await call('PATCH', '/api/sources/1', ben, { followed: false })).statusCode).toBe(404)
    const { id } = await post('/api/trackers', { phrase: 'story' })
    expect((await call('DELETE', `/api/trackers/${id}`, ben)).statusCode).toBe(404)
    expect(await get('/api/trackers', ben)).toEqual([])
    expect((await get('/api/activity/count', ben)).unseen).toBe(0)
  })
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

  it('searches stories from unfollowed sources too', async () => {
    expect((await get('/api/feed?q=story%2012')).items.map((item: { id: number }) => item.id)).toEqual([12])
  })

  it('finds Chinese text by substring', async () => {
    const found = await get(`/api/feed?q=${encodeURIComponent('鸣潮')}`, ben)
    expect(found.items.map((item: { id: number }) => item.id)).toEqual([21])
    expect((await get(`/api/feed?q=${encodeURIComponent('莉莉 鸣潮')}`, ben)).items).toHaveLength(1)
    expect((await get(`/api/feed?q=${encodeURIComponent('原神')}`, ben)).items).toEqual([])
    expect((await get(`/api/feed?q=${encodeURIComponent('100%')}`, ben)).items).toEqual([])
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
  it('counts an article once per reading day, per account', async () => {
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
    expect((await get('/api/stats?day=2026-11-12', ben)).today).toBe(0)
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
    expect((await call('POST', '/api/trackers', ana, { phrase: 'Transformer' })).statusCode).toBe(409)
    expect((await call('POST', '/api/trackers', ben, { phrase: 'Transformer' })).statusCode).toBe(200)
  })
})

describe('library', () => {
  it('removes a topic together with its sources and their articles', async () => {
    await post('/api/trackers', { phrase: 'story' })
    expect((await call('DELETE', '/api/topics/2', ana)).statusCode).toBe(200)
    expect((await get('/api/topics')).map((topic: { slug: string }) => topic.slug)).toEqual(['ai'])
    expect(db.prepare('SELECT COUNT(*) FROM articles WHERE user_id = 1').pluck().get()).toBe(5)
    expect(db.prepare('SELECT COUNT(*) FROM articles WHERE user_id = 2').pluck().get()).toBe(2)
  })

  it('gives new topics a slug that is unique within the account', async () => {
    await post('/api/topics', { name: 'AI' })
    await post('/api/topics', { name: 'AI' }, ben)
    expect((await get('/api/topics')).map((topic: { slug: string }) => topic.slug)).toEqual(['ai', 'games', 'ai-2'])
    expect((await get('/api/topics', ben)).map((topic: { slug: string }) => topic.slug)).toEqual(['games', 'ai'])
  })

  it('follows a search as a source and leaves the results bucket out of the source list and of feed search', async () => {
    db.prepare(`INSERT INTO sources (id, user_id, kind, title, site_url, feed_url, followed) VALUES (9, 1, 'results', 'News', 'https://www.bing.com/news', 'search:news', 0)`).run()
    db.prepare(
      `INSERT INTO articles (id, user_id, source_id, url, title, excerpt, published_at, fetched_at) VALUES (30, 1, 9, 'https://x.example/web', 'Kirby announced', '', ?, ?)`,
    ).run(now, now)
    expect(await get('/api/sources')).toHaveLength(3)
    expect((await get('/api/feed?q=kirby')).items).toEqual([])
    expect((await get('/api/articles/30')).article.source.managed).toBe(false)
    expect((await call('POST', '/api/sources', ana, { search: { provider: 'nope', query: 'kirby' }, topicId: 2 })).json().code).toBe('search_unavailable')
    expect((await call('POST', '/api/sources', ana, { url: 'https://new.example', topicId: 3 })).json().code).toBe('topic_required')
  })
})

describe('search queries', () => {
  it('quotes terms so punctuation cannot break the query', () => {
    expect(ftsQuery('gpt-5 "launch')).toBe('"gpt" "5" "launch"*')
    expect(ftsQuery('  ')).toBeNull()
  })

  it('uses substring matching for unspaced scripts and escapes wildcards', () => {
    expect(searchClause('鸣潮 50%')?.params).toEqual(['%鸣潮%', '%鸣潮%', '%50\\%%', '%50\\%%'])
    expect(searchClause('kirby')?.params).toEqual(['"kirby"*'])
  })
})
