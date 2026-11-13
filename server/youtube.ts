import { LoginLost, type Activity, type LoginState, type LoginStart, type Service } from './activity.ts'
import { Failure } from './errors.ts'
import { readText, request } from './http.ts'

interface Login {
  refreshToken: string
}

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'
const API = 'https://www.googleapis.com/youtube/v3'

const client = () => ({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '' })

/** Google answers a sign-in that is still waiting with an error status, so the body is read whatever the status. */
async function post<T>(url: string, fields: Record<string, string>): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
    timeoutMs: 20_000,
  })
  return JSON.parse(await readText(res)) as T
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await request(`${API}/${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, timeoutMs: 20_000 })
  if (res.status === 401) {
    await res.body?.cancel().catch(() => {})
    throw new LoginLost()
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  return JSON.parse(await readText(res)) as T
}

interface Granted {
  access_token?: string
  refresh_token?: string
  error?: string
  error_description?: string
}

/** Google's sign-in for devices: the reader types a short code at google.com/device, so Pulse needs no public address. */
async function startLogin(): Promise<LoginStart> {
  const started = await post<{
    device_code?: string
    user_code?: string
    verification_url?: string
    expires_in?: number
    interval?: number
    error?: string
    error_code?: string
    error_description?: string
  }>('https://oauth2.googleapis.com/device/code', { client_id: client().client_id, scope: SCOPE })
  // Only a client of the type made for devices may ask for a code; any other kind is turned away here.
  if (started.error === 'invalid_client') {
    throw new Failure(502, 'youtube_client', `Google turned the OAuth client away: ${started.error_description ?? 'it must be of type "TVs and Limited Input devices"'}`)
  }
  if (!started.device_code || !started.user_code) throw new Error(started.error_description ?? started.error ?? started.error_code ?? 'Google did not start the sign-in')
  return {
    key: started.device_code,
    code: started.user_code,
    url: started.verification_url ?? 'https://www.google.com/device',
    lasts: (started.expires_in ?? 1800) * 1000,
    every: (started.interval ?? 5) * 1000,
  }
}

async function checkLogin(key: string): Promise<LoginState> {
  const granted = await post<Granted>('https://oauth2.googleapis.com/token', {
    ...client(),
    device_code: key,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  })
  if (granted.error === 'authorization_pending' || granted.error === 'slow_down') return { state: 'waiting' }
  if (granted.error === 'access_denied' || granted.error === 'expired_token') return { state: 'expired' }
  if (!granted.access_token || !granted.refresh_token) throw new Error(granted.error_description ?? granted.error ?? 'Google did not complete the sign-in')
  const mine = await get<{ items?: { snippet?: { title?: string } }[] }>('channels?part=snippet&mine=true', granted.access_token)
  return { state: 'connected', account: mine.items?.[0]?.snippet?.title || 'YouTube', credentials: { refreshToken: granted.refresh_token } satisfies Login }
}

export interface LikedVideo {
  id?: string
  snippet?: { title?: string; channelTitle?: string }
}

export interface Subscription {
  snippet?: { title?: string; resourceId?: { channelId?: string } }
}

export function liked(item: LikedVideo): Activity | null {
  const title = item.snippet?.title?.trim()
  return item.id && title ? { kind: 'liked', ref: item.id, title, by: item.snippet?.channelTitle?.trim() || null } : null
}

export function subscribed(item: Subscription): Activity | null {
  const title = item.snippet?.title?.trim()
  const channel = item.snippet?.resourceId?.channelId
  return channel && title ? { kind: 'followed', ref: channel, title, by: null } : null
}

/** The account's newest liked videos and the channels it is subscribed to. The API does not give out watch history. */
async function activity({ refreshToken }: Login): Promise<Activity[]> {
  const granted = await post<Granted>('https://oauth2.googleapis.com/token', { ...client(), refresh_token: refreshToken, grant_type: 'refresh_token' })
  if (granted.error === 'invalid_grant') throw new LoginLost()
  if (!granted.access_token) throw new Error(granted.error_description ?? granted.error ?? 'Google did not renew the sign-in')
  const likes = await get<{ items?: LikedVideo[] }>('videos?part=snippet&myRating=like&maxResults=50', granted.access_token)
  const channels = await get<{ items?: Subscription[] }>('subscriptions?part=snippet&mine=true&order=relevance&maxResults=50', granted.access_token)
  return [...(likes.items ?? []).flatMap((item) => liked(item) ?? []), ...(channels.items ?? []).flatMap((item) => subscribed(item) ?? [])]
}

export const youtube: Service = {
  name: 'YouTube',
  available: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  startLogin,
  checkLogin,
  activity,
}
