import type { DB } from './db.ts'

const DEFAULTS: { name: string; zh: string; slug: string; sources: [title: string, site: string, feed: string][] }[] = [
  {
    name: 'AI',
    zh: 'AI',
    slug: 'ai',
    sources: [
      ['The Verge AI', 'https://www.theverge.com/ai-artificial-intelligence', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
      ['Ars Technica AI', 'https://arstechnica.com/ai/', 'https://arstechnica.com/ai/feed/'],
      ['TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
      ['The Decoder', 'https://the-decoder.com', 'https://the-decoder.com/feed/'],
      ['MIT Technology Review', 'https://www.technologyreview.com', 'https://www.technologyreview.com/feed/'],
      ['Google AI Blog', 'https://blog.google/technology/ai/', 'https://blog.google/technology/ai/rss/'],
      ['OpenAI News', 'https://openai.com/news/', 'https://openai.com/news/rss.xml'],
      ['Hugging Face Blog', 'https://huggingface.co/blog', 'https://huggingface.co/blog/feed.xml'],
      ['Simon Willison', 'https://simonwillison.net', 'https://simonwillison.net/atom/everything/'],
    ],
  },
  {
    name: 'Games',
    zh: '游戏',
    slug: 'games',
    sources: [
      ['IGN', 'https://www.ign.com', 'https://feeds.feedburner.com/ign/all'],
      ['Polygon', 'https://www.polygon.com', 'https://www.polygon.com/rss/index.xml'],
      ['Kotaku', 'https://kotaku.com', 'https://kotaku.com/rss'],
      ['GameSpot', 'https://www.gamespot.com', 'https://www.gamespot.com/feeds/mashup/'],
      ['Eurogamer', 'https://www.eurogamer.net', 'https://www.eurogamer.net/feed'],
      ['PC Gamer', 'https://www.pcgamer.com', 'https://www.pcgamer.com/rss/'],
      ['Rock Paper Shotgun', 'https://www.rockpapershotgun.com', 'https://www.rockpapershotgun.com/feed'],
      ['GamesIndustry.biz', 'https://www.gamesindustry.biz', 'https://www.gamesindustry.biz/feed'],
      ['Nintendo Life', 'https://www.nintendolife.com', 'https://www.nintendolife.com/feeds/latest'],
    ],
  },
  {
    name: 'Tech',
    zh: '科技',
    slug: 'tech',
    sources: [
      ['The Verge', 'https://www.theverge.com', 'https://www.theverge.com/rss/index.xml'],
      ['TechCrunch', 'https://techcrunch.com', 'https://techcrunch.com/feed/'],
      ['Ars Technica', 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index'],
      ['Wired', 'https://www.wired.com', 'https://www.wired.com/feed/rss'],
      ['Engadget', 'https://www.engadget.com', 'https://www.engadget.com/rss.xml'],
      ['Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage'],
      ['The Register', 'https://www.theregister.com', 'https://www.theregister.com/headlines.atom'],
      ['9to5Mac', 'https://9to5mac.com', 'https://9to5mac.com/feed/'],
      ['Android Authority', 'https://www.androidauthority.com', 'https://www.androidauthority.com/feed/'],
    ],
  },
]

/** Gives a new account the default topics and sources, with the topics named in its language. */
export function seedUser(db: DB, userId: number, lang: 'en' | 'zh' = 'en'): void {
  const addTopic = db.prepare('INSERT INTO topics (user_id, name, slug, position) VALUES (?, ?, ?, ?)')
  const addSource = db.prepare('INSERT INTO sources (user_id, topic_id, title, site_url, feed_url) VALUES (?, ?, ?, ?, ?)')
  db.transaction(() => {
    DEFAULTS.forEach((topic, position) => {
      const { lastInsertRowid } = addTopic.run(userId, lang === 'zh' ? topic.zh : topic.name, topic.slug, position)
      for (const [title, site, feed] of topic.sources) addSource.run(userId, lastInsertRowid, title, site, feed)
    })
  })()
}
