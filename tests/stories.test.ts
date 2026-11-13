import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeBriefing } from '../server/ai.ts'
import { openDb, type DB } from '../server/db.ts'
import { alsoReporting, groupStories } from '../server/stories.ts'

const asked = vi.hoisted(() => ({ user: '' }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (request: { messages: { content: string }[] }) => {
        asked.user = request.messages[0].content
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ overview: 'A quiet day.', sections: [] }) }] }
      },
    }
  },
}))

const NOW = Date.parse('2026-11-12T08:00:00Z')
const HOUR = 60 * 60 * 1000

let db: DB

function add(id: number, source: number, title: string, hoursAgo: number, excerpt = ''): number {
  db.prepare('INSERT INTO articles (id, user_id, source_id, url, title, excerpt, published_at, fetched_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)').run(
    id, source, `https://x.example/${id}`, title, excerpt, NOW - hoursAgo * HOUR, NOW,
  )
  return id
}

const storyOf = (id: number) => db.prepare('SELECT story_id FROM story_articles WHERE article_id = ?').pluck().get(id) as number | undefined

/** A Workers AI that finds every pair of texts alike and answers each question as `reply` decides. */
function workersAi(reply: (question: string) => string) {
  const fetched = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input?: string[]; messages?: { content: string }[] }
    if (String(url).endsWith('/embeddings')) return Response.json({ data: body.input!.map((_, index) => ({ index, embedding: [3, 4] })) })
    return Response.json({ choices: [{ message: { content: reply(body.messages![1].content) } }] })
  })
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account')
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token')
  vi.stubGlobal('fetch', fetched)
  return fetched
}

const questions = (fetched: ReturnType<typeof workersAi>) =>
  fetched.mock.calls.flatMap(([url, init]) =>
    String(url).endsWith('/chat/completions') ? [(JSON.parse(String(init!.body)) as { messages: { content: string }[] }).messages[1].content] : [],
  )

beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`
    INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', 'x', 0);
    INSERT INTO topics (id, user_id, name, slug, position) VALUES (1, 1, 'AI', 'ai', 0), (2, 1, 'Games', 'games', 1);
    INSERT INTO sources (id, user_id, topic_id, title, site_url, feed_url, followed) VALUES
      (1, 1, 2, 'Alpha', 'https://alpha.example', 'https://alpha.example/feed', 1),
      (2, 1, 2, 'Beta', 'https://beta.example', 'https://beta.example/feed', 1),
      (3, 1, 1, 'Gamma', 'https://gamma.example', 'https://gamma.example/feed', 1);
  `)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('grouping by title', () => {
  it('files a report under the story another source already carries', async () => {
    const first = add(1, 1, 'Nintendo confirms Switch 2 price ahead of June launch', 5)
    await groupStories(db, [first], NOW)
    const second = add(2, 2, 'Nintendo confirms Switch 2 price ahead of its June launch', 2)
    const other = add(3, 3, 'Valve unveils Steam Deck 2, shipping in March', 1)
    await groupStories(db, [second, other], NOW)
    expect([storyOf(first), storyOf(second), storyOf(other)]).toEqual([1, 1, 3])
  })

  it('joins reports that arrive together, and one stored before stories were kept', async () => {
    const stored = add(1, 3, 'Nintendo confirms Switch 2 price ahead of June launch', 9)
    const arrivals = [add(2, 1, 'Nintendo confirms Switch 2 price ahead of June launch', 4), add(3, 2, 'Nintendo confirms Switch 2 price ahead of June launch', 3)]
    await groupStories(db, arrivals, NOW)
    expect([storyOf(stored), storyOf(2), storyOf(3)]).toEqual([1, 1, 1])
  })

  it('keeps apart short titles that share only a name', async () => {
    const ids = [add(1, 1, 'The Best Switch 2 Games', 3), add(2, 2, 'Switch 2 Black Friday Deals', 2)]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 2])
  })

  it('keeps apart titles that differ in a number, reports from one source, and reports days apart', async () => {
    const ids = [
      add(1, 1, 'Wordle hints and answer for November 12', 30),
      add(2, 2, 'Wordle hints and answer for November 13', 6),
      add(3, 2, 'Wordle hints and answer for November 13', 5),
      add(4, 3, 'Nintendo confirms Switch 2 price ahead of June launch', 4 * 24),
      add(5, 1, 'Nintendo confirms Switch 2 price ahead of June launch', 1),
    ]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 2, 3, undefined, 5])
  })
})

