import { Failure } from './errors.ts'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/decisions'
const MODEL = 'gemini-decision-1'

/** Lowest to highest; the answer is the probability-weighted position on this scale. */
const LEVELS = [
  'Not about the subject, or an advert, a listing or spam.',
  'Mentions the subject only in passing.',
  'About the subject, but routine or thin.',
  'About the subject and substantial: news, analysis or notable work this reader would want to see.',
]

export const hasDecisions = () => Boolean(process.env.GEMINI_API_KEY)

export interface Story {
  id: number
  /** The interest the story was found for. */
  subject: string
  title: string
  excerpt: string
}

interface DecisionsResponse {
  answers?: Record<string, { score?: number } | undefined>
  error?: { code?: string | number; message?: string }
}

/**
 * How well each story serves its subject for the reader described by `profile`, from 0 to 1. Judging
 * against the subject rather than the reader's history gives a subject on trial the same chance as an
 * established one. All the stories go in one request: the profile is the shared input and every story
 * is a question about it.
 */
export async function scoreRelevance(profile: string, stories: Story[]): Promise<Map<number, number>> {
  if (stories.length === 0) return new Map()
  const questions = Object.fromEntries(
    stories.map((story) => [
      `s${story.id}`,
      {
        type: 'score',
        instructions: `The feed looked for stories about "${story.subject}" for the reader described in the input. Rate this one.\nHeadline: ${story.title}\n${story.excerpt.slice(0, 240)}`,
        criteria: LEVELS,
      },
    ]),
  )
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: profile, questions }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new Failure(502, 'decisions_unreachable', 'Could not reach the Gemini Decisions API.')
  }
  const data = (await res.json().catch(() => null)) as DecisionsResponse | null
  if (!res.ok || !data?.answers) {
    const detail = data?.error?.message ?? `HTTP ${res.status}`
    const code = res.status === 401 || res.status === 403 ? 'decisions_key_rejected' : res.status === 429 ? 'decisions_rate_limited' : 'decisions_failed'
    throw new Failure(502, code, `Gemini Decisions: ${detail}`)
  }
  const scores = new Map<number, number>()
  for (const story of stories) {
    const score = data.answers[`s${story.id}`]?.score
    if (typeof score === 'number') scores.set(story.id, Math.min(1, Math.max(0, score / (LEVELS.length - 1))))
  }
  return scores
}
