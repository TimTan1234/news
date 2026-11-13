import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from './app.ts'
import { openDb } from './db.ts'
import { refreshAll } from './feeds.ts'
import { findLogin } from './xiaohongshu.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const REFRESH_INTERVAL = 15 * 60 * 1000
const dataDir = process.env.DATA_DIR ?? 'data'
mkdirSync(dataDir, { recursive: true })

const db = openDb(join(dataDir, 'pulse.db'))

const app = buildApp(db, { logger: true })

const refresh = () => {
  void findLogin()
  return refreshAll(db).then(
    ({ added, failed }) => app.log.info({ added, failed }, 'feeds refreshed'),
    (error) => app.log.error(error, 'feed refresh failed'),
  )
}

await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' })
void refresh()
setInterval(refresh, REFRESH_INTERVAL)
