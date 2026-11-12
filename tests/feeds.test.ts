import { describe, expect, it } from 'vitest'
import { openDb } from '../server/db.ts'
import { RETENTION, ingest, makeExcerpt, normalizeUrl, parseFeed, pickImage, prune, siteIcon, toEntry, type Entry } from '../server/feeds.ts'
import { feedLinks } from '../server/discover.ts'
import { parseOpml, exportOpml } from '../server/opml.ts'

const NOW = Date.parse('2026-11-12T08:00:00Z')

const rss = (items: string) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Example</title><link>https://example.com</link>${items}</channel></rss>`

async function firstItem(xml: string) {
  return (await parseFeed(rss(xml))).items[0]
}

describe('pickImage', () => {
  it('prefers the widest media:content image over a thumbnail', async () => {
    const item = await firstItem(`<item><title>t</title>
      <media:thumbnail url="https://img.example.com/thumb.jpg"/>
      <media:content url="https://img.example.com/small.jpg" medium="image" width="300"/>
      <media:content url="https://img.example.com/large.jpg" medium="image" width="1200"/>
    </item>`)
    expect(pickImage(item)).toBe('https://img.example.com/large.jpg')
  })

  it('skips media:content that is not an image', async () => {
    const item = await firstItem(`<item><title>t</title>
      <media:content url="https://cdn.example.com/clip.mp4" medium="video"/>
      <media:thumbnail url="https://img.example.com/thumb.jpg"/>
    </item>`)
    expect(pickImage(item)).toBe('https://img.example.com/thumb.jpg')
  })

  it('reads images nested in media:group', async () => {
    const item = await firstItem(`<item><title>t</title>
      <media:group><media:content url="https://img.example.com/group.png" type="image/png"/></media:group>
    </item>`)
    expect(pickImage(item)).toBe('https://img.example.com/group.png')
  })

  it('uses an image enclosure but not an audio one', async () => {
    const image = await firstItem(`<item><title>t</title><enclosure url="https://img.example.com/a.webp" type="image/webp"/></item>`)
    const audio = await firstItem(`<item><title>t</title><enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg"/></item>`)
    expect(pickImage(image)).toBe('https://img.example.com/a.webp')
    expect(pickImage(audio)).toBeNull()
  })

  it('falls back to the first real image in the body, resolving it against the site', async () => {
    const item = await firstItem(`<item><title>t</title><content:encoded><![CDATA[
      <img src="https://stats.example.com/pixel.gif" width="1" height="1">
      <p><img src="/media/hero.jpg?w=800&amp;h=400" alt=""></p>
    ]]></content:encoded></item>`)
    expect(pickImage(item, 'https://example.com')).toBe('https://example.com/media/hero.jpg?w=800&h=400')
  })

  it('returns null when the item has no image', async () => {
    expect(pickImage(await firstItem(`<item><title>t</title><description>plain</description></item>`))).toBeNull()
  })
})

describe('toEntry', () => {
  it('strips tracking parameters and fragments from the link', () => {
    expect(normalizeUrl('https://example.com/a?utm_source=rss&id=7&UTM_medium=x#comments')).toBe('https://example.com/a?id=7')
  })

  it('drops items outside the retention window and clamps future dates', () => {
    const old = toEntry({ title: 'Old', link: 'https://example.com/old', isoDate: new Date(NOW - RETENTION - 1000).toISOString() }, NOW)
    const future = toEntry({ title: 'Soon', link: 'https://example.com/soon', isoDate: new Date(NOW + 60_000).toISOString() }, NOW)
    expect(old).toBeNull()
    expect(future?.publishedAt).toBe(NOW)
  })

  it('decodes entities and markup in titles', () => {
    const entry = toEntry({ title: 'Nintendo&#8217;s <em>next</em> console', link: 'https://example.com/n' }, NOW)
    expect(entry?.title).toBe('Nintendo’s next console')
  })

  it('shortens long excerpts at a word boundary', () => {
    const excerpt = makeExcerpt({ contentSnippet: 'word '.repeat(100) })
    expect(excerpt.length).toBeLessThanOrEqual(281)
    expect(excerpt.endsWith('word…')).toBe(true)
  })

  it('removes feed boilerplate from excerpts', () => {
    expect(makeExcerpt({ contentSnippet: 'A new model shipped. The post Model ships appeared first on Example.' })).toBe('A new model shipped.')
    expect(makeExcerpt({ contentSnippet: 'A new model shipped [&#8230;]' })).toBe('A new model shipped')
  })

  it('condenses aggregator descriptions to points and comments', () => {
    const excerpt = makeExcerpt({
      contentSnippet: 'Article URL: https://a.example Comments URL: https://news.ycombinator.com/item?id=1 Points: 312 # Comments: 87',
    })
    expect(excerpt).toBe('312 points, 87 comments')
  })

  it('reads an author given as a nested element', async () => {
    const item = await firstItem(`<item><title>Launch</title><link>https://example.com/launch</link>
      <author xmlns:author="http://www.w3.org/2005/Atom"><name>Min Choi</name><title>Product Manager</title></author>
    </item>`)
    expect(toEntry(item, NOW)).toMatchObject({ title: 'Launch', author: 'Min Choi' })
  })
})

