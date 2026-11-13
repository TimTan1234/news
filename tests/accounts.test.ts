import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkLogin, listAccounts, outsideActivity, removeAccount, startLogin, storeActivity, syncAccounts } from '../server/accounts.ts'
import { hasClaude, proposeInterests } from '../server/ai.ts'
import { buildApp } from '../server/app.ts'
import { hashPassword } from '../server/auth.ts'
import { watched } from '../server/bilibili.ts'
import { openDb, type DB } from '../server/db.ts'
import { runRound } from '../server/recommend.ts'

vi.mock('../server/search.ts', async (original) => ({
  ...(await original<typeof import('../server/search.ts')>()),
  searchInto: vi.fn(async () => []),
  discoveryProviders: vi.fn(() => [{ id: 'news', name: 'News', perRound: undefined }]),
}))
vi.mock('../server/ai.ts', async (original) => ({
  ...(await original<typeof import('../server/ai.ts')>()),
  hasClaude: vi.fn(() => false),
  proposeInterests: vi.fn(async () => []),
  explain: vi.fn(async () => new Map()),
}))
vi.mock('../server/feeds.ts', async (original) => ({
  ...(await original<typeof import('../server/feeds.ts')>()),
  fillMissingImages: vi.fn(async () => {}),
}))
vi.mock('../server/decisions.ts', () => ({ hasDecisions: vi.fn(() => false), scoreRelevance: vi.fn(async () => new Map()) }))

const NOW = Date.UTC(2026, 10, 13)
const HOUR = 3_600_000

/** Stands in for the platforms: the first route whose address fragment matches answers the request. */
let routes: [string, (url: string, init: RequestInit) => Response][]
const sent: { url: string; headers: Record<string, string>; body: string }[] = []
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers })
const ok = (data: unknown) => json({ code: 0, message: '0', data })

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
  db.prepare(`INSERT INTO users (id, username, password, created_at) VALUES (1, 'ana', ?, 0), (2, 'ben', ?, 0)`).run(hashPassword('correct horse'), 'x')
  db.exec(`INSERT INTO topics (id, user_id, name, slug, position) VALUES (1, 1, 'Games', 'games', 0)`)
  routes = []
  sent.length = 0
  process.env.GOOGLE_CLIENT_ID = 'client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    sent.push({ url, headers: (init.headers ?? {}) as Record<string, string>, body: String(init.body ?? '') })
    const route = routes.find(([fragment]) => url.includes(fragment))
    if (!route) throw new Error(`unexpected request to ${url}`)
    return route[1](url, init)
  })
  vi.mocked(hasClaude).mockReturnValue(false)
  vi.mocked(proposeInterests).mockClear()
})

const video = (bvid: string, title: string, over: object = {}) => ({ title, author_name: '库洛游戏', progress: -1, duration: 300, history: { bvid, business: 'archive' }, ...over })

