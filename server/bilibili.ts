import QRCode from 'qrcode'
import { LoginLost, type Activity, type LoginState, type LoginStart, type Service } from './activity.ts'
import { BROWSER, readText, request } from './http.ts'

interface Login {
  cookie: string
  mid: string
}

interface Envelope<T> {
  code: number
  message?: string
  data: T
}

async function call<T>(url: string, cookie?: string): Promise<{ body: Envelope<T>; cookies: string[] }> {
  const res = await request(url, {
    headers: { 'user-agent': BROWSER, referer: 'https://www.bilibili.com/', ...(cookie ? { cookie } : {}) },
    timeoutMs: 20_000,
  })
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  return { body: JSON.parse(await readText(res)) as Envelope<T>, cookies: res.headers.getSetCookie() }
}

async function signedIn<T>(url: string, cookie: string): Promise<T> {
  const { body } = await call<T>(url, cookie)
  if (body.code === -101) throw new LoginLost()
  if (body.code !== 0) throw new Error(body.message || `Bilibili code ${body.code}`)
  return body.data
}

const QR_LASTS = 180_000
const NOT_SCANNED = 86101
const NOT_CONFIRMED = 86090

async function startLogin(): Promise<LoginStart> {
  const { body } = await call<{ url: string; qrcode_key: string }>('https://passport.bilibili.com/x/passport-login/web/qrcode/generate')
  if (body.code !== 0) throw new Error(body.message || `Bilibili code ${body.code}`)
  return { key: body.data.qrcode_key, image: await QRCode.toDataURL(body.data.url, { margin: 1, width: 200 }), lasts: QR_LASTS, every: 2000 }
}

async function checkLogin(key: string): Promise<LoginState> {
  const { body, cookies } = await call<{ code: number }>(`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`)
  const scan = body.data?.code
  if (scan === NOT_SCANNED || scan === NOT_CONFIRMED) return { state: 'waiting' }
  if (scan !== 0) return { state: 'expired' }
  const cookie = cookies.map((item) => item.split(';')[0]).join('; ')
  const me = await signedIn<{ uname?: string; mid: number }>('https://api.bilibili.com/x/web-interface/nav', cookie)
  return { state: 'connected', account: me.uname || String(me.mid), credentials: { cookie, mid: String(me.mid) } satisfies Login }
}

export interface HistoryItem {
  title?: string
  author_name?: string
  /** Seconds watched; -1 once the video was played to the end. */
  progress?: number
  duration?: number
  history?: { bvid?: string; business?: string }
}

/** A video counts as watched once it was finished, or played for a minute or half its length. */
export function watched(item: HistoryItem): Activity | null {
  const title = item.title?.trim()
  const played = item.progress ?? 0
  if (!title || !item.history?.bvid || item.history.business !== 'archive') return null
  if (played !== -1 && played < 60 && played < (item.duration ?? Infinity) / 2) return null
  return { kind: 'watched', ref: item.history.bvid, title, by: item.author_name?.trim() || null }
}

interface Video {
  title?: string
  bvid?: string
  /** Set on a favourite whose video has since been removed. */
  attr?: number
  upper?: { name?: string }
  owner?: { name?: string }
}

function video(kind: 'liked' | 'saved', item: Video): Activity | null {
  const title = item.title?.trim()
  if (!title || !item.bvid || item.attr) return null
  return { kind, ref: item.bvid, title, by: (item.upper?.name ?? item.owner?.name)?.trim() || null }
}

interface HistoryPage {
  cursor?: { max: number; view_at: number; business: string }
  list?: HistoryItem[]
}

const HISTORY = 'https://api.bilibili.com/x/web-interface/history/cursor?type=archive&ps=30'

async function history(cookie: string): Promise<Activity[]> {
  const first = await signedIn<HistoryPage>(HISTORY, cookie)
  const items = first.list ?? []
  if (items.length === 30 && first.cursor) {
    const { max, view_at, business } = first.cursor
    items.push(...((await signedIn<HistoryPage>(`${HISTORY}&max=${max}&view_at=${view_at}&business=${business}`, cookie)).list ?? []))
  }
  return items.flatMap((item) => watched(item) ?? [])
}

/** The newest videos in the account's default favourites folder, which is the first one listed. */
async function favourites({ cookie, mid }: Login): Promise<Activity[]> {
  const folders = await signedIn<{ list?: { id: number }[] } | null>(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`, cookie)
  const folder = folders?.list?.[0]
  if (!folder) return []
  const page = await signedIn<{ medias?: Video[] | null }>(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folder.id}&ps=20&order=mtime&platform=web`, cookie)
  return (page.medias ?? []).flatMap((item) => video('saved', item) ?? [])
}

async function likes({ cookie, mid }: Login): Promise<Activity[]> {
  const data = await signedIn<Video[] | { list?: Video[] } | null>(`https://api.bilibili.com/x/space/like/video?vmid=${mid}`, cookie)
  return (Array.isArray(data) ? data : (data?.list ?? [])).flatMap((item) => video('liked', item) ?? [])
}

/** The creators the account follows, the ones it visits most first. */
async function follows({ cookie, mid }: Login): Promise<Activity[]> {
  const data = await signedIn<{ list?: { mid: number; uname?: string }[] }>(`https://api.bilibili.com/x/relation/followings?vmid=${mid}&ps=50&order_type=attention`, cookie)
  return (data.list ?? []).flatMap((item) => (item.uname ? [{ kind: 'followed' as const, ref: String(item.mid), title: item.uname, by: null }] : []))
}

/** Reads each list in turn. One that will not load is left out; the login being refused, or nothing loading at all, is an error. */
async function activity(login: Login): Promise<Activity[]> {
  const found: Activity[] = []
  let failure: unknown
  for (const read of [() => history(login.cookie), () => likes(login), () => favourites(login), () => follows(login)]) {
    try {
      found.push(...(await read()))
    } catch (error) {
      if (error instanceof LoginLost) throw error
      failure = error
    }
  }
  if (found.length === 0 && failure) throw failure
  return found
}

export const bilibili: Service = { name: 'Bilibili', available: () => true, startLogin, checkLogin, activity }
