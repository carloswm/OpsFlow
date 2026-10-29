import type { PoolClient } from 'pg'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../../db/pool.js'
import { requireAdmin, requireAuth, requireSameOrigin } from '../auth/auth.routes.js'

const severities = ['P1', 'P2', 'P3', 'P4'] as const
const statuses = ['open', 'acknowledged', 'mitigating', 'resolved'] as const

type Severity = typeof severities[number]
type Status = typeof statuses[number]

type ListQuery = {
  status?: Status
  severity?: Severity
  serviceId?: string
  assigneeId?: string
  q?: string
  page: number
  pageSize: number
}

type CreateIncidentBody = {
  title: string
  description: string
  serviceId: string
  severity: Severity
}

type StatusBody = {
  status: Status
  reason?: string
}

class DomainError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function actorId(request: FastifyRequest): string {
  if (!request.authUser) {
    throw new DomainError(401, 'Authentication required')
  }

  return request.authUser.id
}

function sendDomainError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof DomainError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }

  throw error
}

export async function incidentRoutes(app: FastifyInstance) {
  app.get('/api/v1/services', { preHandler: requireAuth }, async (request) => {
    const includeInactive = request.authUser?.role === 'admin'
    const result = await pool.query(
      `SELECT id, name, description, owner_team AS "ownerTeam",
              criticality, status, created_at AS "createdAt"
       FROM services
       WHERE status = 'active' OR $1::boolean = true
       ORDER BY name ASC, id ASC`,
      [includeInactive],
    )

    return { services: result.rows }
  })

  app.post<{ Body: { name: string; description?: string; ownerTeam: string; criticality: Severity } }>(
    '/api/v1/services',
    {
      preHandler: [requireAuth, requireAdmin, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
            description: { type: 'string', maxLength: 2000 },
            ownerTeam: { type: 'string', minLength: 2, maxLength: 120 },
            criticality: { type: 'string', enum: severities },
          },
          required: ['name', 'ownerTeam', 'criticality'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { name, description = '', ownerTeam, criticality } = request.body
      try {
        const result = await pool.query(
          `INSERT INTO services (name, description, owner_team, criticality, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, description, owner_team AS "ownerTeam",
                     criticality, status, created_at AS "createdAt"`,
          [name.trim(), description.trim(), ownerTeam.trim(), criticality, actorId(request)],
        )

        return reply.code(201).send({ service: result.rows[0] })
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'A service with this name already exists' })
        }

        throw error
      }
    },
  )

  app.get<{ Querystring: ListQuery }>(
    '/api/v1/incidents',
    {
      preHandler: requireAuth,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: statuses },
            severity: { type: 'string', enum: severities },
            serviceId: { type: 'string', minLength: 1 },
            assigneeId: { type: 'string', minLength: 1 },
            q: { type: 'string', maxLength: 120 },
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const query = request.query
      const filters: string[] = []
      const values: unknown[] = []
      const addFilter = (sql: string, value: unknown) => {
        values.push(value)
        filters.push(sql.replace('?', `$${values.length}`))
      }

      if (query.status) addFilter('incident.status = ?', query.status)
      if (query.severity) addFilter('incident.severity = ?', query.severity)
      if (query.serviceId) addFilter('incident.service_id = ?', query.serviceId)
      if (query.assigneeId) addFilter('incident.assignee_id = ?', query.assigneeId)
      if (query.q?.trim()) {
        values.push(`%${query.q.trim()}%`)
        filters.push(`(incident.title ILIKE $${values.length} OR incident.description ILIKE $${values.length})`)
      }

      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
      const count = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM incidents AS incident ${where}`,
        values,
      )

      values.push(query.pageSize, (query.page - 1) * query.pageSize)
      const incidents = await pool.query(
        `SELECT incident.id, incident.title, incident.description,
                incident.service_id AS "serviceId", service.name AS "serviceName",
                incident.severity, incident.status,
                incident.created_by AS "createdBy", creator.display_name AS "createdByName",
                incident.assignee_id AS "assigneeId", assignee.display_name AS "assigneeName",
                incident.opened_at AS "openedAt", incident.resolved_at AS "resolvedAt",
                incident.updated_at AS "updatedAt"
         FROM incidents AS incident
         JOIN services AS service ON service.id = incident.service_id
         JOIN users AS creator ON creator.id = incident.created_by
         LEFT JOIN users AS assignee ON assignee.id = incident.assignee_id
         ${where}
         ORDER BY incident.updated_at DESC, incident.id ASC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      )

      return {
        incidents: incidents.rows,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: Number(count.rows[0]?.total ?? 0),
        },
      }
    },
  )

  app.post<{ Body: CreateIncidentBody }>(
    '/api/v1/incidents',
    {
      preHandler: [requireAuth, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 200 },
            description: { type: 'string', minLength: 5, maxLength: 10000 },
            serviceId: { type: 'string', minLength: 1 },
            severity: { type: 'string', enum: severities },
          },
          required: ['title', 'description', 'serviceId', 'severity'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const incident = await inTransaction(async (client) => {
          const service = await client.query<{ id: string }>(
            "SELECT id FROM services WHERE id = $1 AND status = 'active'",
            [request.body.serviceId],
          )

          if (!service.rows[0]) {
            throw new DomainError(400, 'Choose an active service')
          }

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO incidents (title, description, service_id, severity, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [request.body.title.trim(), request.body.description.trim(), service.rows[0].id, request.body.severity, actorId(request)],
          )
          const id = inserted.rows[0]!.id

          await client.query(
            `INSERT INTO incident_events (incident_id, actor_id, event_type, details)
             VALUES ($1, $2, 'incident.created', $3::jsonb)`,
            [id, actorId(request), JSON.stringify({ severity: request.body.severity, serviceId: service.rows[0].id })],
          )

          return id
        })

        const result = await pool.query(
          `SELECT incident.id, incident.title, incident.description,
                  incident.service_id AS "serviceId", service.name AS "serviceName",
                  incident.severity, incident.status,
                  incident.created_by AS "createdBy", creator.display_name AS "createdByName",
                  incident.opened_at AS "openedAt", incident.updated_at AS "updatedAt"
           FROM incidents AS incident
           JOIN services AS service ON service.id = incident.service_id
           JOIN users AS creator ON creator.id = incident.created_by
           WHERE incident.id = $1`,
          [incident],
        )

        return reply.code(201).send({ incident: result.rows[0] })
      } catch (error) {
        return sendDomainError(reply, error)
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/v1/incidents/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const incident = await pool.query(
        `SELECT incident.id, incident.title, incident.description,
                incident.service_id AS "serviceId", service.name AS "serviceName",
                incident.severity, incident.status,
                incident.created_by AS "createdBy", creator.display_name AS "createdByName",
                incident.assignee_id AS "assigneeId", assignee.display_name AS "assigneeName",
                incident.resolution_note AS "resolutionNote",
                incident.opened_at AS "openedAt", incident.resolved_at AS "resolvedAt",
                incident.created_at AS "createdAt", incident.updated_at AS "updatedAt"
         FROM incidents AS incident
         JOIN services AS service ON service.id = incident.service_id
         JOIN users AS creator ON creator.id = incident.created_by
         LEFT JOIN users AS assignee ON assignee.id = incident.assignee_id
         WHERE incident.id = $1`,
        [request.params.id],
      )

      if (!incident.rows[0]) {
        return reply.code(404).send({ error: 'Incident not found' })
      }

      const timeline = await pool.query(
        `SELECT timeline.kind, timeline.id, timeline.actor_id AS "actorId",
                app_user.display_name AS "actorName", timeline.event_type AS "eventType",
                timeline.body, timeline.details, timeline.created_at AS "createdAt"
         FROM (
           SELECT 'event'::text AS kind, id, actor_id, event_type, NULL::text AS body, details, created_at
           FROM incident_events WHERE incident_id = $1
           UNION ALL
           SELECT 'comment'::text AS kind, id, author_id AS actor_id, 'incident.comment' AS event_type,
                  body, '{}'::jsonb AS details, created_at
           FROM incident_comments WHERE incident_id = $1
         ) AS timeline
         JOIN users AS app_user ON app_user.id = timeline.actor_id
         ORDER BY timeline.created_at ASC, timeline.id ASC`,
        [request.params.id],
      )

      return { incident: incident.rows[0], timeline: timeline.rows }
    },
  )

  app.patch<{ Params: { id: string }; Body: StatusBody }>(
    '/api/v1/incidents/:id/status',
    {
      preHandler: [requireAuth, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: statuses },
            reason: { type: 'string', minLength: 2, maxLength: 2000 },
          },
          required: ['status'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        await inTransaction(async (client) => {
          const selected = await client.query<{ status: Status; resolution_note: string | null }>(
            'SELECT status, resolution_note FROM incidents WHERE id = $1 FOR UPDATE',
            [request.params.id],
          )
          const incident = selected.rows[0]

          if (!incident) throw new DomainError(404, 'Incident not found')

          const allowed: Record<Status, Status[]> = {
            open: ['acknowledged'],
            acknowledged: ['mitigating'],
            mitigating: ['resolved'],
            resolved: ['acknowledged'],
          }

          if (!allowed[incident.status].includes(request.body.status)) {
            throw new DomainError(409, `Cannot change incident from ${incident.status} to ${request.body.status}`)
          }

          const isResolution = request.body.status === 'resolved'
          const isReopen = incident.status === 'resolved' && request.body.status === 'acknowledged'
          const reason = request.body.reason?.trim()

          if ((isResolution || isReopen) && !reason) {
            throw new DomainError(400, isResolution ? 'A resolution note is required' : 'A reason is required to reopen an incident')
          }

          await client.query(
            `UPDATE incidents
             SET status = $2::incident_status,
                 resolution_note = CASE WHEN $2::incident_status = 'resolved' THEN $3 WHEN $4 THEN NULL ELSE resolution_note END,
                 resolved_at = CASE WHEN $2::incident_status = 'resolved' THEN now() WHEN $4 THEN NULL ELSE resolved_at END,
                 updated_at = now()
             WHERE id = $1`,
            [request.params.id, request.body.status, reason ?? null, isReopen],
          )

          await client.query(
            `INSERT INTO incident_events (incident_id, actor_id, event_type, details)
             VALUES ($1, $2, 'incident.status_changed', $3::jsonb)`,
            [request.params.id, actorId(request), JSON.stringify({
              from: incident.status,
              to: request.body.status,
              reason: reason ?? null,
              previousResolution: incident.resolution_note,
            })],
          )
        })
      } catch (error) {
        return sendDomainError(reply, error)
      }

      return { incidentId: request.params.id, status: request.body.status }
    },
  )

  app.patch<{ Params: { id: string }; Body: { assigneeId: string | null } }>(
    '/api/v1/incidents/:id/assignee',
    {
      preHandler: [requireAuth, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: { assigneeId: { type: ['string', 'null'] } },
          required: ['assigneeId'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        await inTransaction(async (client) => {
          const selected = await client.query<{ assignee_id: string | null }>(
            'SELECT assignee_id FROM incidents WHERE id = $1 FOR UPDATE',
            [request.params.id],
          )
          const incident = selected.rows[0]
          if (!incident) throw new DomainError(404, 'Incident not found')

          if (request.body.assigneeId) {
            const assignee = await client.query(
              'SELECT id FROM users WHERE id = $1 AND is_active = true',
              [request.body.assigneeId],
            )
            if (!assignee.rows[0]) throw new DomainError(400, 'Choose an active team member')
          }

          if (incident.assignee_id === request.body.assigneeId) return

          await client.query(
            'UPDATE incidents SET assignee_id = $2, updated_at = now() WHERE id = $1',
            [request.params.id, request.body.assigneeId],
          )
          await client.query(
            `INSERT INTO incident_events (incident_id, actor_id, event_type, details)
             VALUES ($1, $2, 'incident.assigned', $3::jsonb)`,
            [request.params.id, actorId(request), JSON.stringify({ from: incident.assignee_id, to: request.body.assigneeId })],
          )
        })
      } catch (error) {
        return sendDomainError(reply, error)
      }

      return { incidentId: request.params.id, assigneeId: request.body.assigneeId }
    },
  )

  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/api/v1/incidents/:id/comments',
    {
      preHandler: [requireAuth, requireSameOrigin],
      schema: {
        body: {
          type: 'object',
          properties: { body: { type: 'string', minLength: 2, maxLength: 5000 } },
          required: ['body'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      try {
        const comment = await inTransaction(async (client) => {
          const exists = await client.query('SELECT id FROM incidents WHERE id = $1 FOR UPDATE', [request.params.id])
          if (!exists.rows[0]) throw new DomainError(404, 'Incident not found')

          const inserted = await client.query(
            `INSERT INTO incident_comments (incident_id, author_id, body)
             VALUES ($1, $2, $3)
             RETURNING id, incident_id AS "incidentId", author_id AS "authorId", body,
                       created_at AS "createdAt"`,
            [request.params.id, actorId(request), request.body.body.trim()],
          )

          await client.query(
            `INSERT INTO incident_events (incident_id, actor_id, event_type, details)
             VALUES ($1, $2, 'incident.comment_added', $3::jsonb)`,
            [request.params.id, actorId(request), JSON.stringify({ commentId: inserted.rows[0].id })],
          )

          await client.query('UPDATE incidents SET updated_at = now() WHERE id = $1', [request.params.id])
          return inserted.rows[0]
        })

        return reply.code(201).send({ comment })
      } catch (error) {
        return sendDomainError(reply, error)
      }
    },
  )
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
