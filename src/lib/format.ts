const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function ago(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function longDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function clock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function weekday(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })
}
