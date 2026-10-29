import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config } from '../config.js'

const migrationsPath = fileURLToPath(new URL('./migrations/', import.meta.url))
const client = new pg.Client({
  host: config.databaseHost,
  port: config.databasePort,
  user: config.databaseUser,
  password: config.databasePassword,
  database: config.databaseName,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
})

try {
  await client.connect()
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = (await readdir(migrationsPath))
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()

  for (const file of files) {
    const version = file.slice(0, -4)
    const migrationPath = fileURLToPath(new URL(`./migrations/${file}`, import.meta.url))
    const sql = await readFile(migrationPath, 'utf8')

    await client.query('BEGIN')

    try {
      const applied = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version],
      )

      if (applied.rowCount === 0) {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        process.stdout.write(`Applied database migration ${file}.\n`)
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }

  process.stdout.write('Database migrations are up to date.\n')
} catch (error) {
  process.stderr.write(`Database migration failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await client.end()
}
