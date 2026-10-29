import { createHash, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../../config.js'
import { pool } from '../../db/pool.js'
import type { AuthUser } from './auth.types.js'

const COOKIE_NAME = 'opsflow_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

type UserRow = {
  id: string
  display_name: string
  email: string
  role: 'member' | 'admin'
  session_id: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function requestHasSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin
  const host = request.headers.host

  if (!origin || !host) {
    return false
  }

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

export async function requireSameOrigin(request: FastifyRequest, reply: FastifyReply) {
  if (!requestHasSameOrigin(request)) {
    return reply.code(403).send({ error: 'Request origin is not allowed' })
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE_NAME]

  if (!token) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  const result = await pool.query<UserRow>(
    `SELECT app_user.id, app_user.display_name, app_user.email,
            app_user.role, session.id AS session_id
     FROM auth_sessions AS session
     JOIN users AS app_user ON session.user_id = app_user.id
     WHERE session.token_hash = $1
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
       AND app_user.is_active = true
     LIMIT 1`,
    [hashToken(token)],
  )

  const row = result.rows[0]

  if (!row) {
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return reply.code(401).send({ error: 'Authentication required' })
  }

  request.authUser = {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    sessionId: row.session_id,
  } satisfies AuthUser
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUser) {
    return reply.code(401).send({ error: 'Authentication required' })
  }

  if (request.authUser.role !== 'admin') {
    return reply.code(403).send({ error: 'Administrator role required' })
  }
}

export async function authRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false })

  app.post<{ Body: { email: string; password: string } }>(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
          },
          required: ['email', 'password'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (!requestHasSameOrigin(request)) {
        return reply.code(403).send({ error: 'Request origin is not allowed' })
      }

      const email = request.body.email.trim().toLowerCase()
      const result = await pool.query<{
        id: string
        display_name: string
        email: string
        role: 'member' | 'admin'
        password_hash: string
        is_active: boolean
      }>(
        `SELECT id, display_name, email, role, password_hash, is_active
         FROM users
         WHERE lower(email) = $1`,
        [email],
      )
      const user = result.rows[0]

      // Do equivalent password-hash work for unknown users to reduce email enumeration by timing.
      const passwordMatches = user
        ? await argon2.verify(user.password_hash, request.body.password)
        : (await argon2.hash(request.body.password), false)

      if (!user || !user.is_active || !passwordMatches) {
        return reply.code(401).send({ error: 'Invalid email or password' })
      }

      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, hashToken(token), expiresAt],
      )

      reply.setCookie(COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        expires: expiresAt,
      })

      return reply.code(200).send({
        user: {
          id: user.id,
          displayName: user.display_name,
          email: user.email,
          role: user.role,
        },
      })
    },
  )

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: {
      id: request.authUser!.id,
      displayName: request.authUser!.displayName,
      email: request.authUser!.email,
      role: request.authUser!.role,
    },
  }))

  app.get('/api/v1/users', { preHandler: requireAuth }, async () => {
    const result = await pool.query(
      `SELECT id, display_name AS "displayName", email, role
       FROM users
       WHERE is_active = true
       ORDER BY display_name ASC, id ASC`,
    )

    return { users: result.rows }
  })

  app.post<{
    Body: { displayName: string; email: string; password: string; role: 'member' | 'admin' }
  }>(
    '/api/v1/users',
    {
      preHandler: [requireAuth, requireAdmin, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', minLength: 3, maxLength: 320 },
            password: { type: 'string', minLength: 16, maxLength: 1024 },
            role: { type: 'string', enum: ['member', 'admin'] },
          },
          required: ['displayName', 'email', 'password', 'role'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const passwordHash = await argon2.hash(request.body.password)

      try {
        const result = await pool.query(
          `INSERT INTO users (display_name, email, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, display_name AS "displayName", email, role`,
          [request.body.displayName.trim(), request.body.email.trim().toLowerCase(), passwordHash, request.body.role],
        )

        return reply.code(201).send({ user: result.rows[0] })
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'A user with this email already exists' })
        }

        throw error
      }
    },
  )

  app.patch<{
    Params: { id: string }
    Body: { role: 'member' | 'admin'; isActive: boolean }
  }>(
    '/api/v1/users/:id',
    {
      preHandler: [requireAuth, requireAdmin, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['member', 'admin'] },
            isActive: { type: 'boolean' },
          },
          required: ['role', 'isActive'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      if (request.params.id === request.authUser!.id && !request.body.isActive) {
        return reply.code(400).send({ error: 'You cannot deactivate your own account' })
      }

      const updated = await pool.query(
        `UPDATE users SET role = $2, is_active = $3, updated_at = now()
         WHERE id = $1
         RETURNING id, display_name AS "displayName", email, role, is_active AS "isActive"`,
        [request.params.id, request.body.role, request.body.isActive],
      )

      if (!updated.rows[0]) {
        return reply.code(404).send({ error: 'User not found' })
      }

      if (!request.body.isActive) {
        await pool.query(
          'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [request.params.id],
        )
      }

      return { user: updated.rows[0] }
    },
  )

  app.post('/api/v1/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    if (!requestHasSameOrigin(request)) {
      return reply.code(403).send({ error: 'Request origin is not allowed' })
    }

    await pool.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [request.authUser!.sessionId],
    )
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return reply.code(204).send()
  })
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
