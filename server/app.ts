import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { AiError } from './ai.ts'
import type { DB } from './db.ts'
import { articleRoutes } from './routes/articles.ts'
import { insightRoutes } from './routes/insights.ts'
import { libraryRoutes } from './routes/library.ts'

export function buildApp(db: DB, { logger = false, clientDir = resolve('dist') } = {}): FastifyInstance {
  const app = Fastify({ logger })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AiError) return reply.code(502).send({ error: error.message })
    app.log.error(error)
    const status = (error as { statusCode?: number }).statusCode ?? 500
    return reply.code(status).send({ error: status < 500 && error instanceof Error ? error.message : 'Something went wrong' })
  })

  articleRoutes(app, db)
  libraryRoutes(app, db)
  insightRoutes(app, db)

  if (existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir })
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
    )
  }
  return app
}
