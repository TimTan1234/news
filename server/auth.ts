import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DB } from './db.ts'
import { Failure } from './errors.ts'
import { seedUser } from './seed.ts'

declare module 'fastify' {
  interface FastifyRequest {
    userId: number
  }
}

const COOKIE = 'pulse_session'
const SESSION_DAYS = 30

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':').map((part) => Buffer.from(part, 'hex'))
  return timingSafeEqual(scryptSync(password, salt, hash.length), hash)
}

/** The account that looks after what the whole instance shares: the one named in ADMIN_USER, otherwise the first one created. */
export function isAdmin(db: DB, userId: number): boolean {
  const named = process.env.ADMIN_USER?.trim()
  const admin = named ? db.prepare('SELECT id FROM users WHERE username = ?').pluck().get(named) : db.prepare('SELECT MIN(id) FROM users').pluck().get()
  return admin === userId
}

/** The key a reader's browser extension presents in place of a session; it opens the extension's routes and nothing else. */
export const pairingKey = (db: DB, userId: number) => db.prepare('SELECT key FROM pairing_keys WHERE user_id = ?').pluck().get(userId) as string | undefined

export function newPairingKey(db: DB, userId: number): string {
  const key = randomBytes(24).toString('hex')
  db.prepare(
    `INSERT INTO pairing_keys (key, user_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET key = excluded.key, created_at = excluded.created_at`,
  ).run(key, userId, Date.now())
  return key
}

function sessionToken(req: FastifyRequest): string | undefined {
  for (const pair of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = pair.trim().split('=')
    if (name === COOKIE) return value
  }
  return undefined
}

function startSession(db: DB, req: FastifyRequest, reply: FastifyReply, userId: number): void {
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now())
  const secure = req.protocol === 'https' ? '; Secure' : ''
  reply.header('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`)
}

function credentials(body: { username?: unknown; password?: unknown } | undefined) {
  return {
    username: typeof body?.username === 'string' ? body.username.trim() : '',
    password: typeof body?.password === 'string' ? body.password : '',
  }
}

export function authRoutes(app: FastifyInstance, db: DB): void {
  app.decorateRequest('userId', 0)

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/auth/')) return
    const presented = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
    if (presented && req.url.startsWith('/api/extension/')) {
      const owner = db.prepare('SELECT user_id FROM pairing_keys WHERE key = ?').pluck().get(presented) as number | undefined
      if (!owner) throw new Failure(401, 'key_rejected', 'That pairing key is not valid')
      req.userId = owner
      return
    }
    const token = sessionToken(req)
    const session =
      token &&
      (db.prepare('SELECT user_id, created_at FROM sessions WHERE token = ?').get(token) as
        | { user_id: number; created_at: number }
        | undefined)
    if (!session || session.created_at < Date.now() - SESSION_DAYS * 86_400_000) {
      throw new Failure(401, 'signed_out', 'Sign in to continue')
    }
    req.userId = session.user_id
  })

  app.post<{ Body: { username?: string; password?: string; lang?: string } }>('/api/auth/register', (req, reply) => {
    const { username, password } = credentials(req.body)
    if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
      throw new Failure(400, 'username_invalid', 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores')
    }
    if (password.length < 8) throw new Failure(400, 'password_short', 'Passwords need at least 8 characters')
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new Failure(409, 'username_taken', 'That username is taken')
    }
    const id = Number(
      db.prepare('INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)').run(username, hashPassword(password), Date.now())
        .lastInsertRowid,
    )
    seedUser(db, id, req.body?.lang === 'zh' ? 'zh' : 'en')
    startSession(db, req, reply, id)
    return { user: { id, username, admin: isAdmin(db, id) } }
  })

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', (req, reply) => {
    const { username, password } = credentials(req.body)
    const user = db.prepare('SELECT id, username, password FROM users WHERE username = ?').get(username) as
      | { id: number; username: string; password: string }
      | undefined
    if (!user || !verifyPassword(password, user.password)) {
      throw new Failure(401, 'invalid_credentials', 'That username and password do not match')
    }
    startSession(db, req, reply, user.id)
    return { user: { id: user.id, username: user.username, admin: isAdmin(db, user.id) } }
  })

  app.post('/api/auth/logout', (req, reply) => {
    const token = sessionToken(req)
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return { ok: true }
  })

  app.get('/api/auth/me', (req) => {
    const token = sessionToken(req)
    const user =
      token &&
      (db
        .prepare(
          `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.created_at >= ?`,
        )
        .get(token, Date.now() - SESSION_DAYS * 86_400_000) as { id: number; username: string } | undefined)
    return { user: user ? { ...user, admin: isAdmin(db, user.id) } : null }
  })
}
