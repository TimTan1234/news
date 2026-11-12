import { createStore, useStore } from '../state/store.ts'
import { en, type Messages } from './en.ts'
import { zh } from './zh.ts'

export type Lang = 'en' | 'zh'

const CATALOG: Record<Lang, Messages> = { en, zh }

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem('pulse-lang')
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // Storage can be unavailable in private windows; fall back to the browser's language.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export const langStore = createStore<Lang>(initialLang())
document.documentElement.lang = langStore.get() === 'zh' ? 'zh-CN' : 'en'

export function setLang(lang: Lang): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  try {
    localStorage.setItem('pulse-lang', lang)
  } catch {
    // The choice then lasts for this visit.
  }
  langStore.set(lang)
}

/** Current messages, for code outside React. */
export const messages = (): Messages => CATALOG[langStore.get()]

/** Current messages; re-renders the caller when the language changes. */
export function useMessages(): Messages {
  return CATALOG[useStore(langStore)]
}

export const useLang = (): Lang => useStore(langStore)

/** Locale for dates: the browser's own for English, mainland Chinese for Chinese. */
export const dateLocale = (): string | undefined => (langStore.get() === 'zh' ? 'zh-CN' : undefined)
