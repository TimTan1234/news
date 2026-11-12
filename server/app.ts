import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { authRoutes } from './auth.ts'
import type { DB } from './db.ts'
import { Failure } from './errors.ts'
import { articleRoutes } from './routes/articles.ts'
import { insightRoutes } from './routes/insights.ts'
import { libraryRoutes } from './routes/library.ts'

interface AppOptions {
  logger?: boolean
  clientDir?: string
}

export function buildApp(db: DB, { logger = false, clientDir = resolve('dist') }: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger, trustProxy: true })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ error: error.message, code: error.code })
    app.log.error(error)
    const status = (error as { statusCode?: number }).statusCode ?? 500
    return reply.code(status).send({ error: status < 500 && error instanceof Error ? error.message : 'Something went wrong', code: 'server_error' })
  })

  authRoutes(app, db)
  articleRoutes(app, db)
  libraryRoutes(app, db)
  insightRoutes(app, db)

  if (existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir })
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found', code: 'not_found' }) : reply.sendFile('index.html'),
    )
  }
  return app
}
