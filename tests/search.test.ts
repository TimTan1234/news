import { describe, expect, it } from 'vitest'
import { bilibiliEntry, discoveryProviders, gitHubEntry, hackerNewsEntry, parseSearchUrl, unwrapBing, youTubeEntry } from '../server/search.ts'
import { trending } from '../server/trending.ts'

const NOW = Date.parse('2026-11-12T08:00:00Z')

describe('news search', () => {
  it('unwraps the article address from a Bing click link', () => {
    const link = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=6af5&url=https%3a%2f%2fwww.mmobomb.com%2fnews%2fghost-train&c=77&mkt=en-my'
    expect(unwrapBing(link)).toBe('https://www.mmobomb.com/news/ghost-train')
    expect(unwrapBing('https://example.com/story')).toBe('https://example.com/story')
  })
})

describe('bilibili search', () => {
  it('maps a video result to an entry', () => {
    const entry = bilibiliEntry(
      {
        title: '<em class="keyword">鸣潮</em>3.8 前瞻 &amp; 抽卡',
        bvid: 'BV1jVWd6LEqN',
        pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
        author: '栗悟饭',
        pubdate: 1794475115,
        description: '左右同屏双开',
      },
      NOW + 10 * 86_400_000,
    )
    expect(entry).toEqual({
      url: 'https://www.bilibili.com/video/BV1jVWd6LEqN',
      title: '鸣潮3.8 前瞻 & 抽卡',
      excerpt: '左右同屏双开',
      image: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
      author: '栗悟饭',
      publisher: '栗悟饭',
      publishedAt: 1794475115000,
    })
  })

  it('skips results without an id or title', () => {
    expect(bilibiliEntry({ title: 'x' }, NOW)).toBeNull()
    expect(bilibiliEntry({ bvid: 'BV1' }, NOW)).toBeNull()
  })
})

describe('followed searches', () => {
  it('reads the provider and query back out of a stored address', () => {
    expect(parseSearchUrl('search:news:wuthering waves')).toEqual({ provider: 'news', query: 'wuthering waves' })
    expect(parseSearchUrl('search:weibo:鸣潮: 3.8')).toEqual({ provider: 'weibo', query: '鸣潮: 3.8' })
    expect(parseSearchUrl('search:news')).toBeNull()
    expect(parseSearchUrl('https://example.com/feed')).toBeNull()
  })
})

describe('trending in Chinese', () => {
  it('finds words shared across sources in unspaced titles', () => {
    const rows = [
      { title: '库洛公布鸣潮3.8版本前瞻', source_id: 1 },
      { title: '鸣潮新角色莉莉实机演示', source_id: 2 },
      { title: '小米发布新款手机', source_id: 3 },
    ]
    expect(trending(rows, [], 6).map((trend) => trend.phrase)).toEqual(['鸣潮'])
  })
})

describe('other platforms', () => {
  it('maps a Hacker News story, linking to the discussion when it has no address of its own', () => {
    const hit = { objectID: '42', title: 'Show HN: Pulse', author: 'pg', points: 120, num_comments: 45, created_at_i: 1794475115 }
    expect(hackerNewsEntry(hit, NOW + 10 * 86_400_000)).toEqual({
      url: 'https://news.ycombinator.com/item?id=42',
      title: 'Show HN: Pulse',
      excerpt: '120 points, 45 comments',
      image: null,
      author: 'pg',
      publisher: 'Hacker News',
      publishedAt: 1794475115000,
    })
    expect(hackerNewsEntry({ ...hit, url: 'https://pulse.example' }, NOW)?.url).toBe('https://pulse.example')
    expect(hackerNewsEntry({ objectID: '1', title: null }, NOW)).toBeNull()
  })

  it('maps a GitHub repository', () => {
    const repo = {
      full_name: 'acme/rocket',
      html_url: 'https://github.com/acme/rocket',
      description: 'A fast launcher',
      pushed_at: '2026-11-10T08:00:00Z',
      stargazers_count: 512,
      owner: { login: 'acme' },
    }
    expect(gitHubEntry(repo, NOW + 10 * 86_400_000)).toEqual({
      url: 'https://github.com/acme/rocket',
      title: 'acme/rocket',
      excerpt: 'A fast launcher (512 stars)',
      image: 'https://opengraph.githubassets.com/1/acme/rocket',
      author: 'acme',
      publisher: 'GitHub',
      publishedAt: Date.parse('2026-11-10T08:00:00Z'),
    })
    expect(gitHubEntry({ ...repo, description: null }, NOW)?.excerpt).toBe('512 stars')
  })

  it('maps a YouTube video and decodes its title', () => {
    const item = {
      id: { videoId: 'dQw4w9WgXcQ' },
      snippet: {
        title: 'Kirby &amp; Friends &#39;25',
        description: 'Full trailer',
        channelTitle: 'Nintendo',
        publishedAt: '2026-11-10T08:00:00Z',
        thumbnails: { default: { url: 'https://i.ytimg.com/d.jpg' }, high: { url: 'https://i.ytimg.com/h.jpg' } },
      },
    }
    expect(youTubeEntry(item, NOW + 10 * 86_400_000)).toEqual({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: "Kirby & Friends '25",
      excerpt: 'Full trailer',
      image: 'https://i.ytimg.com/h.jpg',
      author: 'Nintendo',
      publisher: 'Nintendo',
      publishedAt: Date.parse('2026-11-10T08:00:00Z'),
    })
    expect(youTubeEntry({ id: {}, snippet: { title: 'x' } }, NOW)).toBeNull()
  })

  it('keeps English-only platforms out of a Chinese search', () => {
    const ids = (query: string) => discoveryProviders(query).map((provider) => provider.id)
    expect(ids('wuthering waves')).toEqual(expect.arrayContaining(['news', 'bilibili', 'hackernews', 'github']))
    expect(ids('鸣潮')).toEqual(expect.arrayContaining(['news', 'bilibili']))
    expect(ids('鸣潮')).not.toContain('hackernews')
    expect(ids('鸣潮')).not.toContain('github')
  })
})
