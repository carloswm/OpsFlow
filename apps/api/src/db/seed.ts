import argon2 from 'argon2'
import pg from 'pg'
import { config } from '../config.js'

function requiredSeedValue(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required demo seed variable: ${name}`)
  }

  return value
}

if (process.env.ENABLE_DEMO_SEED !== 'true') {
  throw new Error('Demo seeding is disabled. Set ENABLE_DEMO_SEED=true only in a disposable local environment.')
}

const email = requiredSeedValue('DEMO_ADMIN_EMAIL').trim().toLowerCase()
const password = requiredSeedValue('DEMO_ADMIN_PASSWORD')

if (password.length < 16) {
  throw new Error('DEMO_ADMIN_PASSWORD must contain at least 16 characters.')
}

const client = new pg.Client({
  host: config.databaseHost,
  port: config.databasePort,
  user: config.databaseUser,
  password: config.databasePassword,
  database: config.databaseName,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
})

const demoServices = [
  { name: 'Checkout API', description: 'Checkout and order placement service', ownerTeam: 'Commerce', criticality: 'P1' },
  { name: 'Catalog', description: 'Product catalog and search indexing', ownerTeam: 'Commerce', criticality: 'P2' },
  { name: 'Notifications', description: 'Customer email and status notifications', ownerTeam: 'Customer Experience', criticality: 'P3' },
] as const

try {
  await client.connect()
  await client.query('BEGIN')

  let userId = (await client.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = $1',
    [email],
  )).rows[0]?.id

  if (!userId) {
    const passwordHash = await argon2.hash(password)
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (display_name, email, password_hash, role)
       VALUES ('OpsFlow Admin', $1, $2, 'admin')
       RETURNING id`,
      [email, passwordHash],
    )
    userId = inserted.rows[0]!.id
  }

  for (const service of demoServices) {
    await client.query(
      `INSERT INTO services (name, description, owner_team, criticality, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [service.name, service.description, service.ownerTeam, service.criticality, userId],
    )
  }

  await client.query('COMMIT')
  process.stdout.write(`Demo account and ${demoServices.length} sample services are ready.\n`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  process.stderr.write(`Demo seed failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await client.end()
}
