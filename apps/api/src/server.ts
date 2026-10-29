import { buildApp } from './app.js'
import { config } from './config.js'

const app = buildApp()

try {
  await app.listen({ host: config.host, port: config.port })

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down OpsFlow API')
    await app.close()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
} catch (error) {
  app.log.error({ err: error }, 'Could not start OpsFlow API')
  process.exit(1)
}
