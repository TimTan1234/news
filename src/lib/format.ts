import { dateLocale, messages } from '../i18n/index.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function ago(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp
  const { time } = messages()
  if (elapsed < MINUTE) return time.now
  if (elapsed < HOUR) return time.minutes(Math.floor(elapsed / MINUTE))
  if (elapsed < DAY) return time.hours(Math.floor(elapsed / HOUR))
  if (elapsed < 7 * DAY) return time.days(Math.floor(elapsed / DAY))
  return new Date(timestamp).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
}

export function longDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(dateLocale(), { weekday: 'long', month: 'long', day: 'numeric' })
}

export function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' })
}

export function weekday(day: string, width: 'narrow' | 'long' = 'narrow'): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: width })
}
