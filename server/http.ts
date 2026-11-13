const USER_AGENT = 'Mozilla/5.0 (compatible; Pulse/1.0; personal feed reader)'

/** For the sites that only answer what looks like a desktop browser. */
export const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export interface FetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  method?: string
  body?: string
}

export function request(url: string, { headers = {}, timeoutMs = 15_000, method, body }: FetchOptions = {}): Promise<Response> {
  return fetch(url, {
    method,
    body,
    headers: { 'user-agent': USER_AGENT, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

export async function readText(res: Response, maxBytes = Infinity): Promise<string> {
  if (!res.body) return ''
  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let text = ''
  let size = 0
  while (size < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => {})
  return text
}

export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<string | null> {
  const res = await request(url, { ...options, headers: { accept: 'text/html,application/xhtml+xml', ...options.headers } })
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  return readText(res, options.maxBytes)
}

export async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane))
  return results
}

export function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [, name, quoted, single, bare] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found[name.toLowerCase()] = quoted ?? single ?? bare
  }
  return found
}
