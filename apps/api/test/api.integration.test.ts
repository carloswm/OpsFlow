import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'

const testDatabaseName = 'opsflow_test'
const testEmail = process.env.DEMO_ADMIN_EMAIL ?? ''
const testPassword = process.env.DEMO_ADMIN_PASSWORD ?? ''
const requestHost = 'opsflow.test'
const sameOriginHeaders = {
  host: requestHost,
  origin: `http://${requestHost}`,
}

if (process.env.DATABASE_NAME !== testDatabaseName) {
  throw new Error(`API integration tests require DATABASE_NAME=${testDatabaseName}; refusing to use another database.`)
}

let app: FastifyInstance
let sessionCookie: string
let adminId: string

function responseBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T
}

function requestHeaders(cookie?: string, origin = sameOriginHeaders.origin) {
  return {
    ...sameOriginHeaders,
    origin,
    ...(cookie ? { cookie } : {}),
  }
}

describe('API integration', () => {
  beforeAll(async () => {
    if (!testEmail || !testPassword) {
      throw new Error('DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD are required for API integration tests.')
    }

    app = buildApp()
    await app.ready()

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: sameOriginHeaders,
      payload: { email: testEmail, password: testPassword },
    })

    expect(login.statusCode).toBe(200)

    const setCookie = login.headers['set-cookie']
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie
    expect(cookieHeader).toBeTruthy()
    sessionCookie = cookieHeader!.split(';', 1)[0]!
    adminId = responseBody<{ user: { id: string } }>(login).user.id
  })

  afterAll(async () => {
    await app?.close()
  })

  it('reports live and ready when the API and database are available', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' })
    const ready = await app.inject({ method: 'GET', url: '/health/ready' })

    expect(live.statusCode).toBe(200)
    expect(responseBody(live)).toEqual({ status: 'alive' })
    expect(ready.statusCode).toBe(200)
    expect(responseBody(ready)).toEqual({ status: 'ready', dependencies: { database: 'ready' } })
  })

  it('requires authentication and rejects state changes from a different origin', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/incidents' })
    expect(anonymous.statusCode).toBe(401)

    const invalidPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: sameOriginHeaders,
      payload: { email: testEmail, password: 'incorrect-test-password' },
    })
    expect(invalidPassword.statusCode).toBe(401)

    const services = await app.inject({
      method: 'GET',
      url: '/api/v1/services',
      headers: requestHeaders(sessionCookie),
    })
    const serviceId = responseBody<{ services: Array<{ id: string }> }>(services).services[0]?.id
    expect(serviceId).toBeTruthy()

    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents',
      headers: requestHeaders(sessionCookie, 'http://untrusted.example'),
      payload: {
        title: 'Cross-origin test incident',
        description: 'This request must be rejected before it changes data.',
        serviceId,
        severity: 'P2',
      },
    })
    expect(crossOrigin.statusCode).toBe(403)
  })

  it('creates, assigns, comments, resolves, and reopens an incident with an audit timeline', async () => {
    const services = await app.inject({
      method: 'GET',
      url: '/api/v1/services',
      headers: requestHeaders(sessionCookie),
    })
    const serviceId = responseBody<{ services: Array<{ id: string }> }>(services).services[0]?.id
    expect(serviceId).toBeTruthy()

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/incidents',
      headers: requestHeaders(sessionCookie),
      payload: {
        title: 'API integration test incident',
        description: 'Verify the complete incident lifecycle through HTTP routes.',
        serviceId,
        severity: 'P2',
      },
    })

    expect(created.statusCode).toBe(201)
    const incidentId = responseBody<{ incident: { id: string } }>(created).incident.id

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${incidentId}/assignee`,
      headers: requestHeaders(sessionCookie),
      payload: { assigneeId: adminId },
    })
    expect(assigned.statusCode).toBe(200)

    const invalidTransition = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${incidentId}/status`,
      headers: requestHeaders(sessionCookie),
      payload: { status: 'mitigating' },
    })
    expect(invalidTransition.statusCode).toBe(409)

    for (const status of ['acknowledged', 'mitigating'] as const) {
      const changed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/incidents/${incidentId}/status`,
        headers: requestHeaders(sessionCookie),
        payload: { status },
      })
      expect(changed.statusCode).toBe(200)
    }

    const missingResolutionReason = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${incidentId}/status`,
      headers: requestHeaders(sessionCookie),
      payload: { status: 'resolved' },
    })
    expect(missingResolutionReason.statusCode).toBe(400)

    const resolved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${incidentId}/status`,
      headers: requestHeaders(sessionCookie),
      payload: { status: 'resolved', reason: 'The failing dependency recovered.' },
    })
    expect(resolved.statusCode).toBe(200)

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/v1/incidents/${incidentId}/status`,
      headers: requestHeaders(sessionCookie),
      payload: { status: 'acknowledged', reason: 'The error rate increased again.' },
    })
    expect(reopened.statusCode).toBe(200)

    const comment = await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${incidentId}/comments`,
      headers: requestHeaders(sessionCookie),
      payload: { body: 'The recovery and reopening paths were verified.' },
    })
    expect(comment.statusCode).toBe(201)

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${incidentId}`,
      headers: requestHeaders(sessionCookie),
    })
    const result = responseBody<{
      incident: { status: string; assigneeId: string }
      timeline: Array<{ kind: string; eventType: string }>
    }>(detail)

    expect(detail.statusCode).toBe(200)
    expect(result.incident.status).toBe('acknowledged')
    expect(result.incident.assigneeId).toBe(adminId)
    expect(result.timeline.some((entry) => entry.eventType === 'incident.created')).toBe(true)
    expect(result.timeline.some((entry) => entry.eventType === 'incident.assigned')).toBe(true)
    expect(result.timeline.some((entry) => entry.eventType === 'incident.comment_added')).toBe(true)
    expect(result.timeline.some((entry) => entry.kind === 'comment')).toBe(true)
    expect(result.timeline.filter((entry) => entry.eventType === 'incident.status_changed')).toHaveLength(4)
  })
})
