import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiError, explain, hasClaude, proposeInterests } from '../server/ai.ts'
import { openDb, type DB } from '../server/db.ts'
import { hasDecisions, scoreRelevance } from '../server/decisions.ts'
import { advance, interestWeight, recordOutcome, roundInterests, runRound, select, setAvoided, shortlist, type Interest } from '../server/recommend.ts'
import { discoveryProviders, searchInto } from '../server/search.ts'

vi.mock('../server/search.ts', async (original) => ({
  ...(await original<typeof import('../server/search.ts')>()),
  searchInto: vi.fn(async () => []),
  discoveryProviders: vi.fn(() => [{ id: 'news', name: 'News', perRound: undefined }]),
}))
vi.mock('../server/ai.ts', async (original) => ({
  ...(await original<typeof import('../server/ai.ts')>()),
  hasClaude: vi.fn(() => false),
  proposeInterests: vi.fn(async () => []),
  explain: vi.fn(async () => new Map()),
}))
vi.mock('../server/feeds.ts', async (original) => ({
  ...(await original<typeof import('../server/feeds.ts')>()),
  fillMissingImages: vi.fn(async () => {}),
}))
vi.mock('../server/decisions.ts', () => ({ hasDecisions: vi.fn(() => false), scoreRelevance: vi.fn(async () => new Map()) }))

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 12)

const interest = (over: Partial<Interest> = {}): Interest => ({
  id: 1,
  user_id: 1,
  label: 'Kirby',
  queries: '["kirby"]',
  topic: null,
  kind: 'near',
  origin: 'ai',
  state: 'trial',
  shown: 0,
  accepted: 0,
  dismissed: 0,
  defers: 0,
  resume_at: null,
  last_signal_at: null,
  created_at: NOW,
  ...over,
})

describe('interest lifecycle', () => {
  it('promotes a trial once two of its stories were taken up', () => {
    expect(advance(interest({ accepted: 1, shown: 4 }), NOW)).toBeNull()
    expect(advance(interest({ accepted: 2, shown: 4 }), NOW)).toEqual({ state: 'active' })
  })

  it('rests a trial that is passed over for 7 days, then 14, then 30', () => {
    expect(advance(interest({ dismissed: 2 }), NOW)).toEqual({ state: 'deferred', defers: 1, resume_at: NOW + 7 * DAY })
    expect(advance(interest({ shown: 6, defers: 1 }), NOW)).toEqual({ state: 'deferred', defers: 2, resume_at: NOW + 14 * DAY })
    expect(advance(interest({ shown: 6, defers: 2 }), NOW)).toEqual({ state: 'rejected', defers: 3, resume_at: NOW + 30 * DAY })
    expect(advance(interest({ shown: 5, dismissed: 1 }), NOW)).toBeNull()
  })

  it('gives a rested interest a fresh trial when its time is up', () => {
    const resting = interest({ state: 'deferred', defers: 1, shown: 6, resume_at: NOW + DAY })
    expect(advance(resting, NOW)).toBeNull()
    expect(advance(resting, NOW + 2 * DAY)).toEqual({ state: 'trial', shown: 0, dismissed: 0, resume_at: null, defers: 1 })
    expect(advance(interest({ state: 'rejected', defers: 3, resume_at: NOW }), NOW)?.defers).toBe(0)
  })

  it('archives an active interest after 60 quiet days and weighs it down after 30', () => {
    const active = interest({ state: 'active', accepted: 3, shown: 6, last_signal_at: NOW })
    expect(advance(active, NOW + 59 * DAY)).toBeNull()
    expect(advance(active, NOW + 61 * DAY)).toEqual({ state: 'archived' })
    expect(interestWeight(active, NOW + 31 * DAY)).toBe(interestWeight(active, NOW) / 2)
  })

  it('leaves tracked keywords and avoided subjects where they are', () => {
    expect(advance(interest({ origin: 'tracker', state: 'active', created_at: 0 }), NOW)).toBeNull()
    expect(advance(interest({ state: 'avoided', accepted: 5 }), NOW)).toBeNull()
  })

  it('searches for active interests first, then exploratory trials, then the rest', () => {
    const all = [
      interest({ id: 1, state: 'trial' }),
      interest({ id: 2, state: 'trial', kind: 'wildcard' }),
      interest({ id: 3, state: 'active', accepted: 4, shown: 5 }),
      interest({ id: 4, state: 'deferred' }),
    ]
    expect(roundInterests(all, NOW).map((entry) => entry.id)).toEqual([3, 2, 1])
  })
})