describe('ingest', () => {
  function setup() {
    const db = openDb(':memory:')
    db.exec(`
      INSERT INTO topics (id, name, slug, position) VALUES (1, 'AI', 'ai', 0), (2, 'Tech', 'tech', 1);
      INSERT INTO sources (id, topic_id, title, site_url, feed_url) VALUES
        (1, 1, 'Site AI', 'https://site.example/ai', 'https://site.example/ai/feed'),
        (2, 2, 'Site', 'https://site.example', 'https://site.example/feed');
    `)
    return db
  }
  const entry = (url: string, publishedAt = NOW): Entry => ({ url, title: 'Story', excerpt: '', image: null, author: null, publishedAt })
  const owner = (db: ReturnType<typeof setup>, url: string) =>
    db.prepare('SELECT source_id FROM articles WHERE url = ?').pluck().get(url)

  it('stores a story once when two feeds carry it, under the narrower topic', () => {
    const db = setup()
    expect(ingest(db, 1, [entry('https://site.example/story')], NOW)).toHaveLength(1)
    expect(ingest(db, 2, [entry('https://site.example/story')], NOW)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) FROM articles').pluck().get()).toBe(1)
    expect(owner(db, 'https://site.example/story')).toBe(1)
  })

  it('moves a story to the narrower topic when the general feed published it first', () => {
    const db = setup()
    ingest(db, 2, [entry('https://site.example/story')], NOW)
    ingest(db, 1, [entry('https://site.example/story')], NOW)
    expect(owner(db, 'https://site.example/story')).toBe(1)
  })

  it('moves a story off an unfollowed source', () => {
    const db = setup()
    ingest(db, 1, [entry('https://site.example/story')], NOW)
    db.prepare('UPDATE sources SET followed = 0 WHERE id = 1').run()
    ingest(db, 2, [entry('https://site.example/story')], NOW)
    expect(owner(db, 'https://site.example/story')).toBe(2)
  })

  it('prunes expired articles but keeps saved, liked and read ones', () => {
    const db = setup()
    const expired = NOW - RETENTION - 1000
    ingest(db, 1, ['plain', 'saved', 'liked', 'read'].map((name) => entry(`https://site.example/${name}`, expired)), expired)
    ingest(db, 1, [entry('https://site.example/fresh')], NOW)
    db.prepare(`UPDATE articles SET saved_at = 1 WHERE url LIKE '%/saved'`).run()
    db.prepare(`UPDATE articles SET liked_at = 1 WHERE url LIKE '%/liked'`).run()
    db.prepare(`UPDATE articles SET read_at = 1 WHERE url LIKE '%/read'`).run()
    expect(prune(db, NOW)).toBe(1)
    expect(db.prepare('SELECT COUNT(*) FROM articles').pluck().get()).toBe(4)
    expect(db.prepare(`SELECT COUNT(*) FROM articles_fts WHERE articles_fts MATCH 'story'`).pluck().get()).toBe(4)
  })
})

describe('site metadata', () => {
  it('prefers the largest touch icon and falls back to favicon.ico', () => {
    const html = `<link rel="icon" href="/small.png" sizes="32x32"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="mask-icon" href="/mask.svg">`
    expect(siteIcon(html, 'https://example.com/news')).toBe('https://example.com/touch.png')
    expect(siteIcon(null, 'https://example.com/news')).toBe('https://example.com/favicon.ico')
  })

  it('finds feed links declared on a homepage', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="alternate" type="application/atom+xml" href="https://example.com/atom">`
    expect(feedLinks(html, 'https://example.com/')).toEqual(['https://example.com/feed.xml', 'https://example.com/atom'])
  })
})

describe('opml', () => {
  it('round-trips topics and sources', () => {
    const db = openDb(':memory:')
    db.exec(`
      INSERT INTO topics (id, name, slug, position) VALUES (1, 'AI & ML', 'ai-ml', 0);
      INSERT INTO sources (topic_id, title, site_url, feed_url) VALUES (1, 'Q&A "Daily"', 'https://qa.example', 'https://qa.example/feed?a=1&b=2');
    `)
    expect(parseOpml(exportOpml(db))).toEqual([
      { topic: 'AI & ML', title: 'Q&A "Daily"', siteUrl: 'https://qa.example', feedUrl: 'https://qa.example/feed?a=1&b=2' },
    ])
  })

  it('files feeds outside any folder under the fallback topic', () => {
    const xml = `<opml><body><outline type="rss" text="Loose" xmlUrl="https://loose.example/rss"/></body></opml>`
    expect(parseOpml(xml)).toEqual([
      { topic: 'Imported', title: 'Loose', siteUrl: 'https://loose.example', feedUrl: 'https://loose.example/rss' },
    ])
  })
})
