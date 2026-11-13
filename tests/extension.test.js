import { parseHTML } from 'linkedom'
import { afterEach, describe, expect, it } from 'vitest'
import * as douyin from '../extension/sites/douyin.js'
import * as instagram from '../extension/sites/instagram.js'
import * as tiktok from '../extension/sites/tiktok.js'
import { pageState, read, showTab, toActivity } from '../extension/sites/xiaohongshu.js'
import * as zhihu from '../extension/sites/zhihu.js'

const note = (id, title, by = '弋夕') => ({ id, xsecToken: 't', noteCard: { displayTitle: title, user: { nickname: by } } })

const realFetch = globalThis.fetch

afterEach(() => {
  delete globalThis.window
  delete globalThis.location
  delete globalThis.document
  globalThis.fetch = realFetch
})

/** Answers each request from the first entry whose fragment its address contains; anything else is a 404. */
function answering(routes) {
  const asked = []
  globalThis.fetch = async (path, init = {}) => {
    asked.push({ path, headers: init.headers ?? {} })
    const hit = Object.entries(routes).find(([fragment]) => path.includes(fragment))
    const [status, body] = hit ? (Array.isArray(hit[1]) ? hit[1] : [200, hit[1]]) : [404, {}]
    return { ok: status < 400, status, json: async () => body }
  }
  return asked
}

const page = (html) => {
  globalThis.document = parseHTML(`<!doctype html><html><head><title>主页 - 测试</title></head><body>${html}</body></html>`).document
}

/** The tools a reader is given, with every page call answered by `inPage`. */
const tools = ({ signedIn = true, inPage }) => {
  const visited = []
  return {
    visited,
    tools: {
      signedIn: async () => signedIn,
      open: async (url) => (visited.push(url), 1),
      go: async (_tab, url) => void visited.push(url),
      close: async () => void visited.push('closed'),
      inPage,
      until: async (ask) => {
        for (let asked = 0, answer; asked < 20; asked++) if ((answer = await ask())) return answer
        return null
      },
      wait: async () => {},
    },
  }
}

describe('xiaohongshu page state', () => {
  it('reads who is signed in and the notes of the tab that is showing', () => {
    globalThis.location = { host: 'www.rednote.com' }
    globalThis.window = {
      __INITIAL_STATE__: {
        user: {
          userInfo: { _value: { userId: 'u1', nickname: '小潮', guest: false } },
          activeTab: { _value: { index: 1, query: 'fav' } },
          notes: { _value: [[note('n0', '自己发的')], [note('n1', '客制化键盘入门'), { id: 'n2', noteCard: {} }], []] },
        },
      },
    }
    expect(pageState()).toEqual({
      host: 'www.rednote.com',
      guest: false,
      id: 'u1',
      name: '小潮',
      tab: 'fav',
      notes: [{ id: 'n1', title: '客制化键盘入门', by: '弋夕' }, { id: 'n2', title: null, by: null }],
    })
  })

  it('knows a visitor who is not signed in, and a page with no state yet', () => {
    globalThis.location = { host: 'www.xiaohongshu.com' }
    globalThis.window = { __INITIAL_STATE__: { user: { userInfo: { value: { guest: true } } } } }
    expect(pageState()).toMatchObject({ guest: true, id: null, notes: null })
    globalThis.window = {}
    expect(pageState()).toBeNull()
  })

  it('keeps notes that have an id and a title', () => {
    expect(toActivity('saved', [{ id: 'n1', title: ' 键盘 ', by: ' 老王 ' }, { id: 'n2', title: null }, { id: null, title: 'x' }])).toEqual([
      { kind: 'saved', ref: 'n1', title: '键盘', by: '老王' },
    ])
  })
})

