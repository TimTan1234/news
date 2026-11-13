import type { FastifyInstance } from 'fastify'
import { asAccount, asPlatform, checkLogin, listAccounts, removeAccount, startLogin, storeActivity } from '../accounts.ts'
import { isAdmin, newPairingKey, pairingKey } from '../auth.ts'
import type { DB } from '../db.ts'
import { Failure } from '../errors.ts'
import { startRound } from '../recommend.ts'
import { current, disconnect, startLogin as startXiaohongshuLogin } from '../xiaohongshu.ts'
import { asLang } from './articles.ts'

export function connectionRoutes(app: FastifyInstance, db: DB): void {
  // The reader's own accounts elsewhere, which suggestions learn from.
  app.get('/api/accounts', (req) => listAccounts(db, req.userId))

  app.post<{ Params: { platform: string } }>('/api/accounts/:platform/login', (req) => startLogin(req.userId, asPlatform(req.params.platform)))

  app.post<{ Params: { platform: string }; Body: { lang?: string } }>('/api/accounts/:platform/login/check', async (req) => {
    const state = await checkLogin(db, req.userId, asPlatform(req.params.platform))
    // A new account changes what is known about the reader, so suggestions are found afresh.
    if (state === 'connected') startRound(db, req.userId, asLang(req.body?.lang), (error) => app.log.error(error))
    return { state }
  })

  app.delete<{ Params: { platform: string } }>('/api/accounts/:platform', (req) => {
    removeAccount(db, req.userId, asAccount(req.params.platform))
    return { ok: true }
  })

  // The browser extension: the reader copies a key from Settings into it, and it sends what it reads from their accounts.
  app.get('/api/extension/key', (req) => ({ key: pairingKey(db, req.userId) ?? null }))

  app.post('/api/extension/key', (req) => ({ key: newPairingKey(db, req.userId) }))

  app.get('/api/extension/status', (req) => ({
    username: db.prepare('SELECT username FROM users WHERE id = ?').pluck().get(req.userId) as string,
    accounts: listAccounts(db, req.userId).filter((account) => account.via === 'extension'),
  }))

  app.post<{ Body: { platform?: string; account?: string; items?: unknown; lang?: string } }>('/api/extension/activity', (req) => {
    const added = storeActivity(db, req.userId, String(req.body?.platform ?? ''), req.body?.account, req.body?.items)
    if (added) startRound(db, req.userId, asLang(req.body?.lang), (error) => app.log.error(error))
    return { ok: true }
  })

  // The Xiaohongshu login is one per instance and belongs to an account made for it, so only the admin sees, starts or ends it.
  const adminOnly = (userId: number) => {
    if (!isAdmin(db, userId)) throw new Failure(403, 'admin_only', 'Only the admin account can do that')
  }

  app.get('/api/connections/xiaohongshu', (req) => {
    adminOnly(req.userId)
    return current()
  })

  app.post('/api/connections/xiaohongshu/login', async (req) => {
    adminOnly(req.userId)
    return { code: await startXiaohongshuLogin() }
  })

  app.delete('/api/connections/xiaohongshu', async (req) => {
    adminOnly(req.userId)
    await disconnect()
    return { ok: true }
  })
}
