export type AuthUser = {
  id: string
  displayName: string
  email: string
  role: 'member' | 'admin'
  sessionId: string
}