/** A stand-in for the browser: one tab whose page state follows the address it was sent to. */
function browser({ signedIn = true, followsAddress = true, arriving = [] } = {}) {
  const visited = []
  let state = null
  const lists = { fav: [{ id: 'n1', title: '客制化键盘入门', by: '老王' }], liked: [{ id: 'n2', title: '鸣潮 3.8', by: '库洛' }, { id: 'n3', title: '', by: null }] }
  const page = (tab) => ({ host: 'www.rednote.com', guest: !signedIn, id: signedIn ? 'u1' : null, name: signedIn ? '小潮' : null, tab, notes: tab === 'note' ? [] : lists[tab] })
  const land = (url) => {
    visited.push(url)
    const asked = new URL(url).searchParams.get('tab')
    state = page(followsAddress && asked ? asked : 'note')
  }
  const closed = []
  return {
    visited,
    closed,
    tools: {
      open: async (url) => (land(url), 7),
      go: async (_tab, url) => land(url),
      close: async (tab) => void closed.push(tab),
      inPage: async (_tab, func, args) => {
        if (func === pageState) {
          // Notes still on their way join the saved list one reading at a time.
          if (state?.tab === 'fav' && arriving.length) lists.fav.push(arriving.shift())
          return state
        }
        if (func === showTab) {
          state = page(args[1] === 1 ? 'fav' : 'liked')
          return true
        }
        return null
      },
      until: async (ask) => {
        for (let asked = 0, answer; asked < 20; asked++) if ((answer = await ask())) return answer
        return null
      },
      wait: async () => {},
    },
  }
}

describe('reading a xiaohongshu account', () => {
  it('reads the saved and liked lists on the host the site sent it to, then closes its tab', async () => {
    const chrome = browser()
    expect(await read(chrome.tools)).toEqual({
      account: '小潮',
      items: [
        { kind: 'saved', ref: 'n1', title: '客制化键盘入门', by: '老王' },
        { kind: 'liked', ref: 'n2', title: '鸣潮 3.8', by: '库洛' },
      ],
    })
    expect(chrome.visited).toEqual([
      'https://www.xiaohongshu.com/explore',
      'https://www.rednote.com/user/profile/u1?tab=fav&subTab=note',
      'https://www.rednote.com/user/profile/u1?tab=liked&subTab=note',
    ])
    expect(chrome.closed).toEqual([7])
  })

  it('takes a list once the notes have stopped arriving', async () => {
    const arriving = [{ id: 'n4', title: '轴体对比', by: '老王' }, { id: 'n5', title: '键帽收纳', by: '阿宅' }]
    const found = await read(browser({ arriving }).tools)
    expect(found.items.filter((item) => item.kind === 'saved').map((item) => item.ref)).toEqual(['n1', 'n4', 'n5'])
  })

  it('clicks the tab when the address alone does not show it', async () => {
    const found = await read(browser({ followsAddress: false }).tools)
    expect(found.items.map((item) => item.kind)).toEqual(['saved', 'liked'])
  })

  it('says so when nobody is signed in, without opening the profile', async () => {
    const chrome = browser({ signedIn: false })
    expect(await read(chrome.tools)).toEqual({ problem: 'signed_out' })
    expect(chrome.visited).toHaveLength(1)
    expect(chrome.closed).toEqual([7])
  })
})

