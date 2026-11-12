import type { DB } from './db.ts'

export function phraseMatcher(phrase: string): RegExp {
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  // Chinese, Japanese and Korean text has no spaces between words, so a phrase in those scripts matches anywhere.
  if (/[぀-ヿ㐀-鿿가-힯]/.test(phrase)) return new RegExp(escaped, 'iu')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu')
}

interface Tracker {
  id: number
  user_id: number
  phrase: string
}

interface Candidate {
  id: number
  user_id: number
  title: string
  excerpt: string
}

function record(db: DB, trackers: Tracker[], articles: Candidate[], now: number): number {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tracker_hits (tracker_id, article_id, created_at) VALUES (?, ?, ?)',
  )
  let hits = 0
  db.transaction(() => {
    for (const tracker of trackers) {
      const matcher = phraseMatcher(tracker.phrase)
      for (const article of articles) {
        if (article.user_id !== tracker.user_id) continue
        if (matcher.test(`${article.title}\n${article.excerpt}`)) hits += insert.run(tracker.id, article.id, now).changes
      }
    }
  })()
  return hits
}

export function matchNewArticles(db: DB, articleIds: number[], now = Date.now()): number {
  if (articleIds.length === 0) return 0
  const trackers = db.prepare('SELECT id, user_id, phrase FROM trackers').all() as Tracker[]
  if (trackers.length === 0) return 0
  const byId = db.prepare('SELECT id, user_id, title, excerpt FROM articles WHERE id = ?')
  const articles = articleIds.map((id) => byId.get(id) as Candidate)
  return record(db, trackers, articles, now)
}

export function matchNewTracker(db: DB, trackerId: number, now = Date.now()): number {
  const tracker = db.prepare('SELECT id, user_id, phrase FROM trackers WHERE id = ?').get(trackerId) as Tracker
  const articles = db.prepare('SELECT id, user_id, title, excerpt FROM articles WHERE user_id = ?').all(tracker.user_id) as Candidate[]
  return record(db, [tracker], articles, now)
}