const BILIBILI: typeof routes = [
  ['qrcode/generate', () => ok({ url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=k1', qrcode_key: 'k1' })],
  ['web-interface/nav', () => ok({ isLogin: true, uname: '漂泊者', mid: 42 })],
  [
    'history/cursor',
    () =>
      ok({
        cursor: { max: 9, view_at: 1, business: 'archive' },
        list: [
          video('BV1', '鸣潮 3.8 版本前瞻'),
          video('BV2', '鸣潮 莉莉 配队攻略', { progress: 200 }),
          video('BV3', '点开就关掉的视频', { progress: 4 }),
          video('BV4', '一场直播', { history: { business: 'live' } }),
        ],
      }),
  ],
  ['space/like/video', () => ok({ list: [{ title: '鸣潮 深塔满星', bvid: 'BV5', owner: { name: '深塔研究所' } }] })],
  ['fav/folder/created/list-all', () => ok({ list: [{ id: 7001 }, { id: 7002 }] })],
  ['fav/resource/list', () => ok({ medias: [{ title: '机械键盘入门', bvid: 'BV6', attr: 0, upper: { name: '键圈老王' } }, { title: '已失效视频', bvid: 'BV7', attr: 9 }] })],
  ['relation/followings', () => ok({ list: [{ mid: 100, uname: '库洛游戏' }, { mid: 101, uname: '键圈老王' }] })],
]

const scanned = (): (typeof routes)[number] => [
  'qrcode/poll',
  () => json({ code: 0, data: { code: 0 } }, 200, [
    ['set-cookie', 'SESSDATA=abc; Path=/; HttpOnly'],
    ['set-cookie', 'bili_jct=def; Path=/'],
    ['set-cookie', 'DedeUserID=42; Path=/'],
  ]),
]

async function connectBilibili() {
  routes = [scanned(), ...BILIBILI]
  await startLogin(1, 'bilibili', NOW)
  return checkLogin(db, 1, 'bilibili', NOW)
}

describe('bilibili account', () => {
  it('counts a video as watched once it was finished or played for a while', () => {
    expect(watched(video('BV1', 'a'))).toEqual({ kind: 'watched', ref: 'BV1', title: 'a', by: '库洛游戏' })
    expect(watched(video('BV1', 'a', { progress: 70, duration: 3000 }))).not.toBeNull()
    expect(watched(video('BV1', 'a', { progress: 20, duration: 30 }))).not.toBeNull()
    expect(watched(video('BV1', 'a', { progress: 20, duration: 3000 }))).toBeNull()
    expect(watched(video('BV1', '', {}))).toBeNull()
  })

  it('waits for the scan, then stores the login and reads the account', async () => {
    routes = [['qrcode/poll', () => ok({ code: 86101 })], ...BILIBILI]
    const shown = await startLogin(1, 'bilibili', NOW)
    expect(shown).toMatchObject({ lasts: 180_000, every: 2000 })
    expect(shown.image).toMatch(/^data:image\/png;base64,/)
    expect(shown).not.toHaveProperty('key')
    expect(await checkLogin(db, 1, 'bilibili', NOW)).toBe('waiting')
    routes[0] = ['qrcode/poll', () => ok({ code: 86090 })]
    expect(await checkLogin(db, 1, 'bilibili', NOW)).toBe('waiting')

    routes[0] = scanned()
    expect(await checkLogin(db, 1, 'bilibili', NOW)).toBe('connected')
    expect(sent.find((request) => request.url.includes('history/cursor'))?.headers.cookie).toBe('SESSDATA=abc; bili_jct=def; DedeUserID=42')
    expect(sent.find((request) => request.url.includes('fav/resource/list'))?.url).toContain('media_id=7001')
    expect(listAccounts(db, 1).find((account) => account.platform === 'bilibili')).toEqual({
      platform: 'bilibili',
      name: 'Bilibili',
      via: 'login',
      connected: true,
      account: '漂泊者',
      syncedAt: NOW,
      problem: null,
      activity: { watched: 2, liked: 1, saved: 1, followed: 2 },
    })
    expect(outsideActivity(db, 1)[0]).toEqual({ platform: 'Bilibili', kind: 'watched', title: '鸣潮 3.8 版本前瞻', by: '库洛游戏' })
    expect(listAccounts(db, 2)[0]).toMatchObject({ connected: false, activity: {} })
    expect(await checkLogin(db, 1, 'bilibili', NOW)).toBe('expired')
  })

  it('gives up on a code nobody scanned', async () => {
    routes = [['qrcode/poll', () => ok({ code: 86038 })], ...BILIBILI]
    await startLogin(1, 'bilibili', NOW)
    expect(await checkLogin(db, 1, 'bilibili', NOW)).toBe('expired')
    await startLogin(1, 'bilibili', NOW)
    expect(await checkLogin(db, 1, 'bilibili', NOW + 181_000)).toBe('expired')
    expect(listAccounts(db, 1)[0].connected).toBe(false)
  })

  it('reads again after half a day and keeps what it had when the login is refused', async () => {
    await connectBilibili()
    const reads = () => sent.filter((request) => request.url.includes('history/cursor')).length
    await syncAccounts(db, 1, NOW + HOUR)
    expect(reads()).toBe(1)

    routes = [['api.bilibili.com', () => json({ code: -101, message: '账号未登录' })]]
    expect(await syncAccounts(db, 1, NOW + 13 * HOUR)).toBe('bilibili_login')
    expect(listAccounts(db, 1)[0]).toMatchObject({ connected: true, problem: 'bilibili_login', activity: { watched: 2 } })
  })

  it('leaves out a list that does not load', async () => {
    routes = [scanned(), ['space/like/video', () => json({ code: 53013, message: '用户隐私设置未公开', data: null })], ...BILIBILI]
    await startLogin(1, 'bilibili', NOW)
    await checkLogin(db, 1, 'bilibili', NOW)
    expect(listAccounts(db, 1)[0]).toMatchObject({ problem: null, activity: { watched: 2, saved: 1, followed: 2 } })
  })

  it('forgets the login and what was read when disconnected', async () => {
    await connectBilibili()
    removeAccount(db, 1, 'bilibili')
    expect(listAccounts(db, 1)[0]).toMatchObject({ connected: false, account: null, activity: {} })
    expect(outsideActivity(db, 1)).toEqual([])
  })
})

describe('youtube account', () => {
  const GOOGLE: typeof routes = [
    ['device/code', () => json({ device_code: 'dev-1', user_code: 'GQVQ-JKEC', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 })],
    ['channels?', () => json({ items: [{ snippet: { title: 'Ana Plays' } }] })],
    ['videos?', () => json({ items: [{ id: 'v1', snippet: { title: 'Kirby Air Riders review', channelTitle: 'GameXplain' } }, { id: 'v2', snippet: {} }] })],
    ['subscriptions?', () => json({ items: [{ snippet: { title: 'GameXplain', resourceId: { channelId: 'UC1' } } }] })],
  ]
  const token = (answer: object, status = 200): (typeof routes)[number] => ['oauth2.googleapis.com/token', () => json(answer, status)]

  it('is offered only when a Google client is configured', () => {
    expect(listAccounts(db, 1).map((account) => account.platform)).toEqual(['bilibili', 'youtube'])
    delete process.env.GOOGLE_CLIENT_SECRET
    expect(listAccounts(db, 1).map((account) => account.platform)).toEqual(['bilibili'])
  })

  it('shows a code, waits for it to be entered, then reads likes and subscriptions', async () => {
    routes = [token({ error: 'authorization_pending' }, 428), ...GOOGLE]
    expect(await startLogin(1, 'youtube', NOW)).toEqual({ code: 'GQVQ-JKEC', url: 'https://www.google.com/device', lasts: 1_800_000, every: 5000 })
    expect(sent[0].body).toBe('client_id=client-id&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly')
    expect(await checkLogin(db, 1, 'youtube', NOW)).toBe('waiting')
    routes[0] = token({ error: 'slow_down' }, 403)
    expect(await checkLogin(db, 1, 'youtube', NOW)).toBe('waiting')

    routes[0] = token({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 })
    expect(await checkLogin(db, 1, 'youtube', NOW)).toBe('connected')
    expect(sent.at(-1)?.headers.authorization).toBe('Bearer at')
    expect(sent.some((request) => request.body.includes('grant_type=refresh_token') && request.body.includes('refresh_token=rt'))).toBe(true)
    expect(listAccounts(db, 1)[1]).toMatchObject({ connected: true, account: 'Ana Plays', problem: null, activity: { liked: 1, followed: 1 } })
    expect(outsideActivity(db, 1)).toEqual([
      { platform: 'YouTube', kind: 'liked', title: 'Kirby Air Riders review', by: 'GameXplain' },
      { platform: 'YouTube', kind: 'followed', title: 'GameXplain', by: null },
    ])
  })

  it('says so when the Google client is of a kind that cannot ask for a code', async () => {
    routes = [['device/code', () => json({ error: 'invalid_client', error_description: 'Invalid client type.' }, 401)]]
    await expect(startLogin(1, 'youtube', NOW)).rejects.toMatchObject({ code: 'youtube_client', message: 'Google turned the OAuth client away: Invalid client type.' })
  })

  it('treats a declined or lapsed code as over, and a revoked grant as signed out', async () => {
    routes = [token({ error: 'access_denied' }, 403), ...GOOGLE]
    await startLogin(1, 'youtube', NOW)
    expect(await checkLogin(db, 1, 'youtube', NOW)).toBe('expired')

    routes[0] = token({ access_token: 'at', refresh_token: 'rt' })
    await startLogin(1, 'youtube', NOW)
    await checkLogin(db, 1, 'youtube', NOW)
    routes[0] = token({ error: 'invalid_grant' }, 400)
    expect(await syncAccounts(db, 1, NOW + 13 * HOUR)).toBe('youtube_login')
    expect(listAccounts(db, 1)[1]).toMatchObject({ problem: 'youtube_login', activity: { liked: 1 } })
  })
})

describe('learning from connected accounts', () => {
  it('finds a new account its first interests in what it watched elsewhere', async () => {
    await connectBilibili()
    await runRound(db, 1, 'zh', NOW)
    const labels = db.prepare('SELECT label FROM interests WHERE user_id = 1').pluck().all()
    expect(labels).toContain('鸣潮')
    expect(labels).not.toContain('Games')
  })

  it('lets the topic names an account started from make way for what it learns', async () => {
    await runRound(db, 1, 'zh', NOW)
    expect(db.prepare(`SELECT label, state FROM interests WHERE user_id = 1`).all()).toEqual([{ label: 'Games', state: 'trial' }])
    await connectBilibili()
    vi.mocked(hasClaude).mockReturnValue(true)
    await runRound(db, 1, 'zh', NOW + HOUR)
    expect(db.prepare(`SELECT state FROM interests WHERE user_id = 1 AND label = 'Games'`).pluck().get()).toBe('archived')
    expect(vi.mocked(proposeInterests).mock.calls[0][1]).toEqual({ near: 3, explore: 3 })
    expect(vi.mocked(proposeInterests).mock.calls[0][0].declined).toContain('Games')
  })

  it('tells the model what was watched, liked, saved and followed, platform first', async () => {
    await connectBilibili()
    vi.mocked(hasClaude).mockReturnValue(true)
    await runRound(db, 1, 'zh', NOW)
    expect(vi.mocked(proposeInterests).mock.calls[0][0].elsewhere).toEqual({
      watched: ['Bilibili | 库洛游戏 | 鸣潮 3.8 版本前瞻', 'Bilibili | 库洛游戏 | 鸣潮 莉莉 配队攻略'],
      liked: ['Bilibili | 深塔研究所 | 鸣潮 深塔满星'],
      saved: ['Bilibili | 键圈老王 | 机械键盘入门'],
      followed: ['Bilibili | 库洛游戏', 'Bilibili | 键圈老王'],
    })
  })

  it('gives every account a share of what the model is told', async () => {
    const likes = Array.from({ length: 45 }, (_, index) => ({ kind: 'liked', ref: `d${index}`, title: `抖音视频 ${index}`, by: '阿宅' }))
    storeActivity(db, 1, 'douyin', 'tan', likes, NOW)
    await connectBilibili()
    vi.mocked(hasClaude).mockReturnValue(true)
    await runRound(db, 1, 'zh', NOW)
    const liked = vi.mocked(proposeInterests).mock.calls[0][0].elsewhere.liked
    expect(liked).toHaveLength(40)
    expect(liked.slice(0, 2)).toEqual(['Douyin | 阿宅 | 抖音视频 0', 'Bilibili | 深塔研究所 | 鸣潮 深塔满星'])
  })

  it('reports a lost login as the round\'s problem and still learns', async () => {
    await connectBilibili()
    routes = [['api.bilibili.com', () => json({ code: -101 })]]
    const round = await runRound(db, 1, 'zh', NOW + 13 * HOUR)
    expect(round.problem).toBe('bilibili_login')
    expect(db.prepare('SELECT label FROM interests WHERE user_id = 1').pluck().all()).toContain('鸣潮')
  })
})

describe('account routes', () => {
  it('connect, list and disconnect for the signed-in reader only', async () => {
    db.prepare(`UPDATE users SET password = ? WHERE id = 2`).run(hashPassword('correct horse'))
    const app = buildApp(db)
    const cookieOf = async (username: string) =>
      String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'correct horse' } })).headers['set-cookie']).split(';')[0]
    const [ana, ben] = [await cookieOf('ana'), await cookieOf('ben')]
    const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) => app.inject({ method, url, payload, headers: { cookie } })

    routes = [scanned(), ...BILIBILI]
    expect((await call('GET', '/api/accounts', '')).statusCode).toBe(401)
    expect((await call('POST', '/api/accounts/instagram/login', ana)).json().code).toBe('account_unavailable')
    expect((await call('POST', '/api/accounts/bilibili/login', ana)).json()).not.toHaveProperty('key')
    expect((await call('POST', '/api/accounts/bilibili/login/check', ben, {})).json()).toEqual({ state: 'expired' })
    expect((await call('POST', '/api/accounts/bilibili/login/check', ana, { lang: 'zh' })).json()).toEqual({ state: 'connected' })
    expect((await call('GET', '/api/accounts', ana)).json()[0]).toMatchObject({ connected: true, account: '漂泊者' })
    expect((await call('GET', '/api/accounts', ben)).json()[0]).toMatchObject({ connected: false })
    await vi.waitFor(async () => expect((await call('GET', '/api/suggestions', ana)).json().running).toBe(false))
    expect((await call('DELETE', '/api/accounts/bilibili', ana)).json()).toEqual({ ok: true })
    expect((await call('GET', '/api/accounts', ana)).json()[0]).toMatchObject({ connected: false, activity: {} })
  })
})

