import { LoginLost, type ActivityKind, type LoginStart, type Service } from './activity.ts'
import { bilibili } from './bilibili.ts'
import type { DB } from './db.ts'
import { Failure } from './errors.ts'
import { youtube } from './youtube.ts'

const SERVICES = { bilibili, youtube } satisfies Record<string, Service>
export type Platform = keyof typeof SERVICES

/** Accounts read in the reader's own browser by the Pulse extension, which sends what it finds there. */
const BROWSER_READ = { xiaohongshu: 'Xiaohongshu', douyin: 'Douyin', zhihu: 'Zhihu', tiktok: 'TikTok', instagram: 'Instagram' } as const
type BrowserPlatform = keyof typeof BROWSER_READ

const KINDS: ActivityKind[] = ['watched', 'liked', 'saved', 'followed']
const nameOf = (platform: string) => SERVICES[platform as Platform]?.name ?? BROWSER_READ[platform as BrowserPlatform] ?? platform

const SYNC_EVERY = 12 * 60 * 60 * 1000

export function asPlatform(value: string): Platform {
  if (!Object.hasOwn(SERVICES, value) || !SERVICES[value as Platform].available()) throw new Failure(404, 'account_unavailable', 'That account cannot be connected here')
  return value as Platform
}

export interface Account {
  platform: Platform | BrowserPlatform
  name: string
  /** Whether Pulse signs in to it itself, or the reader's browser extension reads it. */
  via: 'login' | 'extension'
  connected: boolean
  account: string | null
  syncedAt: number | null
  problem: string | null
  /** How much of each kind of activity the last read brought in. */
  activity: Partial<Record<ActivityKind, number>>
}

/** Every account that can be connected here, with the state of the reader's own connection to it. */
export function listAccounts(db: DB, userId: number): Account[] {
  const rows = db.prepare('SELECT platform, account, synced_at, problem FROM connections WHERE user_id = ?').all(userId) as {
    platform: Platform | BrowserPlatform
    account: string
    synced_at: number | null
    problem: string | null
  }[]
  const counts = db.prepare('SELECT platform, kind, COUNT(*) AS n FROM outside_activity WHERE user_id = ? GROUP BY platform, kind').all(userId) as {
    platform: string
    kind: ActivityKind
    n: number
  }[]
  const listed = [
    ...(Object.keys(SERVICES) as Platform[]).filter((platform) => SERVICES[platform].available()),
    ...(Object.keys(BROWSER_READ) as BrowserPlatform[]).filter((platform) => rows.some((row) => row.platform === platform)),
  ]
  return listed.map((platform) => {
      const row = rows.find((candidate) => candidate.platform === platform)
      return {
        platform,
        name: nameOf(platform),
        via: platform in SERVICES ? ('login' as const) : ('extension' as const),
        connected: Boolean(row),
        account: row?.account ?? null,
        syncedAt: row?.synced_at ?? null,
        problem: row?.problem ?? null,
        activity: Object.fromEntries(counts.filter((count) => count.platform === platform).map((count) => [count.kind, count.n])),
      }
    })
}

/** Sign-ins under way, by account and platform. The key that redeems one stays on the server. */
const pending = new Map<string, { key: string; until: number }>()

const unreachable = (platform: Platform, error: unknown) =>
  new Failure(502, 'account_unreachable', `${SERVICES[platform].name} did not answer: ${error instanceof Error ? error.message : String(error)}`)

export async function startLogin(userId: number, platform: Platform, now = Date.now()): Promise<Omit<LoginStart, 'key'>> {
  try {
    const { key, ...shown } = await SERVICES[platform].startLogin()
    pending.set(`${userId}:${platform}`, { key, until: now + shown.lasts })
    return shown
  } catch (error) {
    if (error instanceof Failure) throw error
    throw unreachable(platform, error)
  }
}

/** Asks the platform whether the sign-in has landed; once it has, stores the login and reads the account's activity. */
export async function checkLogin(db: DB, userId: number, platform: Platform, now = Date.now()): Promise<'waiting' | 'expired' | 'connected'> {
  const slot = `${userId}:${platform}`
  const login = pending.get(slot)
  if (!login || now > login.until) {
    pending.delete(slot)
    return 'expired'
  }
  let result
  try {
    result = await SERVICES[platform].checkLogin(login.key)
  } catch (error) {
    throw unreachable(platform, error)
  }
  if (result.state === 'waiting') return 'waiting'
  pending.delete(slot)
  if (result.state === 'expired') return 'expired'
  db.prepare(
    `INSERT INTO connections (user_id, platform, account, credentials, connected_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, platform) DO UPDATE SET account = excluded.account, credentials = excluded.credentials,
       connected_at = excluded.connected_at, synced_at = NULL, problem = NULL`,
  ).run(userId, platform, result.account, JSON.stringify(result.credentials), now)
  await syncAccounts(db, userId, now)
  return 'connected'
}

