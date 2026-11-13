import { explain, hasClaude, proposeInterests, type InterestKind, type Lang, type ProposedInterest } from './ai.ts'
import { ARTICLE_SELECT, toArticle, type ArticleRow, type DB } from './db.ts'
import { hasDecisions, scoreRelevance } from './decisions.ts'
import { outsideActivity, syncAccounts, type OutsideActivity } from './accounts.ts'
import { Failure } from './errors.ts'
import { fillMissingImages } from './feeds.ts'
import { pool } from './http.ts'
import { discoveryProviders, providerName, searchInto } from './search.ts'
import { phraseMatcher } from './trackers.ts'
import { phrases, trending } from './trending.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const ROUND_EVERY = 20 * HOUR
const SIGNAL_WINDOW = 30 * DAY
const FRESH_FOR = 14 * DAY
const RECENCY_HALF_LIFE = 3 * DAY

const NEAR_TRIALS = 5
const EXPLORE_TRIALS = 3
const ACTIVE_PER_ROUND = 5
const INTERESTS_PER_ROUND = 10

const JUDGED = 60
/** Halfway between "mentions the subject in passing" and "about the subject" on the judging scale. */
const ADMIT = 0.5
const PICKS = 12
const PER_INTEREST = 3
const PER_PUBLISHER = 2
const PER_PLATFORM = 5
const SAME_STORY = 0.6

const DEFER_DAYS = [7, 14]
const REJECT_DAYS = 30
const QUIET_DAYS = 30
const ARCHIVE_DAYS = 60

export type InterestState = 'trial' | 'active' | 'deferred' | 'rejected' | 'archived' | 'avoided'

export interface Interest {
  id: number
  user_id: number
  label: string
  queries: string
  topic: string | null
  kind: InterestKind
  origin: 'tracker' | 'history' | 'ai'
  state: InterestState
  shown: number
  accepted: number
  dismissed: number
  defers: number
  resume_at: number | null
  last_signal_at: number | null
  created_at: number
}

type Change = Partial<Omit<Interest, 'id' | 'user_id'>>

const isExplore = (interest: Pick<Interest, 'kind'>) => interest.kind !== 'near'
const queriesOf = (interest: Pick<Interest, 'queries'>) => JSON.parse(interest.queries) as string[]

/**
 * Where an interest goes next, given what the reader did with its suggestions. A trial becomes active
 * once two of its stories were taken up; one that keeps being passed over rests for 7 days, then 14,
 * then 30; an active one nobody has touched for 60 days is archived. A tracked keyword stays put.
 */
export function advance(interest: Interest, now: number): Change | null {
  const { state } = interest
  if (state === 'avoided' || state === 'archived' || interest.origin === 'tracker') return null
  if (state === 'deferred' || state === 'rejected') {
    if ((interest.resume_at ?? 0) > now) return null
    return { state: 'trial', shown: 0, dismissed: 0, resume_at: null, defers: state === 'rejected' ? 0 : interest.defers }
  }
  if (state === 'active') {
    return now - (interest.last_signal_at ?? interest.created_at) > ARCHIVE_DAYS * DAY ? { state: 'archived' } : null
  }
  if (interest.accepted >= 2) return { state: 'active' }
  const passedOver = (interest.accepted === 0 && interest.dismissed >= 2) || interest.shown >= (interest.accepted ? 12 : 6)
  if (!passedOver) return null
  const defers = interest.defers + 1
  const rest = DEFER_DAYS[defers - 1]
  return rest
    ? { state: 'deferred', defers, resume_at: now + rest * DAY }
    : { state: 'rejected', defers, resume_at: now + REJECT_DAYS * DAY }
}

/** How much an interest's stories count: less while it is on trial, has gone quiet, or keeps being ignored. */
export function interestWeight(interest: Interest, now: number): number {
  const quiet = interest.origin !== 'tracker' && now - (interest.last_signal_at ?? interest.created_at) > QUIET_DAYS * DAY
  const standing = interest.state === 'active' ? (quiet ? 0.5 : 1) : 0.8
  const taken = (interest.accepted + 0.3) / (interest.shown + 1)
  return standing * (0.5 + 0.5 * Math.min(1, taken / 0.3))
}

