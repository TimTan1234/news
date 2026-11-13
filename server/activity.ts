/** What an account did on another platform, as far as that platform tells a signed-in visitor. */
export type ActivityKind = 'watched' | 'liked' | 'saved' | 'followed'

export interface Activity {
  kind: ActivityKind
  /** The platform's own id for the video or channel. */
  ref: string
  title: string
  by: string | null
}

/** What to show while a sign-in waits: a QR code to scan, or a code to type in at an address. */
export interface LoginStart {
  key: string
  image?: string
  code?: string
  url?: string
  /** How long the sign-in stays open, and how often to ask whether it has landed, in milliseconds. */
  lasts: number
  every: number
}

export type LoginState = { state: 'waiting' } | { state: 'expired' } | { state: 'connected'; account: string; credentials: unknown }

export interface Service {
  name: string
  available: () => boolean
  startLogin: () => Promise<LoginStart>
  checkLogin: (key: string) => Promise<LoginState>
  /** Newest first within each kind. Throws `LoginLost` when the platform no longer accepts the login. */
  activity: (credentials: never) => Promise<Activity[]>
}

export class LoginLost extends Error {}
