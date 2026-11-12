import { createStore } from './store.ts'

export type Theme = 'dark' | 'light'

export const themeStore = createStore<Theme>(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function setTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', getComputedStyle(root).getPropertyValue('--canvas').trim())
  try {
    localStorage.setItem('pulse-theme', theme)
  } catch {
    // Storage can be unavailable in private windows; the choice then lasts for this visit.
  }
  themeStore.set(theme)
}