describe('browser extension', () => {
  const NOTES = [
    { kind: 'saved', ref: 'n1', title: ' 客制化键盘入门 ', by: '老王' },
    { kind: 'liked', ref: 'n2', title: '鸣潮 3.8 前瞻', by: '库洛' },
    { kind: 'posted', ref: 'n3', title: 'x' },
    { kind: 'liked', ref: '', title: 'y' },
  ]

  it('pairs with a key from Settings and sends what it read for that reader', async () => {
    const app = buildApp(db)
    const cookie = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password: 'correct horse' } })).headers['set-cookie']).split(';')[0]
    const web = (method: 'GET' | 'POST' | 'DELETE', url: string) => app.inject({ method, url, headers: { cookie } })
    const extension = (method: 'GET' | 'POST', url: string, key: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${key}` } })

    expect((await web('GET', '/api/extension/key')).json()).toEqual({ key: null })
    const { key } = (await web('POST', '/api/extension/key')).json()
    expect(key).toMatch(/^[0-9a-f]{48}$/)
    expect((await web('GET', '/api/extension/key')).json()).toEqual({ key })

    expect((await extension('GET', '/api/extension/status', 'wrong')).json().code).toBe('key_rejected')
    expect((await extension('GET', '/api/accounts', key)).statusCode).toBe(401)
    expect((await extension('GET', '/api/extension/status', key)).json()).toEqual({ username: 'ana', accounts: [] })

    expect((await extension('POST', '/api/extension/activity', key, { platform: 'myspace', items: NOTES })).json().code).toBe('account_unavailable')
    expect((await extension('POST', '/api/extension/activity', key, { platform: 'xiaohongshu', items: [] })).json().code).toBe('nothing_read')
    expect((await extension('POST', '/api/extension/activity', key, { platform: 'xiaohongshu', account: '小潮', items: NOTES, lang: 'zh' })).json()).toEqual({ ok: true })
    await vi.waitFor(async () => expect((await web('GET', '/api/suggestions')).json().running).toBe(false))

    expect((await web('GET', '/api/accounts')).json().find((account: { platform: string }) => account.platform === 'xiaohongshu')).toMatchObject({
      name: 'Xiaohongshu',
      via: 'extension',
      connected: true,
      account: '小潮',
      problem: null,
      activity: { saved: 1, liked: 1 },
    })
    expect(outsideActivity(db, 1)).toEqual([
      { platform: 'Xiaohongshu', kind: 'saved', title: '客制化键盘入门', by: '老王' },
      { platform: 'Xiaohongshu', kind: 'liked', title: '鸣潮 3.8 前瞻', by: '库洛' },
    ])

    await extension('POST', '/api/extension/activity', key, { platform: 'xiaohongshu', account: '小潮', items: [NOTES[1]] })
    expect(outsideActivity(db, 1)).toHaveLength(1)
    expect((await web('DELETE', '/api/accounts/xiaohongshu')).json()).toEqual({ ok: true })
    expect((await web('GET', '/api/accounts')).json().map((account: { platform: string }) => account.platform)).toEqual(['bilibili', 'youtube'])

    const renewed = (await web('POST', '/api/extension/key')).json().key
    expect((await extension('GET', '/api/extension/status', key)).statusCode).toBe(401)
    expect((await extension('GET', '/api/extension/status', renewed)).statusCode).toBe(200)
  })
})