function update(db: DB, id: number, change: Change): void {
  const columns = Object.keys(change)
  db.prepare(`UPDATE interests SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(change), id)
}

const interestsOf = (db: DB, userId: number) =>
  db.prepare('SELECT * FROM interests WHERE user_id = ? ORDER BY created_at, id').all(userId) as Interest[]

function advanceAll(db: DB, userId: number, now: number): void {
  for (const interest of interestsOf(db, userId)) {
    const change = advance(interest, now)
    if (change) update(db, interest.id, change)
  }
}

function addInterest(
  db: DB,
  userId: number,
  interest: { label: string; queries: string[]; topic?: string | null; kind: InterestKind; origin: Interest['origin']; state: InterestState },
  now: number,
): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO interests (user_id, label, queries, topic, kind, origin, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, interest.label, JSON.stringify(interest.queries), interest.topic ?? null, interest.kind, interest.origin, interest.state, now)
      .changes > 0
  )
}

interface Signals {
  liked: { id: number; title: string }[]
  read: { id: number; title: string }[]
  hidden: string[]
  topics: string[]
  trackers: string[]
  searches: string[]
  /** What the reader watched, liked, saved and follows on the accounts they connected. */
  outside: OutsideActivity[]
}

const told = (item: OutsideActivity) => [item.platform, item.by, item.title].filter(Boolean).join(' | ')

/** The newest items of one kind, taken in turn from each platform so that one account does not crowd out the rest. */
function elsewhere(signals: Signals, kind: OutsideActivity['kind'], limit: number): string[] {
  const byPlatform = new Map<string, OutsideActivity[]>()
  for (const item of signals.outside) {
    if (item.kind === kind) byPlatform.set(item.platform, [...(byPlatform.get(item.platform) ?? []), item])
  }
  const lists = [...byPlatform.values()]
  const taken: OutsideActivity[] = []
  for (let turn = 0; taken.length < limit && lists.some((list) => turn < list.length); turn++) {
    for (const list of lists) if (turn < list.length && taken.length < limit) taken.push(list[turn])
  }
  return taken.map(told)
}

function gather(db: DB, userId: number, now: number): Signals {
  const since = now - SIGNAL_WINDOW
  const titles = (where: string, order: string, limit: number) =>
    db
      .prepare(`SELECT id, title FROM articles WHERE user_id = ? AND ${where} ORDER BY ${order} DESC LIMIT ?`)
      .all(userId, since, limit) as { id: number; title: string }[]
  return {
    liked: titles('MAX(COALESCE(liked_at, 0), COALESCE(saved_at, 0)) >= ?', 'MAX(COALESCE(liked_at, 0), COALESCE(saved_at, 0))', 40),
    read: titles('read_at >= ? AND liked_at IS NULL AND saved_at IS NULL', 'read_at', 40),
    hidden: titles('hidden_at >= ?', 'hidden_at', 20).map((row) => row.title),
    topics: db.prepare('SELECT name FROM topics WHERE user_id = ? ORDER BY position, id').pluck().all(userId) as string[],
    trackers: db.prepare('SELECT phrase FROM trackers WHERE user_id = ?').pluck().all(userId) as string[],
    searches: (db.prepare(`SELECT feed_url FROM sources WHERE user_id = ? AND kind = 'feed' AND feed_url LIKE 'search:%'`).pluck().all(userId) as string[]).map(
      (url) => url.replace(/^search:[a-z]+:/, ''),
    ),
    outside: outsideActivity(db, userId),
  }
}

/** Every tracked keyword is an interest for as long as it is tracked. */
function followTrackers(db: DB, userId: number, trackers: string[], now: number): void {
  const tracked = new Set(trackers.map((phrase) => phrase.toLowerCase()))
  const byLabel = new Map(interestsOf(db, userId).map((interest) => [interest.label.toLowerCase(), interest]))
  for (const phrase of trackers) {
    const existing = byLabel.get(phrase.toLowerCase())
    if (!existing) addInterest(db, userId, { label: phrase, queries: [phrase], kind: 'near', origin: 'tracker', state: 'active' }, now)
    else if (existing.origin !== 'tracker' || existing.state !== 'active') update(db, existing.id, { origin: 'tracker', state: 'active', resume_at: null })
  }
  for (const interest of byLabel.values()) {
    if (interest.origin === 'tracker' && !tracked.has(interest.label.toLowerCase())) {
      update(db, interest.id, { origin: 'history', last_signal_at: interest.last_signal_at ?? now })
    }
  }
}

function openSlots(db: DB, userId: number): { near: number; explore: number } {
  const trials = interestsOf(db, userId).filter((interest) => interest.state === 'trial')
  const exploring = trials.filter(isExplore).length
  return { near: Math.max(0, NEAR_TRIALS - (trials.length - exploring)), explore: Math.max(0, EXPLORE_TRIALS - exploring) }
}

function addProposals(db: DB, userId: number, proposals: ProposedInterest[], slots: { near: number; explore: number }, now: number): void {
  const left = { ...slots }
  for (const proposal of proposals) {
    const label = proposal.label?.trim().slice(0, 60)
    const queries = (proposal.queries ?? []).map((query) => query.trim().slice(0, 60)).filter(Boolean).slice(0, 3)
    const pool = proposal.kind === 'near' ? 'near' : 'explore'
    if (!label || queries.length === 0 || !['near', 'lateral', 'wildcard'].includes(proposal.kind) || left[pool] === 0) continue
    const topic = proposal.topic?.trim().slice(0, 40) || null
    if (addInterest(db, userId, { label, queries, topic, kind: proposal.kind, origin: 'ai', state: 'trial' }, now)) left[pool]--
  }
}

/** The videos behind the reader's outside activity; the channels they follow are not stories. */
const taken = (signals: Signals) => signals.outside.filter((item) => item.kind !== 'followed')

/** A name rather than an ordinary word: capitalised, more than one word, or Chinese. */
const NAME = /^\p{Lu}|\s|[\u3400-\u9fff]/u

/** Without a model, an interest is a name that keeps turning up in what the reader liked, saved, read and watched. */
function addRecurringPhrases(db: DB, userId: number, signals: Signals, slots: number, now: number): void {
  const rows = [
    ...[...signals.liked, ...signals.read].map((row) => ({ title: row.title, source_id: row.id })),
    ...taken(signals).map((item, index) => ({ title: item.title, source_id: -1 - index })),
  ]
  const known = interestsOf(db, userId).map((interest) => interest.label.toLowerCase())
  let left = slots
  for (const { phrase } of trending(rows, [], 1, 12)) {
    if (left === 0) break
    // A possessive or longer form of a subject that is already there adds nothing.
    const plain = phrase.toLowerCase().replace(/[’']s$/, '')
    if (!NAME.test(phrase) || known.some((label) => plain.includes(label) || label.includes(plain))) continue
    known.push(plain)
    if (addInterest(db, userId, { label: phrase, queries: [phrase], kind: 'near', origin: 'history', state: 'trial' }, now)) left--
  }
}

/** The topic names a new account starts from make way, untouched, once there is something real to learn from. */
function retireStartingTopics(db: DB, userId: number): void {
  db.prepare(`UPDATE interests SET state = 'archived' WHERE user_id = ? AND origin = 'history' AND state = 'trial' AND accepted = 0 AND label = topic`).run(userId)
}

/** Brings the account's interests up to date; returns the code of a model failure, if there was one. */
async function learn(db: DB, userId: number, lang: Lang, now: number): Promise<string | null> {
  const signals = gather(db, userId, now)
  followTrackers(db, userId, signals.trackers, now)
  advanceAll(db, userId, now)

  const history = signals.liked.length + signals.read.length + taken(signals).length
  if (history < 3) {
    // Nothing to learn from yet: start from the names of the reader's own topics.
    if (interestsOf(db, userId).length === 0) {
      for (const name of signals.topics.slice(0, NEAR_TRIALS)) {
        addInterest(db, userId, { label: name, queries: [name], topic: name, kind: 'near', origin: 'history', state: 'trial' }, now)
      }
    }
    return null
  }

  retireStartingTopics(db, userId)
  const slots = openSlots(db, userId)
  if (hasClaude() && slots.near + slots.explore > 0) {
    const known = interestsOf(db, userId)
    const live = (interest: Interest) => ['trial', 'active', 'deferred'].includes(interest.state)
    try {
      const proposals = await proposeInterests(
        {
          liked: signals.liked.map((row) => row.title),
          read: signals.read.map((row) => row.title),
          hidden: signals.hidden,
          topics: signals.topics,
          following: [...new Set([...known.filter(live).map((interest) => interest.label), ...signals.searches])],
          declined: known.filter((interest) => !live(interest)).map((interest) => interest.label),
          elsewhere: {
            watched: elsewhere(signals, 'watched', 40),
            liked: elsewhere(signals, 'liked', 40),
            saved: elsewhere(signals, 'saved', 20),
            followed: elsewhere(signals, 'followed', 60),
          },
        },
        { near: Math.min(slots.near, 3), explore: slots.explore },
        lang,
      )
      addProposals(db, userId, proposals, slots, now)
      return null
    } catch (error) {
      addRecurringPhrases(db, userId, signals, slots.near, now)
      return error instanceof Failure ? error.code : 'ai_error'
    }
  }
  addRecurringPhrases(db, userId, signals, slots.near, now)
  return null
}

/** The interests one round searches for: the strongest active ones, every exploratory trial, then near trials. */
export function roundInterests(interests: Interest[], now: number): Interest[] {
  const active = interests.filter((interest) => interest.state === 'active').sort((a, b) => interestWeight(b, now) - interestWeight(a, now))
  const trials = interests.filter((interest) => interest.state === 'trial')
  const order = [...active.slice(0, ACTIVE_PER_ROUND), ...trials.filter(isExplore), ...trials.filter((trial) => !isExplore(trial)), ...active.slice(ACTIVE_PER_ROUND)]
  return order.slice(0, INTERESTS_PER_ROUND)
}

export interface Candidate {
  id: number
  title: string
  excerpt: string
  publisher: string | null
  provider: string
  interest: Interest
  relevance: number
  score: number
}

interface Found {
  id: number
  title: string
  excerpt: string
  publisher: string | null
  published_at: number
}

const LOGIN_LOST = new Set(['xiaohongshu_login', 'xiaohongshu_check'])

/** Searches every platform for the round's interests. A search that fails is passed over, except that a lost login is reported. */
async function find(db: DB, userId: number, interests: Interest[], now: number): Promise<{ candidates: Candidate[]; problem: string | null }> {
  const turn = Math.floor(now / DAY)
  const spent = new Map<string, number>()
  const jobs = interests.flatMap((interest) => {
    const queries = queriesOf(interest)
    const query = queries[turn % queries.length]
    return discoveryProviders(query)
      .filter((provider) => {
        const used = spent.get(provider.id) ?? 0
        if (provider.perRound && used >= provider.perRound) return false
        spent.set(provider.id, used + 1)
        return true
      })
      .map((provider) => ({ interest, query, provider: provider.id }))
  })
  const lost: string[] = []
  const results = await pool(jobs, 5, (job) =>
    searchInto(db, userId, job.provider, job.query, now).catch((error) => {
      if (error instanceof Failure && LOGIN_LOST.has(error.code)) lost.push(error.code)
      return [] as number[]
    }),
  )

  const unseen = db.prepare(
    `SELECT a.id, a.title, a.excerpt, a.publisher, a.published_at
     FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE a.id = ? AND s.kind = 'results' AND a.published_at >= ?
       AND a.seen_at IS NULL AND a.read_at IS NULL AND a.hidden_at IS NULL AND a.liked_at IS NULL AND a.saved_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM suggestions g WHERE g.article_id = a.id)`,
  )
  const avoided = (db.prepare(`SELECT * FROM interests WHERE user_id = ? AND state = 'avoided'`).all(userId) as Interest[]).flatMap((interest) =>
    [interest.label, ...queriesOf(interest)].map(phraseMatcher),
  )

  const candidates = new Map<number, Candidate>()
  jobs.forEach((job, index) => {
    const matcher = phraseMatcher(job.query)
    for (const id of results[index]) {
      if (candidates.has(id)) continue
      const found = unseen.get(id, now - FRESH_FOR) as Found | undefined
      if (!found || avoided.some((avoid) => avoid.test(`${found.title}\n${found.excerpt}`))) continue
      const relevance = matcher.test(found.title) ? 1 : matcher.test(found.excerpt) ? 0.6 : 0.3
      const recency = 0.5 ** (Math.max(0, now - found.published_at) / RECENCY_HALF_LIFE)
      candidates.set(id, {
        id,
        title: found.title,
        excerpt: found.excerpt,
        publisher: found.publisher,
        provider: job.provider,
        interest: job.interest,
        relevance,
        score: relevance * recency * interestWeight(job.interest, now),
      })
    }
  })
  return { candidates: [...candidates.values()].sort((a, b) => b.score - a.score), problem: lost[0] ?? null }
}

function profile(interests: Interest[], signals: Signals): string {
  const labels = (state: InterestState) => interests.filter((interest) => interest.state === state).map((interest) => interest.label)
  const section = (heading: string, items: string[]) => (items.length ? `${heading}\n${items.map((item) => `- ${item}`).join('\n')}` : '')
  return [
    'A reader of a personal news feed.',
    section('Subjects they follow closely:', labels('active')),
    section('Subjects they have asked the feed to try for them:', labels('trial')),
    section('Subjects they do not want:', labels('avoided')),
    section('Headlines they recently liked or saved:', signals.liked.slice(0, 25).map((row) => row.title)),
    section('Videos they recently liked or saved on other platforms:', [...elsewhere(signals, 'liked', 10), ...elsewhere(signals, 'saved', 10)]),
    section('Headlines they recently hid:', signals.hidden.slice(0, 10)),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The candidates worth judging: every interest's best few, so a busy subject cannot crowd the rest out. */
export function shortlist<T extends { interest: Pick<Interest, 'id'> }>(candidates: T[], size = JUDGED): T[] {
  const groups = new Map<number, T[]>()
  for (const candidate of candidates) groups.set(candidate.interest.id, [...(groups.get(candidate.interest.id) ?? []), candidate])
  const each = Math.ceil(size / Math.max(1, groups.size))
  return [...groups.values()].flatMap((group) => group.slice(0, each))
}

/** Replaces rule relevance with a judged one and drops what falls below the bar. */
async function judge(candidates: Candidate[], reader: string): Promise<Candidate[]> {
  const judged = shortlist(candidates)
  const scores = await scoreRelevance(
    reader,
    judged.map(({ id, title, excerpt, interest }) => ({ id, title, excerpt, subject: interest.label })),
  )
  return judged
    .flatMap((candidate) => {
      const relevance = scores.get(candidate.id)
      if (relevance === undefined || relevance < ADMIT) return []
      return [{ ...candidate, relevance, score: (candidate.score / candidate.relevance) * relevance }]
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * Picks the stories to show: the best first, each next one marked down by how much its title repeats
 * one already chosen, with a cap per interest, per publisher and per platform. A quarter of the places are held
 * for interests outside the reader's known tastes, when those have something to offer.
 */
export function select<T extends Pick<Candidate, 'id' | 'title' | 'publisher' | 'provider' | 'score'> & { interest: Pick<Interest, 'id' | 'kind'> }>(
  candidates: T[],
  limit = PICKS,
): T[] {
  const words = new Map(candidates.map((candidate) => [candidate.id, new Set(phrases(candidate.title).keys())]))
  const overlap = (a: T, b: T) => {
    const [left, right] = [words.get(a.id)!, words.get(b.id)!]
    let shared = 0
    for (const word of left) if (right.has(word)) shared++
    return shared === 0 ? 0 : shared / (left.size + right.size - shared)
  }
  // One platform may take five places, or an even share when only a few platforms have anything.
  const perPlatform = Math.max(PER_PLATFORM, Math.ceil(limit / new Set(candidates.map((candidate) => candidate.provider)).size))
  const picked: T[] = []
  const count = (key: (candidate: T) => string | number, candidate: T) => picked.filter((other) => key(other) === key(candidate)).length

  const fill = (from: T[], upTo: number) => {
    const left = from.filter((candidate) => !picked.includes(candidate))
    while (picked.length < upTo) {
      let best: T | undefined
      let bestValue = -Infinity
      for (const candidate of left) {
        if (picked.includes(candidate)) continue
        if (count((c) => c.interest.id, candidate) >= PER_INTEREST) continue
        if (count((c) => c.publisher ?? c.provider, candidate) >= PER_PUBLISHER) continue
        if (count((c) => c.provider, candidate) >= perPlatform) continue
        const nearest = Math.max(0, ...picked.map((other) => overlap(candidate, other)))
        if (nearest >= SAME_STORY) continue
        const value = candidate.score * (1 - nearest)
        if (value > bestValue) [best, bestValue] = [candidate, value]
      }
      if (!best) break
      picked.push(best)
    }
  }

  fill(candidates.filter((candidate) => isExplore(candidate.interest)), Math.min(limit, Math.max(1, Math.floor(limit * 0.25))))
  fill(candidates, limit)
  return picked.sort((a, b) => b.score - a.score)
}

function recordRound(db: DB, userId: number, now: number, problem: string | null): void {
  db.prepare(
    `INSERT INTO suggestion_rounds (user_id, ran_at, problem) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET ran_at = excluded.ran_at, problem = excluded.problem`,
  ).run(userId, now, problem)
}

/** One pass of learn, find, rank, select and explain for an account. */
export async function runRound(db: DB, userId: number, lang: Lang, now = Date.now()): Promise<{ picked: number; problem: string | null }> {
  const lost = await syncAccounts(db, userId, now)
  const unlearned = await learn(db, userId, lang, now)
  let problem = lost ?? unlearned
  const interests = interestsOf(db, userId)
  const signals = gather(db, userId, now)
  const found = await find(db, userId, roundInterests(interests, now), now)
  let candidates = found.candidates
  problem ??= found.problem

  if (hasDecisions() && candidates.length > 0) {
    try {
      candidates = await judge(candidates, profile(interests, signals))
    } catch (error) {
      problem ??= error instanceof Failure ? error.code : 'decisions_failed'
    }
  }

  const picks = select(candidates)
  let reasons = new Map<number, string>()
  if (hasClaude() && picks.length > 0) {
    try {
      reasons = await explain(
        picks.map((pick) => ({
          id: pick.id,
          subject: pick.interest.label,
          followed: pick.interest.state === 'active',
          platform: providerName(pick.provider),
          title: pick.title,
          excerpt: pick.excerpt,
        })),
        [...signals.liked.map((row) => row.title), ...signals.outside.filter((item) => item.kind === 'liked' || item.kind === 'saved').map((item) => item.title)].slice(0, 25),
        lang,
      )
    } catch (error) {
      problem ??= error instanceof Failure ? error.code : 'ai_error'
    }
  }

  await fillMissingImages(db, { articleIds: picks.map((pick) => pick.id) })

  const insert = db.prepare(
    `INSERT OR IGNORE INTO suggestions (article_id, user_id, interest_id, provider, score, reason, lang, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const shown = db.prepare('UPDATE interests SET shown = shown + 1 WHERE id = ?')
  db.transaction(() => {
    for (const pick of picks) {
      const added = insert.run(pick.id, userId, pick.interest.id, pick.provider, pick.score, reasons.get(pick.id) ?? null, lang, now).changes
      if (added) shown.run(pick.interest.id)
    }
    recordRound(db, userId, now, problem)
  })()
  return { picked: picks.length, problem }
}

const running = new Map<number, Promise<unknown>>()

export const roundRunning = (userId: number) => running.has(userId)

export function roundStatus(db: DB, userId: number): { ranAt: number | null; problem: string | null } {
  const row = db.prepare('SELECT ran_at, problem FROM suggestion_rounds WHERE user_id = ?').get(userId) as
    | { ran_at: number; problem: string | null }
    | undefined
  return { ranAt: row?.ran_at ?? null, problem: row?.problem ?? null }
}

export const roundDue = (db: DB, userId: number, now = Date.now()) => (roundStatus(db, userId).ranAt ?? 0) < now - ROUND_EVERY

/** Starts a round in the background unless one is already under way for the account. */
export function startRound(db: DB, userId: number, lang: Lang, onError: (error: unknown) => void): void {
  if (running.has(userId)) return
  const round = runRound(db, userId, lang)
    .catch((error) => {
      // A round that broke still counts as run, so the next visit does not start it over and over.
      recordRound(db, userId, Date.now(), 'round_failed')
      onError(error)
    })
    .finally(() => running.delete(userId))
  running.set(userId, round)
}

/** Notes what the reader did with a suggested story; anything else is left alone. */
export function recordOutcome(db: DB, userId: number, articleId: number, outcome: 'accepted' | 'dismissed', now = Date.now()): void {
  const suggestion = db.prepare('SELECT interest_id, outcome FROM suggestions WHERE article_id = ? AND user_id = ?').get(articleId, userId) as
    | { interest_id: number; outcome: string | null }
    | undefined
  if (!suggestion || suggestion.outcome === outcome || suggestion.outcome === 'accepted') return
  db.prepare('UPDATE suggestions SET outcome = ? WHERE article_id = ?').run(outcome, articleId)
  if (outcome === 'accepted') db.prepare('UPDATE interests SET accepted = accepted + 1, last_signal_at = ? WHERE id = ?').run(now, suggestion.interest_id)
  else db.prepare('UPDATE interests SET dismissed = dismissed + 1 WHERE id = ?').run(suggestion.interest_id)
  const interest = db.prepare('SELECT * FROM interests WHERE id = ?').get(suggestion.interest_id) as Interest
  const change = advance(interest, now)
  if (change) update(db, interest.id, change)
}

export function listSuggestions(db: DB, userId: number, now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT g.provider, g.reason, g.lang, i.id AS interest_id, i.label AS interest_label, i.kind AS interest_kind, x.*
       FROM suggestions g
       JOIN interests i ON i.id = g.interest_id
       JOIN (${ARTICLE_SELECT}) x ON x.id = g.article_id
       WHERE g.user_id = ? AND g.created_at >= ? AND i.state != 'avoided' AND (g.outcome IS NULL OR g.outcome = 'accepted')
       ORDER BY g.created_at DESC, g.score DESC LIMIT 24`,
    )
    .all(userId, now - 3 * DAY) as (ArticleRow & {
    provider: string
    reason: string | null
    lang: string | null
    interest_id: number
    interest_label: string
    interest_kind: InterestKind
  })[]
  return rows.map((row) => ({
    article: toArticle(row),
    provider: row.provider,
    reason: row.reason,
    lang: row.lang,
    interest: { id: row.interest_id, label: row.interest_label, kind: row.interest_kind },
  }))
}

export function listInterests(db: DB, userId: number) {
  return interestsOf(db, userId)
    .filter((interest) => interest.state !== 'archived')
    .map(({ id, label, kind, origin, state, shown, accepted }) => ({ id, label, kind, origin, state, shown, accepted }))
}

/** Avoiding a subject drops its pending suggestions; restoring one gives it a fresh trial. */
export function setAvoided(db: DB, userId: number, interestId: number, avoided: boolean, now = Date.now()): boolean {
  const interest = db.prepare('SELECT * FROM interests WHERE id = ? AND user_id = ?').get(interestId, userId) as Interest | undefined
  if (!interest) return false
  if (avoided) {
    db.transaction(() => {
      db.prepare('DELETE FROM suggestions WHERE interest_id = ? AND outcome IS NULL').run(interestId)
      update(db, interestId, { state: 'avoided', resume_at: null })
    })()
  } else if (interest.state !== 'trial' && interest.state !== 'active') {
    update(db, interestId, { state: 'trial', shown: 0, dismissed: 0, defers: 0, resume_at: null, last_signal_at: now })
  }
  return true
}

/** Makes the interest behind a suggestion a standing one, as when the reader follows something from it. */
export function confirmInterest(db: DB, userId: number, articleId: number, now = Date.now()): void {
  recordOutcome(db, userId, articleId, 'accepted', now)
  db.prepare(
    `UPDATE interests SET state = 'active', resume_at = NULL, last_signal_at = ?
     WHERE id = (SELECT interest_id FROM suggestions WHERE article_id = ? AND user_id = ?) AND state != 'avoided'`,
  ).run(now, articleId, userId)
}

export function suggestionOf(db: DB, userId: number, articleId: number) {
  return db
    .prepare(
      `SELECT g.provider, a.url, i.id AS interest_id, i.label, i.queries, i.topic
       FROM suggestions g JOIN articles a ON a.id = g.article_id JOIN interests i ON i.id = g.interest_id
       WHERE g.article_id = ? AND g.user_id = ?`,
    )
    .get(articleId, userId) as { provider: string; url: string; interest_id: number; label: string; queries: string; topic: string | null } | undefined
}
