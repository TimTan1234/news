import type { DB } from './db.ts'

const STOPWORDS = new Set(
  `a about after again all also an and any are as at back be been before best big but by can could day deal deals
  did do does down every first for from get gets getting go going good got had has have he her here his how i if in
  into is it its just know last latest like live look make makes may me more most much my need new news next no not
  now of off on one only or other our out over own says see should so some still than that the their them then
  there these they this time to today too top up us use using via want was way we week what when where which who
  why will with year years you your review reviews guide update updates report reports watch video best-of vs
  could would might been being were here's it's that's what's don't can't won't isn't finally actually really
  announces announced launches launched reveals revealed coming comes release released free price official
  ai game games gaming tech app apps phone phones home ceo company companies model models pc console trailer
  launch world play players voice data tool tools feature features users people plan plans help work better
  reportedly according agent agents deal sale codes code promo coupons off black friday`.split(/\s+/),
)

export interface TitleRow {
  title: string
  source_id: number
}

export interface Trend {
  phrase: string
  sources: number
  articles: number
}

function words(title: string): string[] {
  return title.match(/[\p{L}\p{N}][\p{L}\p{N}+#.'’-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) ?? []
}

function meaningful(word: string): boolean {
  const lower = word.toLowerCase()
  return lower.length > 1 && !STOPWORDS.has(lower) && !/^\d+$/.test(lower)
}

function phrases(title: string): Map<string, string> {
  const tokens = words(title)
  const found = new Map<string, string>()
  tokens.forEach((token, index) => {
    if (!meaningful(token)) return
    found.set(token.toLowerCase(), token)
    const next = tokens[index + 1]
    if (next && (meaningful(next) || /^\d+$/.test(next))) found.set(`${token} ${next}`.toLowerCase(), `${token} ${next}`)
  })
  return found
}

interface Tally {
  sources: Set<number>
  articles: number
  forms: Map<string, number>
}

function tally(rows: TitleRow[]): Map<string, Tally> {
  const counts = new Map<string, Tally>()
  for (const row of rows) {
    for (const [key, form] of phrases(row.title)) {
      const entry = counts.get(key) ?? { sources: new Set(), articles: 0, forms: new Map() }
      entry.sources.add(row.source_id)
      entry.articles++
      entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1)
      counts.set(key, entry)
    }
  }
  return counts
}

/**
 * Phrases covered by at least two sources in `recent`, and at least twice as
 * frequent there as their daily average across `baseline` (spanning `baselineDays`).
 */
export function trending(recent: TitleRow[], baseline: TitleRow[], baselineDays: number, limit = 12): Trend[] {
  const before = tally(baseline)
  const candidates = [...tally(recent)]
    .filter(([key, entry]) => {
      if (entry.sources.size < 2) return false
      const usual = (before.get(key)?.articles ?? 0) / baselineDays
      return entry.articles >= usual * 2
    })
    .map(([key, entry]) => ({
      key,
      phrase: [...entry.forms].sort((a, b) => b[1] - a[1])[0][0],
      sources: entry.sources.size,
      articles: entry.articles,
    }))
    .sort((a, b) => b.sources - a.sources || b.articles - a.articles || b.key.length - a.key.length)

  // A single word gives way to a two-word phrase that accounts for most of its mentions.
  const pairs = candidates.filter((candidate) => candidate.key.includes(' '))
  const distinct = candidates.filter(
    (candidate) =>
      candidate.key.includes(' ') ||
      !pairs.some((pair) => pair.key.split(' ').includes(candidate.key) && pair.articles >= candidate.articles * 0.7),
  )

  const chosen: typeof candidates = []
  const used = new Set<string>()
  for (const candidate of distinct) {
    const parts = candidate.key.split(' ')
    if (parts.some((part) => used.has(part))) continue
    parts.forEach((part) => used.add(part))
    chosen.push(candidate)
    if (chosen.length === limit) break
  }
  return chosen.map(({ phrase, sources, articles }) => ({ phrase, sources, articles }))
}

const DAY = 24 * 60 * 60 * 1000
const BASELINE_DAYS = 6

export function currentTrends(db: DB, now = Date.now()): Trend[] {
  const between = db.prepare(
    `SELECT a.title, a.source_id FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE s.followed = 1 AND a.published_at >= ? AND a.published_at < ?`,
  )
  const recent = between.all(now - DAY, now + 1) as TitleRow[]
  const baseline = between.all(now - DAY * (BASELINE_DAYS + 1), now - DAY) as TitleRow[]
  return trending(recent, baseline, BASELINE_DAYS)
}
