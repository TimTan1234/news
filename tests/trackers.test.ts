import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { matchNewArticles, matchNewTracker, phraseMatcher } from '../server/trackers.ts'

describe('phraseMatcher', () => {
  it('matches whole words regardless of case', () => {
    expect(phraseMatcher('claude').test('Anthropic ships Claude update')).toBe(true)
    expect(phraseMatcher('AI').test('Why Britain said no')).toBe(false)
    expect(phraseMatcher('AI').test('The AI race')).toBe(true)
  })

  it('handles punctuation and flexible spacing inside the phrase', () => {
    expect(phraseMatcher('C++').test('Modern C++ in 2026')).toBe(true)
    expect(phraseMatcher('GPT-5').test('OpenAI unveils GPT-5.')).toBe(true)
    expect(phraseMatcher('Switch 2').test('The Switch  2 launch')).toBe(true)
    expect(phraseMatcher('Switch 2').test('Switch 25 rumours')).toBe(false)
  })

  it('matches Chinese phrases inside unspaced text', () => {
    expect(phraseMatcher('鸣潮').test('库洛公布鸣潮3.8版本前瞻')).toBe(true)
    expect(phraseMatcher('原神').test('库洛公布鸣潮3.8版本前瞻')).toBe(false)
  })
})

describe('tracker hits', () => {
  function setup() {
    const db = openDb(':memory:')
    db.exec(`
      INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', 'x', 0), (2, 'ben', 'x', 0);
      INSERT INTO topics (id, user_id, name, slug) VALUES (1, 1, 'Tech', 'tech'), (2, 2, 'Tech', 'tech');
      INSERT INTO sources (id, user_id, topic_id, title, site_url, feed_url) VALUES
        (1, 1, 1, 'S', 'https://s.example', 'https://s.example/feed'),
        (2, 2, 2, 'S', 'https://s.example', 'https://s.example/feed');
      INSERT INTO articles (id, user_id, source_id, url, title, excerpt, published_at, fetched_at) VALUES
        (1, 1, 1, 'https://s.example/1', 'Steam Deck 2 rumours', '', 1, 1),
        (2, 1, 1, 'https://s.example/2', 'Valve hardware roundup', 'Including the Steam Deck successor', 1, 1),
        (3, 1, 1, 'https://s.example/3', 'Unrelated', '', 1, 1),
        (4, 2, 2, 'https://s.example/1', 'Steam Deck 2 rumours', '', 1, 1);
    `)
    return db
  }

  it('matches existing articles when a tracker is created, in title or excerpt', () => {
    const db = setup()
    db.prepare(`INSERT INTO trackers (id, user_id, phrase, created_at) VALUES (1, 1, 'steam deck', 1)`).run()
    expect(matchNewTracker(db, 1)).toBe(2)
  })

  it('records each hit once', () => {
    const db = setup()
    db.prepare(`INSERT INTO trackers (id, user_id, phrase, created_at) VALUES (1, 1, 'steam deck', 1)`).run()
    expect(matchNewArticles(db, [1, 2, 3, 4])).toBe(2)
    expect(matchNewArticles(db, [1, 2, 3, 4])).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM tracker_hits').pluck().get()).toBe(2)
  })

  it('never matches another account\'s articles', () => {
    const db = setup()
    db.prepare(`INSERT INTO trackers (id, user_id, phrase, created_at) VALUES (1, 2, 'steam deck', 1)`).run()
    expect(matchNewArticles(db, [1, 2, 3, 4])).toBe(1)
    expect(db.prepare('SELECT article_id FROM tracker_hits').pluck().all()).toEqual([4])
  })
})
