function required(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function positiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name]

  if (rawValue === undefined) {
    return fallback
  }

  const value = Number.parseInt(rawValue, 10)

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }

  return value
}

export const config = {
  databaseHost: required('DATABASE_HOST'),
  databasePort: positiveInteger('DATABASE_PORT', 5432),
  databaseUser: required('DATABASE_USER'),
  databasePassword: required('DATABASE_PASSWORD'),
  databaseName: required('DATABASE_NAME'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  host: process.env.HOST ?? '0.0.0.0',
  port: positiveInteger('PORT', 3000),
  databasePoolMax: positiveInteger('DATABASE_POOL_MAX', 10),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
}