/** A platform whose account this reader could have: one Pulse signs in to, or one the extension reads. */
export function asAccount(value: string): Platform | BrowserPlatform {
  return Object.hasOwn(BROWSER_READ, value) ? (value as BrowserPlatform) : asPlatform(value)
}

/**
 * Takes what the extension read from one of the reader's accounts and replaces what was stored for it.
 * Returns whether the account is new to Pulse. A read that found nothing changes nothing.
 */
export function storeActivity(db: DB, userId: number, platform: string, account: unknown, items: unknown, now = Date.now()): boolean {
  if (!Object.hasOwn(BROWSER_READ, platform)) throw new Failure(404, 'account_unavailable', 'That account cannot be connected here')
  const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '')
  const found = (Array.isArray(items) ? items : []).slice(0, 300).flatMap((item: Record<string, unknown>) => {
    const [kind, ref, title] = [item?.kind as ActivityKind, text(item?.ref, 100), text(item?.title, 200)]
    return KINDS.includes(kind) && ref && title ? [{ kind, ref, title, by: text(item.by, 100) || null }] : []
  })
  if (found.length === 0) throw new Failure(400, 'nothing_read', 'Nothing was read from that account')
  const known = Boolean(db.prepare('SELECT 1 FROM connections WHERE user_id = ? AND platform = ?').get(userId, platform))
  const add = db.prepare('INSERT OR IGNORE INTO outside_activity (user_id, platform, kind, ref, title, by) VALUES (?, ?, ?, ?, ?, ?)')
  db.transaction(() => {
    db.prepare(
      `INSERT INTO connections (user_id, platform, account, credentials, connected_at, synced_at) VALUES (?, ?, ?, '', ?, ?)
       ON CONFLICT (user_id, platform) DO UPDATE SET account = excluded.account, synced_at = excluded.synced_at, problem = NULL`,
    ).run(userId, platform, text(account, 100) || nameOf(platform), now, now)
    db.prepare('DELETE FROM outside_activity WHERE user_id = ? AND platform = ?').run(userId, platform)
    for (const item of found) add.run(userId, platform, item.kind, item.ref, item.title, item.by)
  })()
  return !known
}

export function removeAccount(db: DB, userId: number, platform: Platform | BrowserPlatform): void {
  pending.delete(`${userId}:${platform}`)
  db.transaction(() => {
    db.prepare('DELETE FROM connections WHERE user_id = ? AND platform = ?').run(userId, platform)
    db.prepare('DELETE FROM outside_activity WHERE user_id = ? AND platform = ?').run(userId, platform)
  })()
}

/**
 * Reads the activity of each connected account that was last read more than half a day ago and replaces what was stored for it.
 * Returns the code of a login the platform no longer accepts, if there is one; that account keeps what it had.
 */
export async function syncAccounts(db: DB, userId: number, now = Date.now()): Promise<string | null> {
  const due = db
    .prepare('SELECT platform, credentials FROM connections WHERE user_id = ? AND (synced_at IS NULL OR synced_at <= ?)')
    .all(userId, now - SYNC_EVERY) as { platform: Platform; credentials: string }[]
  const settle = db.prepare('UPDATE connections SET synced_at = ?, problem = ? WHERE user_id = ? AND platform = ?')
  const clear = db.prepare('DELETE FROM outside_activity WHERE user_id = ? AND platform = ?')
  const add = db.prepare('INSERT OR IGNORE INTO outside_activity (user_id, platform, kind, ref, title, by) VALUES (?, ?, ?, ?, ?, ?)')
  let lost: string | null = null
  for (const { platform, credentials } of due) {
    // Accounts the extension reads are brought up to date by the extension, not from here.
    const service: Service | undefined = SERVICES[platform]
    if (!service?.available()) continue
    try {
      const found = await service.activity(JSON.parse(credentials) as never)
      db.transaction(() => {
        clear.run(userId, platform)
        for (const item of found) add.run(userId, platform, item.kind, item.ref, item.title.slice(0, 200), item.by)
        settle.run(now, null, userId, platform)
      })()
    } catch (error) {
      const problem = error instanceof LoginLost ? `${platform}_login` : 'account_failed'
      settle.run(now, problem, userId, platform)
      if (error instanceof LoginLost) lost ??= problem
    }
  }
  return lost
}

export interface OutsideActivity {
  platform: string
  kind: ActivityKind
  title: string
  by: string | null
}

/** What the reader did on their connected accounts, newest first within each platform and kind. */
export function outsideActivity(db: DB, userId: number): OutsideActivity[] {
  const rows = db.prepare('SELECT platform, kind, title, by FROM outside_activity WHERE user_id = ? ORDER BY rowid').all(userId) as OutsideActivity[]
  return rows.map((row) => ({ ...row, platform: nameOf(row.platform) }))
}
