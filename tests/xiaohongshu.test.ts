import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPassword } from '../server/auth.ts'
import { openDb } from '../server/db.ts'

type Reply = { content: object[]; isError?: boolean }

const service = vi.hoisted(() => ({
  calls: [] as { name: string; arguments: unknown }[],
  replies: {} as Record<string, () => Reply>,
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() {}
    async close() {}
    async callTool(request: { name: string; arguments: unknown }) {
      service.calls.push(request)
      return service.replies[request.name]()
    }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: class {} }))

const text = (value: string, isError = false): Reply => ({ content: [{ type: 'text', text: value }], isError })
const signedIn = () => text('✅ 已登录\n用户名: 小潮\n\n你可以使用其他功能了。')
const signedOut = () => text('❌ 未登录\n\n请使用 get_login_qrcode 工具获取二维码进行登录。')
const called = () => service.calls.map((call) => call.name)

// The first note of a real `search_feeds` answer, with the token and user id replaced.
const NOTE = {
  xsecToken: 'ABtoken=',
  id: '6aee934a000000000302389e',
  modelType: 'note',
  noteCard: {
    type: 'normal',
    displayTitle: '决战鸣潮男角色深情隐忍之巅',
    user: { userId: 'u1', nickname: '弋夕', nickName: '弋夕', avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/a' },
    interactInfo: { liked: false, likedCount: '279', sharedCount: '13', commentCount: '64', collectedCount: '19', collected: false },
    cover: {
      width: 4096,
      height: 5461,
      url: '',
      fileId: '',
      urlPre: 'http://sns-webpic-qc.xhscdn.com/202611131027/425739d923b387a101ae45bd30dbe420/1040g0083278la1fun0fg5p0o5k6kcf8npi3s99g!nc_n_webp_prv_1',
      urlDefault: 'http://sns-webpic-qc.xhscdn.com/202611131027/506b7f6e930fc4158fc2287389dd6b6b/1040g0083278la1fun0fg5p0o5k6kcf8npi3s99g!nc_n_webp_mw_1',
      infoList: null,
    },
  },
  index: 0,
}

let xiaohongshu: typeof import('../server/xiaohongshu.ts')
let search: typeof import('../server/search.ts')

beforeEach(async () => {
  vi.resetModules()
  process.env.XHS_MCP_URL = 'http://xiaohongshu:18060/mcp'
  service.calls.length = 0
  service.replies = { check_login_status: signedIn }
  xiaohongshu = await import('../server/xiaohongshu.ts')
  search = await import('../server/search.ts')
})

const providers = () => search.availableProviders().map((provider) => provider.id)

describe('xiaohongshu login', () => {
  it('offers the search only once the service reports a login', async () => {
    expect(providers()).not.toContain('xiaohongshu')
    await xiaohongshu.findLogin()
    expect(xiaohongshu.connection()).toEqual({ configured: true, connected: true, account: '小潮', challenged: false })
    expect(providers()).toContain('xiaohongshu')
    await xiaohongshu.findLogin()
    expect(called()).toEqual(['check_login_status'])
  })

  it('stays out of the way when no service is configured', async () => {
    delete process.env.XHS_MCP_URL
    await xiaohongshu.findLogin()
    expect(await xiaohongshu.current()).toEqual({ configured: false, connected: false, account: null, challenged: false })
    expect(called()).toEqual([])
  })

  it('hands out a QR code and watches for the scan', async () => {
    service.replies = {
      check_login_status: signedOut,
      get_login_qrcode: () => ({ content: [{ type: 'text', text: '请用小红书 App 扫码登录' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] }),
    }
    expect((await xiaohongshu.current()).connected).toBe(false)
    expect(await xiaohongshu.startLogin()).toEqual({ image: 'data:image/png;base64,iVBORw0KGgo=', lasts: 240_000 })

    service.replies.check_login_status = signedIn
    expect((await xiaohongshu.current()).connected).toBe(true)
    await xiaohongshu.current()
    expect(called()).toEqual(['check_login_status', 'get_login_qrcode', 'check_login_status'])
  })

  it('gives up on a sign-in code the service never produces', async () => {
    const { ErrorCode, McpError } = await import('@modelcontextprotocol/sdk/types.js')
    service.replies.get_login_qrcode = () => {
      throw new McpError(ErrorCode.RequestTimeout, 'Request timed out')
    }
    await expect(xiaohongshu.startLogin()).rejects.toMatchObject({ code: 'xiaohongshu_failed' })
    service.replies.get_login_qrcode = () => {
      throw new TypeError('fetch failed')
    }
    await expect(xiaohongshu.startLogin()).rejects.toMatchObject({ code: 'xiaohongshu_unreachable' })
  })

  it('signs out', async () => {
    await xiaohongshu.findLogin()
    service.replies.delete_cookies = () => text('Cookies 已成功删除，登录状态已重置。')
    await xiaohongshu.disconnect()
    expect(xiaohongshu.connection()).toMatchObject({ connected: false, account: null })
    expect(providers()).not.toContain('xiaohongshu')
  })
})

describe('xiaohongshu search', () => {
  it('asks for the last week and maps each note', async () => {
    await xiaohongshu.findLogin()
    service.replies.search_feeds = () => text(JSON.stringify({ feeds: [NOTE, { ...NOTE, id: 'untitled', noteCard: { ...NOTE.noteCard, displayTitle: '' } }], count: 2 }))
    expect(await search.searchEntries('xiaohongshu', '鸣潮', 1_000)).toEqual([
      {
        url: 'https://www.xiaohongshu.com/explore/6aee934a000000000302389e?xsec_token=ABtoken%3D&xsec_source=pc_search',
        title: '决战鸣潮男角色深情隐忍之巅',
        excerpt: '279 赞，64 评论',
        image: 'https://sns-webpic-qc.xhscdn.com/202611131027/506b7f6e930fc4158fc2287389dd6b6b/1040g0083278la1fun0fg5p0o5k6kcf8npi3s99g!nc_n_webp_mw_1',
        author: '弋夕',
        publisher: '弋夕',
        publishedAt: 1_000,
      },
    ])
    expect(service.calls.at(-1)).toEqual({ name: 'search_feeds', arguments: { keyword: '鸣潮', filters: { publish_time: '一周内' } } })
  })

  it('does not search while signed out', async () => {
    service.replies.check_login_status = signedOut
    await xiaohongshu.findLogin()
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_login' })
    expect(called()).toEqual(['check_login_status'])
  })

  it('takes the connection down when a failed search turns out to be a lost login', async () => {
    await xiaohongshu.findLogin()
    service.replies.search_feeds = () => text('搜索Feeds失败: 等待搜索结果失败: context deadline exceeded', true)
    service.replies.check_login_status = signedOut
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_login' })
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_login' })
    expect(called()).toEqual(['check_login_status', 'search_feeds', 'check_login_status'])
    expect(providers()).not.toContain('xiaohongshu')
  })

  it('keeps the connection when a search fails with the login intact', async () => {
    await xiaohongshu.findLogin()
    service.replies.search_feeds = () => text('搜索Feeds失败: 没有捕获到 feeds 数据', true)
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_failed' })
    expect(xiaohongshu.connection().connected).toBe(true)
  })

  it('stops at a security check until someone connects again', async () => {
    await xiaohongshu.findLogin()
    service.replies.search_feeds = () => text('搜索Feeds失败: 小红书要求安全验证：当前会话被判定可疑，已重定向到安全验证页。', true)
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_check' })
    expect(xiaohongshu.connection()).toMatchObject({ connected: false, challenged: true })
    await expect(xiaohongshu.search('鸣潮')).rejects.toMatchObject({ code: 'xiaohongshu_login' })
    expect(called().filter((name) => name === 'search_feeds')).toHaveLength(1)

    service.replies.get_login_qrcode = () => text('你当前已处于登录状态')
    expect(await xiaohongshu.startLogin()).toBeNull()
    expect(xiaohongshu.connection()).toMatchObject({ connected: true, challenged: false })
  })

  it('runs a followed search once a day', () => {
    const day = 86_400_000
    expect(search.searchDue('search:xiaohongshu:鸣潮', null, day)).toBe(true)
    expect(search.searchDue('search:xiaohongshu:鸣潮', day, day + 3_600_000)).toBe(false)
    expect(search.searchDue('search:xiaohongshu:鸣潮', day, 2 * day)).toBe(true)
    expect(search.searchDue('search:youtube:kirby', day, day + 3_600_000)).toBe(false)
    expect(search.searchDue('search:news:kirby', day, day + 1)).toBe(true)
    expect(search.searchDue('https://example.com/feed', day, day + 1)).toBe(true)
  })
})

describe('connection routes', () => {
  it('reports, starts and ends the shared login for a signed-in account', async () => {
    const { buildApp } = await import('../server/app.ts')
    const db = openDb(':memory:')
    const password = hashPassword('correct horse')
    db.prepare(`INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', ?, 0), (2, 'ben', ?, 0)`).run(password, password)
    const app = buildApp(db)
    const signIn = async (username: string) => {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'correct horse' } })
      return { cookie: String(login.headers['set-cookie']).split(';')[0], admin: login.json().user.admin as boolean }
    }
    const [ana, ben] = [await signIn('ana'), await signIn('ben')]
    const cookie = ana.cookie
    const call = (method: 'GET' | 'POST' | 'DELETE', url: string, headers = { cookie }) => app.inject({ method, url, headers })

    expect((await call('GET', '/api/connections/xiaohongshu', { cookie: '' })).statusCode).toBe(401)
    expect([ana.admin, ben.admin]).toEqual([true, false])
    for (const [method, url] of [['GET', '/api/connections/xiaohongshu'], ['POST', '/api/connections/xiaohongshu/login'], ['DELETE', '/api/connections/xiaohongshu']] as const) {
      expect((await call(method, url, { cookie: ben.cookie })).json().code).toBe('admin_only')
    }
    process.env.ADMIN_USER = 'ben'
    expect((await call('GET', '/api/auth/me', { cookie: ben.cookie })).json().user.admin).toBe(true)
    expect((await call('GET', '/api/connections/xiaohongshu')).statusCode).toBe(403)
    delete process.env.ADMIN_USER
    expect((await call('GET', '/api/connections/xiaohongshu')).json()).toEqual({ configured: true, connected: true, account: '小潮', challenged: false })

    service.replies.get_login_qrcode = () => text('你当前已处于登录状态')
    expect((await call('POST', '/api/connections/xiaohongshu/login')).json()).toEqual({ code: null })

    service.replies.delete_cookies = () => text('删除 cookies 失败: permission denied', true)
    expect((await call('DELETE', '/api/connections/xiaohongshu')).json().code).toBe('xiaohongshu_failed')
    service.replies.delete_cookies = () => text('Cookies 已成功删除，登录状态已重置。')
    expect((await call('DELETE', '/api/connections/xiaohongshu')).json()).toEqual({ ok: true })
    expect((await call('GET', '/api/connections/xiaohongshu')).json()).toMatchObject({ connected: false })
  })
})
