import { api, type User } from '../api/client.ts'
import { queryClient } from '../api/query.ts'
import { langStore } from '../i18n/index.ts'
import { createStore } from './store.ts'

export type Session =
  | { status: 'loading'; user: null }
  | { status: 'out'; user: null }
  /** `isNew` holds until a just-created account has fetched its sources for the first time. */
  | { status: 'in'; user: User; isNew?: boolean }

export const sessionStore = createStore<Session>({ status: 'loading', user: null })

export async function loadSession(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me')
    const { user } = (await res.json()) as { user: User | null }
    sessionStore.set(user ? { status: 'in', user } : { status: 'out', user: null })
  } catch {
    sessionStore.set({ status: 'out', user: null })
  }
}

export async function signIn(mode: 'login' | 'register', username: string, password: string): Promise<void> {
  const { user } = await api<{ user: User }>(`/api/auth/${mode}`, { body: { username, password, lang: langStore.get() } })
  queryClient.clear()
  sessionStore.set({ status: 'in', user, isNew: mode === 'register' })
}

/** Signing out reloads the page so nothing held in memory carries over to the next account. */
export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  location.assign('/')
}