describe('zhihu', () => {
  const ROUTES = {
    'read_history?offset=0': {
      paging: { is_end: true },
      data: [
        { data: { header: { title: '如何评价鸣潮 3.8？' }, content: { author_name: '库洛观察' }, extra: { content_token: 'a1', content_type: 'answer' } } },
        { data: { header: { title: '如何评价鸣潮 3.8？' }, content: { author_name: '另一位答主' }, extra: { content_token: 'a9', content_type: 'answer' } } },
        { data: { header: { title: 'tan' }, content: {}, extra: { content_token: 'p1', content_type: 'people' } } },
        { data: { header: {}, content: {}, extra: { content_token: 'a2', content_type: 'article' } } },
      ],
    },
    '/api/v3/moments/xiaochao/activities': {
      data: [
        { action_text: '赞同了回答', target: { type: 'answer', id: 21, question: { title: '机械键盘<em>轴体</em>怎么选' }, author: { name: '老王' } } },
        { action_text: '关注了问题', target: { type: 'question', id: 22, title: '不算' } },
        { action_text: '喜欢了文章', target: { type: 'article', id: 23, title: 'Gemini 4 上手', author: { name: '阿宅' } } },
      ],
    },
    '/favlists?': { data: [{ id: 9 }] },
    '/api/v4/collections/9/items': [403, {}],
    '/api/v4/favlists/9/items': { data: [{ content: { type: 'article', id: 31, title: 'lazygit 入门', author: { name: '终端党' } } }] },
    '/api/v4/me': { name: '小潮', url_token: 'xiaochao' },
  }

  it('reads what was read, upvoted and collected, and notes how each request went', async () => {
    answering(ROUTES)
    const found = await zhihu.zhihuLists()
    expect(found.account).toBe('小潮')
    expect(found.items).toEqual([
      { kind: 'watched', ref: 'a1', title: '如何评价鸣潮 3.8？', by: '库洛观察' },
      { kind: 'liked', ref: '21', title: '机械键盘轴体怎么选', by: '老王' },
      { kind: 'liked', ref: '23', title: 'Gemini 4 上手', by: '阿宅' },
      { kind: 'saved', ref: '31', title: 'lazygit 入门', by: '终端党' },
    ])
    expect(found.notes).toContain('/api/v4/collections/9/items 403')
    expect(found.notes).toContain('/api/v4/favlists/9/items 200')
  })

  it('opens no page when the browser is not signed in, and trusts the site when it says so', async () => {
    const out = tools({ signedIn: false })
    expect(await zhihu.read(out.tools)).toEqual({ problem: 'signed_out' })
    expect(out.visited).toEqual([])

    answering({ '/api/v4/me': [401, {}] })
    const lapsed = tools({ inPage: () => zhihu.zhihuLists() })
    expect(await zhihu.read(lapsed.tools)).toEqual({ problem: 'signed_out', detail: '/api/v4/me 401' })
    expect(lapsed.visited).toEqual(['https://www.zhihu.com/', 'closed'])
  })
})

describe('instagram', () => {
  it('reads saved posts and followed accounts as the signed-in visitor', async () => {
    globalThis.document = { cookie: 'csrftoken=x; ds_user_id=4242; mid=y' }
    const asked = answering({
      '/api/v1/feed/saved/posts/': { items: [{ media: { code: 'Cxyz', caption: { text: 'Keychron Q1 build\nlubed switches' }, user: { username: 'keeb.lab' } } }, { media: { pk: 7 } }] },
      '/api/v1/friendships/4242/following/': { users: [{ pk: 55, username: 'wutheringwaves', full_name: 'Wuthering Waves' }, { pk: 56, username: 'plain' }] },
    })
    const found = await instagram.instagramLists()
    expect(found.items).toEqual([
      { kind: 'saved', ref: 'Cxyz', title: 'Keychron Q1 build', by: 'keeb.lab' },
      { kind: 'followed', ref: '55', title: 'Wuthering Waves', by: null },
      { kind: 'followed', ref: '56', title: 'plain', by: null },
    ])
    expect(found.notes).toEqual(['/api/v1/feed/saved/posts/ 200', '/api/v1/friendships/:id/following/ 200'])
    expect(asked[0].headers['x-ig-app-id']).toBe('936619743392459')
  })

  it('knows a visitor with no account cookie, and reports lists that would not load', async () => {
    globalThis.document = { cookie: 'mid=y' }
    expect(await instagram.instagramLists()).toEqual({ signedOut: true, notes: [] })

    globalThis.document = { cookie: 'ds_user_id=4242' }
    answering({})
    const blocked = tools({ inPage: () => instagram.instagramLists() })
    expect(await instagram.read(blocked.tools)).toEqual({ problem: 'unreadable', detail: '/api/v1/feed/saved/posts/ 404; /api/v1/friendships/:id/following/ 404' })
  })
})

