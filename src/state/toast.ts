import { createStore } from './store.ts'

export const toastStore = createStore<{ id: number; message: string } | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined
let nextId = 1

export function toast(message: string): void {
  clearTimeout(timer)
  toastStore.set({ id: nextId++, message })
  timer = setTimeout(() => toastStore.set(null), 2600)
}