describe('grouping with Workers AI', () => {
  it('joins reports in different languages once the model says they are the same occurrence', async () => {
    const fetched = workersAi(() => 'SAME')
    const ids = [add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 3, 'Free accounts follow next week.'), add(2, 3, 'OpenAI 向所有 ChatGPT 用户推出 GPT-6', 2)]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 1])
    expect(questions(fetched)).toEqual([
      'Earlier headline:\n<headline>OpenAI releases GPT-6 to all ChatGPT users — Free accounts follow next week.</headline>\n\nNew headline:\n<headline>OpenAI 向所有 ChatGPT 用户推出 GPT-6</headline>',
    ])
    const vector = db.prepare('SELECT vector FROM story_articles WHERE article_id = 1').pluck().get() as Buffer
    expect([...new Float32Array(new Uint8Array(vector).buffer)].map((value) => Number(value.toFixed(2)))).toEqual([0.6, 0.8])
  })

  it('leaves a follow-up or a comment piece as a story of its own', async () => {
    workersAi((question) => (question.includes('What it means') ? 'COMMENT' : 'FOLLOWUP'))
    const ids = [
      add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 3),
      add(2, 3, 'What it means that GPT-6 is free', 2),
      add(3, 2, 'OpenAI pauses GPT-6 sign-ups after demand surge', 1),
    ]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 2, 3])
  })

  it('compares a new report with the first report of each story, not with its later members', async () => {
    const fetched = workersAi((question) => (question.includes('Tokyo') ? 'DIFFERENT' : 'SAME'))
    await groupStories(db, [add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 5), add(2, 2, 'GPT-6 arrives for everyone on ChatGPT', 4)], NOW)
    await groupStories(db, [add(3, 3, 'OpenAI opens a second office in Tokyo', 1)], NOW)
    expect([1, 2, 3].map(storyOf)).toEqual([1, 1, 3])
    expect(questions(fetched).map((question) => question.includes('GPT-6 arrives'))).toEqual([true, false])
  })

  it('moves the reports already joined by title along with the one the model places', async () => {
    workersAi(() => 'SAME')
    const ids = [
      add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 5),
      add(2, 2, 'GPT-6 arrives for everyone on ChatGPT, OpenAI says', 4),
      add(3, 3, 'GPT-6 arrives for everyone on ChatGPT, OpenAI says', 3),
    ]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 1, 1])
  })

  it('asks about a pair once for accounts that follow the same sources', async () => {
    const fetched = workersAi(() => 'SAME')
    db.exec(`
      INSERT INTO users (id, username, password, created_at) VALUES (2, 'ben', 'x', 0);
      INSERT INTO sources (id, user_id, title, site_url, feed_url, followed) VALUES
        (4, 2, 'Alpha', 'https://alpha.example', 'https://alpha.example/feed', 1),
        (5, 2, 'Beta', 'https://beta.example', 'https://beta.example/feed', 1);
    `)
    const ids = [add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 3), add(2, 2, 'GPT-6 arrives for everyone on ChatGPT', 2)]
    db.exec(`INSERT INTO articles (id, user_id, source_id, url, title, published_at, fetched_at)
      SELECT id + 10, 2, source_id + 3, url, title, published_at, fetched_at FROM articles`)
    await groupStories(db, [...ids, 11, 12], NOW)
    expect([1, 2, 11, 12].map(storyOf)).toEqual([1, 1, 11, 11])
    expect(questions(fetched)).toHaveLength(1)
  })

  it('falls back to titles when Workers AI cannot be reached', async () => {
    workersAi(() => 'SAME').mockRejectedValue(new Error('offline'))
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ids = [
      add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 3),
      add(2, 3, 'OpenAI 向所有 ChatGPT 用户推出 GPT-6', 2),
      add(3, 2, 'OpenAI releases GPT-6 to all ChatGPT users', 1),
    ]
    await groupStories(db, ids, NOW)
    expect(ids.map(storyOf)).toEqual([1, 2, 1])
    expect(warned).toHaveBeenCalledOnce()
  })

  it('drops an embedding once its article is too old to gain a report', async () => {
    workersAi(() => 'DIFFERENT')
    await groupStories(db, [add(1, 1, 'OpenAI releases GPT-6 to all ChatGPT users', 1)], NOW)
    expect(db.prepare('SELECT vector IS NOT NULL FROM story_articles').pluck().get()).toBe(1)
    await groupStories(db, [], NOW + 7 * 24 * HOUR)
    expect(db.prepare('SELECT story_id, vector FROM story_articles').all()).toEqual([{ story_id: 1, vector: null }])
  })
})

describe('reading stories', () => {
  beforeEach(async () => {
    const ids = [
      add(1, 1, 'Nintendo confirms Switch 2 price ahead of June launch', 30, 'It costs $449.'),
      add(2, 2, 'Nintendo confirms Switch 2 price ahead of its June launch', 6),
      add(3, 3, 'Nintendo confirms Switch 2 price ahead of June launch', 5),
      add(4, 2, 'Valve unveils Steam Deck 2, shipping in March', 4),
    ]
    await groupStories(db, ids, NOW + 24 * HOUR)
  })

  it('lists the other sources reporting a story, one report apiece', () => {
    add(5, 3, 'Nintendo confirms Switch 2 price ahead of June launch date', 2)
    db.prepare('INSERT INTO story_articles (article_id, story_id) VALUES (5, 1)').run()
    const also = alsoReporting(db, [1, 4])
    expect(also.get(1)!.map((article) => [article.id, article.source.title])).toEqual([[2, 'Beta'], [3, 'Gamma']])
    expect(also.has(4)).toBe(false)
  })

  it('gives the briefing each story once, under its first report of the day, naming who else reports it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'key')
    await writeBriefing(db, 1, '2026-11-12', 'en', NOW)
    expect(asked.user.split('\n').slice(1, -2)).toEqual([
      '[4] Games | Beta | Valve unveils Steam Deck 2, shipping in March | ',
      '[2] Games | Beta | Nintendo confirms Switch 2 price ahead of its June launch |  | also reported by Alpha, Gamma',
    ])
  })
})