describe('douyin', () => {
  const CARDS = `
    <h1>小潮</h1>
    <ul>
      <li><a href="/video/7300000000000000001"><img alt="鸣潮 3.8 前瞻直播总结"></a><span class="author-name">@库洛游戏</span></li>
      <li><a href="//www.douyin.com/video/7300000000000000002" aria-label="键圈老王：客制化键盘 打字音 #键盘"></a></li>
      <li><a href="/video/7300000000000000001"><img alt="同一条视频"></a></li>
      <li><a href="/video/7300000000000000003"><img></a></li>
      <li><a href="/user/MS4wabc">不是视频</a></li>
    </ul>`

  it('reads each video card once, with its title and author where the page gives them', () => {
    page(CARDS)
    const seen = douyin.douyinCards(60)
    expect(seen).toMatchObject({ links: 4, name: '小潮' })
    expect(douyin.toActivity('liked', seen.cards)).toEqual([
      { kind: 'liked', ref: '7300000000000000001', title: '鸣潮 3.8 前瞻直播总结', by: '库洛游戏' },
      { kind: 'liked', ref: '7300000000000000002', title: '客制化键盘 打字音 #键盘', by: '键圈老王' },
    ])
  })

  it('waits for cover text that arrives after the links', async () => {
    page('<li><a href="/video/7300000000000000009"><img></a></li>')
    let asked = 0
    const chrome = tools({
      inPage: (_tab, func, args = []) => {
        if (func === douyin.scrollOn) return null
        if (++asked === 3) globalThis.document.querySelector('img').setAttribute('alt', '库洛游戏：鸣潮 3.8 前瞻')
        return func(...args)
      },
    })
    chrome.tools.until = async (ask) => {
      for (let turn = 0; turn < 10; turn++) if (await ask()) return true
      return false
    }
    const found = await douyin.read(chrome.tools)
    expect(found.items[0]).toEqual({ kind: 'liked', ref: '7300000000000000009', title: '鸣潮 3.8 前瞻', by: '库洛游戏' })
  })

  it('reads the liked tab, then the favourites tab, and says what each showed', async () => {
    page(CARDS)
    const chrome = tools({ inPage: (_tab, func, args = []) => (func === douyin.scrollOn ? null : func(...args)) })
    const found = await douyin.read(chrome.tools)
    expect(chrome.visited).toEqual(['https://www.douyin.com/user/self?showTab=like', 'https://www.douyin.com/user/self?showTab=favorite_collection', 'closed'])
    expect(found.account).toBe('小潮')
    expect(found.items.map((item) => item.kind)).toEqual(['liked', 'liked', 'saved', 'saved'])
    expect(found.detail).toBe('like: 4 links, 2 titled, "主页 - 测试", untitled li>a>img; favorite_collection: 4 links, 2 titled, "主页 - 测试", untitled li>a>img')
  })

  it('reports cards it could not put a title to', async () => {
    page('<li><a href="/video/7300000000000000009"><img alt=""><span title="x">12</span></a><p>3.2万</p></li>')
    const found = await douyin.read(tools({ inPage: (_tab, func, args = []) => (func === douyin.scrollOn ? null : func(...args)) }).tools)
    expect(found.problem).toBe('unreadable')
    expect(found.detail).toContain('like: 1 links, 0 titled, "主页 - 测试", untitled li>a>img[alt:0]>span[title:1](2)>p(4)')
  })
})

