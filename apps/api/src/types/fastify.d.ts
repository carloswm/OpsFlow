import type { AuthUser } from '../modules/auth/auth.types.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
  }
}
