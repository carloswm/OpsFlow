import pg from 'pg'
import { config } from '../config.js'

export const pool = new pg.Pool({
  host: config.databaseHost,
  port: config.databasePort,
  user: config.databaseUser,
  password: config.databasePassword,
  database: config.databaseName,
  ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  max: config.databasePoolMax,
  application_name: 'opsflow-api',
})

pool.on('error', (error) => {
  // Pool errors are logged by the process logger in a later observability step.
  // Keep the handler so an idle-client error does not become an unhandled event.
  process.stderr.write(`Unexpected PostgreSQL pool error: ${error.message}\n`)
})
