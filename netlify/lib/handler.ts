/**
 * The request pipeline behind the public `/api/hint` and `/api/review`.
 *
 * It is the Netlify counterpart of `server/app.ts`: same protocol, same
 * shared `runCoach` core, but with the spending controls from `./limits`
 * wrapped around it, because this one is reachable from the whole internet.
 *
 * Everything it touches — the blob store, the clock, the environment, the
 * Claude client — is injected, so the tests exercise the real pipeline
 * without a network, a key, or a Netlify runtime.
 */
import { LIMITS, type CoachErrorResponse, type HealthResponse } from '../../src/coach/protocol'
import type { Claude } from '../../server/claude'
import { coachError, runCoach, type CoachEndpoint, type CoachOutcome } from '../../server/coach'
import {
  COACH_LIMITS,
  answerKey,
  isAllowedOrigin,
  readAnswer,
  reserveBudget,
  takeRateLimit,
  visitorKey,
  writeAnswer,
  type CoachStore,
} from './limits'

/**
 * What a visitor is told when a limit stops the request.
 *
 * The `no-key` kind is deliberate, and it is the whole trick that keeps a
 * spent budget from becoming a bad experience. `CoachClient` reacts to
 * `no-key` by flipping to the quiet "coaching offline" badge and — see
 * `src/coach/client.ts` — by short-circuiting every later request in the
 * session before it reaches the network. So the page keeps working with its
 * built-in hints, shows no error, and stops asking. A `rate-limited` kind
 * would instead raise a one-time banner and keep retrying all session.
 */
export const LIMIT_MESSAGE = 'Claude coaching is paused; the built-in coach is taking over.'

const json = (status: number, body: unknown, extra?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  })

const errorResponse = (status: number, error: CoachErrorResponse['error'], extra?: Record<string, string>): Response =>
  json(status, { error } satisfies CoachErrorResponse, extra)

/** Everything the handler needs from the outside world. */
export interface CoachDeps {
  store: CoachStore
  /** Null when no ANTHROPIC_API_KEY is configured: the site then runs on built-in hints. */
  claude: Claude | null
  env: Record<string, string | undefined>
  /** The caller's IP, used only as a hashed rate-limit key. */
  ip: string
  now?: () => number
}

/** `GET /api/health`. Reports whether a key is configured — never anything about its value. */
export function handleHealth(env: Record<string, string | undefined>): Response {
  const configured = Boolean(env['ANTHROPIC_API_KEY']?.trim())
  return json(200, { ok: true, claude: configured } satisfies HealthResponse)
}

export async function handleCoach(endpoint: CoachEndpoint, request: Request, deps: CoachDeps): Promise<Response> {
  const now = deps.now?.() ?? Date.now()

  if (request.method !== 'POST') {
    return errorResponse(405, { kind: 'bad-request', message: 'Use POST.' })
  }

  // Gate 1: this site only. Browsers send Origin on every cross-origin-capable
  // POST, so a missing one means something that is not this page.
  if (!isAllowedOrigin(request.headers.get('origin'), deps.env)) {
    // No echo of the header: it is attacker-controlled input.
    return errorResponse(403, { kind: 'bad-request', message: 'Forbidden origin.' })
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw) > LIMITS.maxBodyBytes) {
    return errorResponse(413, { kind: 'bad-request', message: 'Request body too large.' })
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return errorResponse(400, { kind: 'bad-request', message: 'Malformed JSON.' })
  }

  // Gate 2: one visitor cannot hammer the endpoint, cached or not.
  const visitor = visitorKey(deps.ip)
  if (!(await takeRateLimit(deps.store, visitor, now))) {
    return errorResponse(503, { kind: 'no-key', message: LIMIT_MESSAGE }, { 'x-coach-limit': 'rate' })
  }

  // Gates 3 and 4 run inside the shared core, after it has validated the
  // body: a malformed request must not consume budget, and a cache hit must
  // not either.
  const key = answerKey(endpoint, body)
  // A box, not a plain `let`: the assignments happen inside the callback
  // below, which narrowing does not follow.
  const served: { via: 'claude' | 'cache' | 'budget' } = { via: 'claude' }

  const beforeClaude = async (): Promise<CoachOutcome | null> => {
    const cached = await readAnswer(deps.store, key, now)
    if (cached) {
      served.via = 'cache'
      return { status: 200, body: { text: cached } }
    }
    if (!(await reserveBudget(deps.store, visitor, endpoint, now))) {
      served.via = 'budget'
      return coachError(503, { kind: 'no-key', message: LIMIT_MESSAGE })
    }
    return null
  }

  const outcome = await runCoach(endpoint, body, deps.claude, {
    maxTokens: COACH_LIMITS.maxTokens[endpoint],
    beforeClaude,
  })

  if (outcome.status === 200 && served.via === 'claude' && 'text' in outcome.body) {
    await writeAnswer(deps.store, key, outcome.body.text, now)
  }

  // A hint for whoever is reading the network tab; the app ignores it.
  const marker: Record<string, string> =
    served.via === 'cache' ? { 'x-coach-cache': 'hit' } : served.via === 'budget' ? { 'x-coach-limit': 'budget' } : {}
  return json(outcome.status, outcome.body, marker)
}
