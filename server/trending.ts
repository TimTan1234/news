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

const CJK = /[\u3400-\u9fff]/
const CHINESE_FILLER = new Set(
  '发布 宣布 推出 公布 曝光 上线 开启 正式 官方 最新 今日 今天 如何 什么 为何 可以 一个 我们 他们 这个 游戏 手机 公司 消息 表示 回应 全新 首次 即将 或将 来了'.split(' '),
)

function words(title: string): string[] {
  return title.match(/[\p{L}\p{N}][\p{L}\p{N}+#.'’-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) ?? []
}

function meaningful(word: string): boolean {
  const lower = word.toLowerCase()
  return lower.length > 1 && !STOPWORDS.has(lower) && !/^\d+$/.test(lower)
}

/**
 * Chinese has no spaces, and the names that trend are too new for a dictionary to split out,
 * so every run of two to four characters is a candidate and the ones several sources share win.
 */
function chineseRuns(text: string): string[] {
  const found: string[] = []
  for (const [run] of text.matchAll(/[\u3400-\u9fff]+/g)) {
    for (let size = 2; size <= 4; size++) {
      for (let start = 0; start + size <= run.length; start++) {
        const piece = run.slice(start, start + size)
        if (!CHINESE_FILLER.has(piece)) found.push(piece)
      }
    }
  }
  return found
}

function phrases(title: string): Map<string, string> {
  const found = new Map<string, string>()
  if (CJK.test(title)) {
    for (const piece of chineseRuns(title)) found.set(piece, piece)
    title = title.replace(/[\u3400-\u9fff]+/g, ' ')
  }
  const tokens = words(title)
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
    // Overlapping Chinese runs are fragments of one name; the first to rank stands for all of them.
    if (CJK.test(candidate.key) && chosen.some((kept) => kept.key.includes(candidate.key) || candidate.key.includes(kept.key))) continue
    parts.forEach((part) => used.add(part))
    chosen.push(candidate)
    if (chosen.length === limit) break
  }
  return chosen.map(({ phrase, sources, articles }) => ({ phrase, sources, articles }))
}

const DAY = 24 * 60 * 60 * 1000
const BASELINE_DAYS = 6

export function currentTrends(db: DB, userId: number, now = Date.now()): Trend[] {
  const between = db.prepare(
    `SELECT a.title, a.source_id FROM articles a JOIN sources s ON s.id = a.source_id
     WHERE a.user_id = ? AND s.followed = 1 AND a.published_at >= ? AND a.published_at < ?`,
  )
  const recent = between.all(userId, now - DAY, now + 1) as TitleRow[]
  const baseline = between.all(userId, now - DAY * (BASELINE_DAYS + 1), now - DAY) as TitleRow[]
  return trending(recent, baseline, BASELINE_DAYS)
}