describe('tiktok', () => {
  const PROFILE = `
    <div data-e2e="nav-profile"><a href="/@ana.plays">Profile</a></div>
    <p data-e2e="liked-tab">Liked</p>
    <div data-e2e="user-post-item-list"><a href="/@ana.plays/video/7400000000000000001"><img alt="my own post"></a></div>
    <div data-e2e="user-liked-item-list">
      <div data-e2e="user-liked-item"><a href="https://www.tiktok.com/@gamexplain/video/7400000000000000002"><img alt="Kirby Air Riders first look"></a></div>
      <div data-e2e="user-liked-item"><a href="/@keeb/photo/7400000000000000003" title="Lubing switches"></a></div>
    </div>`

  it('finds the account, opens a tab and reads only that tab\'s list', () => {
    page(PROFILE)
    expect(tiktok.tiktokHandle()).toMatchObject({ handle: 'ana.plays', loginButton: false })
    expect(tiktok.tiktokTab('[data-e2e="liked-tab"], [data-e2e="user-liked-tab"]')).toBe(true)
    expect(tiktok.tiktokTab('[data-e2e="favorites-tab"]')).toBe(false)
    expect(tiktok.tiktokCards('[data-e2e="user-liked-item-list"]', 60)).toEqual({
      found: true,
      links: 2,
      cards: [
        { id: '7400000000000000002', title: 'Kirby Air Riders first look', by: 'gamexplain' },
        { id: '7400000000000000003', title: 'Lubing switches', by: 'keeb' },
      ],
    })
    expect(tiktok.tiktokCards('[data-e2e="user-favorites-item-list"]', 60)).toEqual({ found: false, cards: [], links: 0, marks: 'user-post-item-list user-liked-item-list', loose: 3 })
  })

  it('opens the videos part of the favourites and reads a list the page does not name', () => {
    page(`
      <p data-e2e="favorites-tab">Favorites</p>
      <p data-e2e="sub-tab-collections">Collections</p><p data-e2e="sub-tab-posts">Posts</p>
      <div data-e2e="user-liked-item-list"><a href="/@gamexplain/video/7400000000000000002"><img alt="still on the page"></a></div>
      <div><a href="/@keeb/video/7400000000000000004"><img alt="Lubing switches"></a></div>`)
    expect(tiktok.tiktokVideosTab()).toBe('sub-tab-posts')
    expect(tiktok.tiktokCards('[data-e2e="user-favorites-item-list"]', 60, true)).toEqual({
      found: true,
      links: 1,
      cards: [{ id: '7400000000000000004', title: 'Lubing switches', by: 'keeb' }],
    })
    page('<p data-e2e="sub-tab-collections">Collections</p><p data-e2e="sub-tab-sounds">Sounds</p>')
    expect(tiktok.tiktokVideosTab()).toBeNull()
    expect(tiktok.tiktokCards('[data-e2e="user-favorites-item-list"]', 60, true)).toEqual({ found: false, cards: [], links: 0, marks: 'sub-tab-collections sub-tab-sounds', loose: 0 })
  })

  it('goes from the home page to the profile and reads what its tabs show', async () => {
    page(PROFILE)
    const chrome = tools({ inPage: (_tab, func, args = []) => (func === tiktok.toEnd ? null : func(...args)) })
    const found = await tiktok.read(chrome.tools)
    expect(chrome.visited).toEqual(['https://www.tiktok.com/', 'https://www.tiktok.com/@ana.plays', 'closed'])
    expect(found.account).toBe('ana.plays')
    expect(found.items).toEqual([
      { kind: 'liked', ref: '7400000000000000002', title: 'Kirby Air Riders first look', by: 'gamexplain' },
      { kind: 'liked', ref: '7400000000000000003', title: 'Lubing switches', by: 'keeb' },
    ])
    expect(found.detail).toBe('liked: tab opened, list found, 2 links, 2 titled; saved: tab missing, list missing, 0 links, 0 titled')
  })

  it('tells a signed-out home page from one it does not recognise', async () => {
    page('<button data-e2e="top-login-button">Log in</button>')
    expect(await tiktok.read(tools({ inPage: (_tab, func, args = []) => func(...args) }).tools)).toEqual({ problem: 'signed_out' })
    page('<p>something else</p>')
    expect(await tiktok.read(tools({ inPage: (_tab, func, args = []) => func(...args) }).tools)).toEqual({ problem: 'unreadable', detail: 'no profile link on "主页 - 测试"' })
  })
})

