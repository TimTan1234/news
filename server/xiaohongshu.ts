import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { Failure } from './errors.ts'

/** A note as the service lists it in search results. */
export interface Note {
  id?: string
  xsecToken?: string
  noteCard?: {
    displayTitle?: string
    user?: { nickname?: string; nickName?: string }
    interactInfo?: { likedCount?: string; commentCount?: string }
    cover?: { urlDefault?: string; urlPre?: string; url?: string }
  }
}

export interface Connection {
  configured: boolean
  connected: boolean
  account: string | null
  /** Xiaohongshu answered a search with its security check; searching waits until someone connects again. */
  challenged: boolean
}

export interface LoginCode {
  image: string
  /** How long the service waits for the scan, in milliseconds. */
  lasts: number
}

const SCAN_WAIT = 4 * 60_000
const STALE = 30 * 60_000

const endpoint = () => process.env.XHS_MCP_URL

let live = false
let account: string | null = null
let challenged = false
let checkedAt = 0
let scanUntil = 0

export const connection = (): Connection => ({ configured: Boolean(endpoint()), connected: live && !challenged, account, challenged })

const refused = (text: string) => new Failure(502, 'xiaohongshu_failed', `Xiaohongshu: ${text}`)

interface Answer {
  text: string
  image: string | null
  failed: boolean
}

async function tool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<Answer> {
  const url = endpoint()
  if (!url) throw new Failure(404, 'xiaohongshu_off', 'Xiaohongshu is not set up')
  const client = new Client({ name: 'pulse', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)))
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs })
    const content = (result.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[]
    const picture = content.find((part) => part.type === 'image')
    return {
      text: content.flatMap((part) => (part.type === 'text' ? (part.text ?? []) : [])).join('\n'),
      image: picture?.data ? `data:${picture.mimeType ?? 'image/png'};base64,${picture.data}` : null,
      failed: result.isError === true,
    }
  } catch (error) {
    // The service waits without limit for a page it does not recognise; the time allowed here is what ends the call.
    if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) throw refused(`${name} timed out`)
    throw new Failure(502, 'xiaohongshu_unreachable', 'The Xiaohongshu service did not answer')
  } finally {
    await client.close().catch(() => {})
  }
}

let queue: Promise<unknown> = Promise.resolve()

/** The service opens a browser on Xiaohongshu for every call, so calls run one at a time. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

async function check(): Promise<void> {
  const answer = await tool('check_login_status', {}, 60_000)
  if (answer.failed) throw refused(answer.text)
  live = answer.text.includes('已登录')
  account = live ? answer.text.match(/用户名: *(.+)/)?.[1].trim() || null : null
  checkedAt = Date.now()
  if (live) scanUntil = 0
}

/** Asks the service once for the login it holds; called at each refresh until it has answered. */
export async function findLogin(): Promise<void> {
  if (endpoint() && !checkedAt) await inTurn(check).catch(() => {})
}

/** The login as last seen. The service is asked again while a QR code is out, and when the last answer is half an hour old. */
export async function current(now = Date.now()): Promise<Connection> {
  if (endpoint() && (now < scanUntil || now - checkedAt > STALE)) await inTurn(check).catch(() => {})
  return connection()
}

/** A QR code to scan with the Xiaohongshu app, or null when the service is signed in already. */
export function startLogin(): Promise<LoginCode | null> {
  return inTurn(async () => {
    const answer = await tool('get_login_qrcode', {}, 30_000)
    if (answer.failed) throw refused(answer.text)
    challenged = false
    if (!answer.image) {
      await check()
      return null
    }
    scanUntil = Date.now() + SCAN_WAIT
    return { image: answer.image, lasts: SCAN_WAIT }
  })
}

export function disconnect(): Promise<void> {
  return inTurn(async () => {
    const answer = await tool('delete_cookies', {}, 30_000)
    if (answer.failed) throw refused(answer.text)
    live = false
    account = null
    challenged = false
    scanUntil = 0
    checkedAt = Date.now()
  })
}

const signedOut = () => new Failure(502, 'xiaohongshu_login', 'Xiaohongshu is signed out')

/**
 * Notes from the last week that match. A search that meets the login page or the security check
 * takes the connection down, and nothing is searched again until someone connects in Settings.
 */
export function search(keyword: string): Promise<Note[]> {
  return inTurn(async () => {
    if (!live || challenged) throw signedOut()
    const answer = await tool('search_feeds', { keyword, filters: { publish_time: '一周内' } }, 120_000)
    if (!answer.failed) return (JSON.parse(answer.text) as { feeds?: Note[] }).feeds ?? []

    if (answer.text.includes('安全验证')) {
      challenged = true
      throw new Failure(502, 'xiaohongshu_check', 'Xiaohongshu asked for a security check')
    }
    if (answer.text.includes('未登录')) live = false
    else await check().catch(() => {})
    throw live ? refused(answer.text) : signedOut()
  })
}