describe('selection', () => {
  const story = (id: number, title: string, score: number, over: { interest?: number; kind?: Interest['kind']; publisher?: string } = {}) => ({
    id,
    title,
    score,
    provider: 'news',
    publisher: over.publisher ?? `Outlet ${id}`,
    interest: { id: over.interest ?? id, kind: over.kind ?? ('near' as const) },
  })

  it('caps how many stories one interest and one publisher get', () => {
    const sameInterest = [1, 2, 3, 4, 5].map((id) => story(id, `Unrelated headline number ${id} about topic${id}`, 1 - id / 10, { interest: 7 }))
    expect(select(sameInterest).map((pick) => pick.id)).toEqual([1, 2, 3])
    const samePublisher = [1, 2, 3].map((id) => story(id, `Different subject${id} entirely here${id}`, 1 - id / 10, { publisher: 'IGN' }))
    expect(select(samePublisher).map((pick) => pick.id)).toEqual([1, 2])
  })

  it('judges every interest\'s best few rather than the busiest interest\'s many', () => {
    const busy = Array.from({ length: 100 }, (_, index) => ({ id: index, interest: { id: 1 } }))
    const quiet = [{ id: 200, interest: { id: 2 } }, { id: 201, interest: { id: 3 } }]
    const judged = shortlist([...busy, ...quiet], 60)
    expect(judged.filter((candidate) => candidate.interest.id === 1)).toHaveLength(20)
    expect(judged.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([200, 201]))
  })

  it('caps how many stories one platform gets', () => {
    const videos = Array.from({ length: 8 }, (_, index) => ({ ...story(index + 1, `Subject${index} headline${index} words${index}`, 0.9 - index / 100), provider: 'bilibili' }))
    const others = ['news', 'github', 'weibo'].map((provider, index) => ({ ...story(20 + index, `Other${index} thing${index} here${index}`, 0.1), provider }))
    const picks = select([...videos, ...others])
    expect(picks.filter((pick) => pick.provider === 'bilibili')).toHaveLength(5)
    expect(picks).toHaveLength(8)
    expect(select(videos)).toHaveLength(8)
  })

  it('drops a second telling of the same story', () => {
    const picks = select([
      story(1, 'Kirby Air Riders gets a surprise update', 0.9),
      story(2, 'Kirby Air Riders gets surprise update today', 0.8),
      story(3, 'Nvidia earnings beat forecasts again', 0.5),
    ])
    expect(picks.map((pick) => pick.id)).toEqual([1, 3])
  })

  it('holds places for interests outside known tastes', () => {
    const near = Array.from({ length: 20 }, (_, index) => story(index + 1, `Subject${index} headline${index} words${index}`, 0.9 - index / 100))
    const explore = [story(50, 'Bouldering gyms boom', 0.1, { kind: 'wildcard' }), story(51, 'Sourdough science explained', 0.05, { kind: 'lateral' })]
    const picks = select([...near, ...explore], 12)
    expect(picks).toHaveLength(12)
    expect(picks.filter((pick) => pick.interest.kind !== 'near').map((pick) => pick.id)).toEqual([50, 51])
  })
})

