import { Failure } from './errors.ts'

const EMBEDDING_MODEL = '@cf/baai/bge-m3'
const CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const EMBEDDING_BATCH = 50

export const hasWorkersAi = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)

async function call<T>(path: string, body: object): Promise<T> {
  let res: Response
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Failure(502, 'workers_ai_unreachable', 'Could not reach Cloudflare Workers AI.')
  }
  const data = (await res.json().catch(() => null)) as (T & { errors?: { message?: string }[] }) | null
  if (!res.ok || !data) throw new Failure(502, 'workers_ai_failed', `Cloudflare Workers AI: ${data?.errors?.[0]?.message ?? `HTTP ${res.status}`}`)
  return data
}

/** One unit-length vector per text, so the dot product of two is their cosine similarity. The model reads Chinese and English alike. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const vectors: Float32Array[] = []
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH) {
    const input = texts.slice(start, start + EMBEDDING_BATCH)
    const { data } = await call<{ data?: { index: number; embedding: number[] }[] }>('embeddings', { model: EMBEDDING_MODEL, input })
    if (data?.length !== input.length) throw new Failure(502, 'workers_ai_failed', 'Cloudflare Workers AI returned a different number of embeddings than texts.')
    for (const { embedding } of [...data].sort((a, b) => a.index - b.index)) {
      const vector = Float32Array.from(embedding)
      const length = Math.hypot(...vector) || 1
      vectors.push(vector.map((value) => value / length))
    }
  }
  return vectors
}

/** A short answer to one question. */
export async function answer(system: string, user: string): Promise<string> {
  const { choices } = await call<{ choices?: { message?: { content?: unknown } }[] }>('chat/completions', {
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: 8,
    temperature: 0,
  })
  return String(choices?.[0]?.message?.content ?? '')
}
