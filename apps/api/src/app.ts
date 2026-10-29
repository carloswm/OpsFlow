import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { pool } from './db/pool.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { incidentRoutes } from './modules/incidents/incidents.routes.js'

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-request-id',
  })

  app.decorateRequest('authUser', null)
  app.register(cookie)

  app.get('/health/live', async () => ({ status: 'alive' }))

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1')
      return { status: 'ready', dependencies: { database: 'ready' } }
    } catch {
      return reply.code(503).send({
        status: 'not_ready',
        dependencies: { database: 'unavailable' },
      })
    }
  })

  app.register(authRoutes)
  app.register(incidentRoutes)

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return app
}