describe('rounds', () => {
  let db: DB
  let nextId = 100

  /** Stands in for a provider: stores the given headlines in the results bucket and reports their ids. */
  const found = (...stories: { title: string; age?: number; publisher?: string; read?: boolean }[]) =>
    vi.mocked(searchInto).mockImplementationOnce(async () =>
      stories.map((entry) => {
        const id = nextId++
        db.prepare(
          `INSERT INTO articles (id, user_id, source_id, url, title, excerpt, publisher, published_at, fetched_at, read_at)
           VALUES (?, 1, 9, ?, ?, '', ?, ?, ?, ?)`,
        ).run(id, `https://web.example/${id}`, entry.title, entry.publisher ?? `Outlet ${id}`, NOW - (entry.age ?? 0) * DAY, NOW, entry.read ? NOW : null)
        return id
      }),
    )

  const interests = () => db.prepare('SELECT * FROM interests ORDER BY id').all() as Interest[]
  const suggestions = () =>
    db.prepare('SELECT article_id, reason, outcome FROM suggestions ORDER BY article_id').all() as { article_id: number; reason: string | null; outcome: string | null }[]

  beforeEach(() => {
    vi.mocked(searchInto).mockReset().mockResolvedValue([])
    vi.mocked(hasClaude).mockReturnValue(false)
    vi.mocked(hasDecisions).mockReturnValue(false)
    nextId = 100
    db = openDb(':memory:')
    db.exec(`
      INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', 'x', 0);
      INSERT INTO topics (id, user_id, name, slug) VALUES (1, 1, 'Games', 'games');
      INSERT INTO sources (id, user_id, topic_id, title, site_url, feed_url) VALUES (1, 1, 1, 'Alpha', 'https://alpha.example', 'https://alpha.example/feed');
      INSERT INTO sources (id, user_id, kind, title, site_url, feed_url, followed) VALUES (9, 1, 'results', 'News', 'https://www.bing.com/news', 'search:news', 0);
      INSERT INTO trackers (id, user_id, phrase, created_at) VALUES (1, 1, 'Kirby', 0);
    `)
  })

  it('suggests fresh, unread stories for a tracked keyword without any model', async () => {
    found({ title: 'Kirby Air Riders review' }, { title: 'Old Kirby retrospective', age: 20 }, { title: 'Kirby sales record', read: true })
    const round = await runRound(db, 1, 'en', NOW)
    expect(round).toEqual({ picked: 1, problem: null })
    expect(suggestions()).toEqual([{ article_id: 100, reason: null, outcome: null }])
    expect(interests()).toMatchObject([{ label: 'Kirby', origin: 'tracker', state: 'active', shown: 1 }])
    expect(searchInto).toHaveBeenCalledWith(db, 1, 'news', 'Kirby', NOW)
  })

  it('never suggests the same story twice, nor one about an avoided subject', async () => {
    found({ title: 'Kirby Air Riders review' })
    await runRound(db, 1, 'en', NOW)
    vi.mocked(searchInto).mockResolvedValueOnce([100])
    expect((await runRound(db, 1, 'en', NOW + DAY)).picked).toBe(0)

    db.prepare(`INSERT INTO interests (user_id, label, queries, origin, state, created_at) VALUES (1, 'Amiibo', '["amiibo"]', 'ai', 'avoided', 0)`).run()
    found({ title: 'Kirby amiibo restock' }, { title: 'Kirby anniversary concert' })
    await runRound(db, 1, 'en', NOW + 2 * DAY)
    expect(suggestions().map((row) => row.article_id)).toEqual([100, 102])
  })

  it('spends no more searches on a metered platform than its budget for a round', async () => {
    db.prepare(`INSERT INTO trackers (user_id, phrase, created_at) VALUES (1, 'Zelda', 0), (1, 'Metroid', 0)`).run()
    vi.mocked(discoveryProviders).mockReturnValue([{ id: 'news', name: 'News', perRound: undefined }, { id: 'youtube', name: 'YouTube', perRound: 2 }])
    await runRound(db, 1, 'en', NOW)
    const searched = vi.mocked(searchInto).mock.calls.map((call) => call[2])
    expect(searched.filter((provider) => provider === 'news')).toHaveLength(3)
    expect(searched.filter((provider) => provider === 'youtube')).toHaveLength(2)
    vi.mocked(discoveryProviders).mockReturnValue([{ id: 'news', name: 'News', perRound: undefined }])
  })

  it('starts a new account from its topic names', async () => {
    db.exec('DELETE FROM trackers')
    await runRound(db, 1, 'en', NOW)
    expect(interests()).toMatchObject([{ label: 'Games', origin: 'history', state: 'trial', kind: 'near' }])
  })

  it('learns interests from the model, drops what it scores low, and stores its reasons', async () => {
    const liked = db.prepare('INSERT INTO articles (id, user_id, source_id, url, title, published_at, fetched_at, liked_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?)')
    ;['Kirby Air Riders hands-on', 'Metroid Prime 4 review', 'Zelda speedrun record'].forEach((title, index) =>
      liked.run(index + 1, `https://alpha.example/${index}`, title, NOW, NOW, NOW),
    )
    vi.mocked(hasClaude).mockReturnValue(true)
    vi.mocked(hasDecisions).mockReturnValue(true)
    vi.mocked(proposeInterests).mockResolvedValueOnce([
      { label: 'Metroid', queries: ['Metroid Prime 4'], kind: 'near', topic: 'Games' },
      { label: 'Bouldering', queries: ['bouldering'], kind: 'wildcard', topic: 'Sport' },
      { label: 'kirby', queries: ['kirby'], kind: 'near', topic: 'Games' },
    ])
    vi.mocked(searchInto).mockReset()
    found({ title: 'Kirby Air Riders review' })
    found({ title: 'Bouldering gyms boom' })
    found({ title: 'Metroid Prime 4 sells out' }, { title: 'Metroid fan art roundup' })
    vi.mocked(scoreRelevance).mockResolvedValueOnce(new Map([[100, 0.9], [101, 0.55], [102, 0.8], [103, 0.45]]))
    vi.mocked(explain).mockResolvedValueOnce(new Map([[100, 'You track Kirby.'], [102, 'You liked the Prime 4 review.']]))

    expect(await runRound(db, 1, 'en', NOW)).toEqual({ picked: 3, problem: null })
    expect(interests().map((entry) => [entry.label, entry.kind, entry.origin, entry.state])).toEqual([
      ['Kirby', 'near', 'tracker', 'active'],
      ['Metroid', 'near', 'ai', 'trial'],
      ['Bouldering', 'wildcard', 'ai', 'trial'],
    ])
    expect(vi.mocked(proposeInterests).mock.calls[0][0]).toMatchObject({ following: ['Kirby'], topics: ['Games'] })
    expect(suggestions()).toEqual([
      { article_id: 100, reason: 'You track Kirby.', outcome: null },
      { article_id: 101, reason: null, outcome: null },
      { article_id: 102, reason: 'You liked the Prime 4 review.', outcome: null },
    ])
  })

  it('falls back to rules and reports the problem when a model call fails', async () => {
    const liked = db.prepare('INSERT INTO articles (id, user_id, source_id, url, title, published_at, fetched_at, liked_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?)')
    ;['Metroid Prime 4 review', 'Metroid Prime 4 sales', 'Zelda speedrun record'].forEach((title, index) =>
      liked.run(index + 1, `https://alpha.example/${index}`, title, NOW, NOW, NOW),
    )
    vi.mocked(hasClaude).mockReturnValue(true)
    vi.mocked(proposeInterests).mockRejectedValueOnce(new AiError('ai_key_rejected', 'The Anthropic API key was rejected.'))
    vi.mocked(explain).mockRejectedValueOnce(new AiError('ai_key_rejected', 'The Anthropic API key was rejected.'))
    found({ title: 'Kirby Air Riders review' })

    expect(await runRound(db, 1, 'en', NOW)).toEqual({ picked: 1, problem: 'ai_key_rejected' })
    const learned = interests().filter((entry) => entry.origin === 'history').map((entry) => entry.label)
    expect(learned).toContain('Metroid Prime')
    expect(learned).not.toContain('review')
  })

  it('moves an interest on what the reader does with its stories', async () => {
    db.prepare(`INSERT INTO interests (id, user_id, label, queries, origin, state, created_at) VALUES (5, 1, 'Metroid', '["metroid"]', 'ai', 'trial', ?)`).run(NOW)
    const add = db.prepare(`INSERT INTO articles (id, user_id, source_id, url, title, published_at, fetched_at) VALUES (?, 1, 9, ?, 'Metroid', ?, ?)`)
    const suggest = db.prepare(`INSERT INTO suggestions (article_id, user_id, interest_id, provider, score, created_at) VALUES (?, 1, 5, 'news', 1, ?)`)
    for (const id of [200, 201, 202, 203]) {
      add.run(id, `https://web.example/${id}`, NOW, NOW)
      suggest.run(id, NOW)
    }
    recordOutcome(db, 1, 200, 'accepted', NOW)
    recordOutcome(db, 1, 200, 'accepted', NOW)
    expect(interests().find((entry) => entry.id === 5)).toMatchObject({ accepted: 1, state: 'trial' })
    recordOutcome(db, 1, 201, 'accepted', NOW)
    expect(interests().find((entry) => entry.id === 5)).toMatchObject({ accepted: 2, state: 'active' })
    recordOutcome(db, 1, 999, 'accepted', NOW)

    setAvoided(db, 1, 5, true)
    expect(interests().find((entry) => entry.id === 5)?.state).toBe('avoided')
    expect(suggestions().map((row) => row.article_id)).toEqual([200, 201])
  })
})
