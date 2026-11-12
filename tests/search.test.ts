import { describe, expect, it } from 'vitest'
import { bilibiliEntry, parseSearchUrl, unwrapBing } from '../server/search.ts'
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
