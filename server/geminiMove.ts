/**
 * One move from a Gemini model on Vertex AI: the same prompt a Claude seat
 * gets (FEN, numbered history, legal SAN list; see movePrompt in
 * ./claudeMove) and a `responseSchema` whose `move` enum is the legal list,
 * checked again on the way back. Same outcome shape as a Claude move, so the
 * ledger, the usage totals and the browser treat them alike.
 *
 * Contract (read 2026-10-01): docs.cloud.google.com/gemini-enterprise-agent-platform
 * /models/guides/gemini-3-6-flash and /models/thinking. Both models are served
 * from the `global` location (3.1 Pro Preview only there). The `us` multi-region
 * endpoint is not used: on 2026-10-01 it timed out on 12 of 12 Flash moves.
 *
 * Auth is Application Default Credentials through google-auth-library, which
 * reads and refreshes them itself: this code never opens the credentials file,
 * and the access token lives only in the request's headers. It is never in a
 * request body, an outcome, a log line or the browser.
 */
import { MOVE_TIMEOUT_MS, CLAUDE_MODELS, costUsd, timeoutCostUsd, timeoutTokens, type ClaudeModelKey } from '../src/claude/models'
import { MAX_WHY_WORDS, cutWords, movePrompt, parseReply, type MoveOutcome } from './claudeMove'

/** The Vertex AI location both models are served from. */
export const VERTEX_LOCATION = 'global'

/** The Google Cloud project billed when GOOGLE_CLOUD_PROJECT is unset. */
export const DEFAULT_GCP_PROJECT = 'poised-runner-159919'

/** OAuth scope for Vertex AI. */
export const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

/** The generateContent URL of a Google model in the global location. */
export const vertexEndpoint = (project: string, modelId: string): string =>
  `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${VERTEX_LOCATION}/publishers/google/models/${encodeURIComponent(modelId)}:generateContent`

/**
 * The thinking level each model is asked for: the lowest it accepts, as the
 * Claude seats get the lowest effort. 3.1 Pro lists LOW, MEDIUM and HIGH (it
 * rejects MINIMAL; thinking cannot be switched off on it); 3.6 Flash lists
 * MINIMAL, LOW, MEDIUM and HIGH. MINIMAL "still requires thought signatures",
 * which only matters for multi-turn requests: each move is one turn.
 */
export const GEMINI_THINKING_LEVEL = { 'gemini-pro': 'LOW', 'gemini-flash': 'MINIMAL' } as const

export type GeminiModelKey = keyof typeof GEMINI_THINKING_LEVEL

// Thinking tokens count toward maxOutputTokens; the reply itself is tiny. The live calls of
// 2026-10-01 used at most 206 output tokens, thinking included (3.6 Flash at MINIMAL at most 43),
// so 2,000 is ten times that. It is also what a timed-out call is charged for: the Claude seats'
// 8,000 would charge each one $0.06 on Flash, not $0.015.
export const GEMINI_MOVE_MAX_TOKENS = 2000
const MAX_TOKENS = GEMINI_MOVE_MAX_TOKENS

/** After ADC fails, how long `available` answers false before asking again. */
const RECHECK_MS = 30_000

/** Application Default Credentials, as the client needs them (GoogleAuth has this method). */
export interface VertexAuth {
  getRequestHeaders(url?: string): Promise<Headers>
}

/** Vertex AI, as the move code needs it. Injectable so tests never touch the network or real credentials. */
export interface VertexClient {
  /** Whether ADC yields credentials now. Never throws. A success is remembered until a move is refused for auth. */
  available(): Promise<boolean>
  /** POST a generateContent body. Rejects with a `VertexAuthError` when ADC gives no credentials, a `TimeoutError` on timeout. */
  generateContent(modelId: string, body: unknown): Promise<Response>
}

/** ADC could not produce credentials. Carries no detail from the underlying error. */
export class VertexAuthError extends Error {
  override name = 'VertexAuthError'
  constructor() {
    super('No Google Application Default Credentials.')
  }
}

/**
 * The real client. `auth` defaults to a GoogleAuth over ADC (loaded lazily, so
 * nothing Google is imported until a server builds one); `fetch` and `now` are
 * injectable for tests; `timeoutMs` (default MOVE_TIMEOUT_MS) aborts the
 * request and the body read with a `TimeoutError`.
 */
export function createVertexClient(opts: {
  project: string
  auth?: VertexAuth
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
}): VertexClient {
  const { project } = opts
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = opts.timeoutMs ?? MOVE_TIMEOUT_MS
  const now = opts.now ?? Date.now
  let authPromise: Promise<VertexAuth> | null = opts.auth ? Promise.resolve(opts.auth) : null
  const getAuth = () =>
    (authPromise ??= import('google-auth-library').then(({ GoogleAuth }) => new GoogleAuth({ scopes: [VERTEX_SCOPE] })))

  // The credentials lookup (a token refresh may go to the network) is bounded by the same timeout as a call.
  const headers = async (): Promise<Headers> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new VertexAuthError()), timeoutMs)
    })
    try {
      const h = await Promise.race([getAuth().then((a) => a.getRequestHeaders()), late])
      if (!h.get('authorization')) throw new VertexAuthError()
      return h
    } catch {
      throw new VertexAuthError()
    } finally {
      clearTimeout(timer)
    }
  }

  // `ok`: ADC worked and Google has not refused it since. `failedAt`: when ADC failed or Google
  // answered 401/403 (e.g. the API is off, an IAM role is missing, the project is not this
  // account's): until RECHECK_MS later `available` says no, even though ADC still yields headers.
  let ok = false
  let failedAt: number | null = null
  let checking: Promise<boolean> | null = null
  const refused = () => {
    ok = false
    failedAt = now()
  }
  return {
    async available() {
      if (ok) return true
      if (failedAt !== null && now() - failedAt < RECHECK_MS) return false
      // Concurrent budget and start requests share one lookup.
      checking ??= headers()
        .then(() => {
          ok = true
          failedAt = null
          return true
        })
        .catch(() => {
          refused()
          return false
        })
        .finally(() => {
          checking = null
        })
      return checking
    },
    async generateContent(modelId, body) {
      let h: Headers
      try {
        h = await headers()
      } catch (err) {
        refused()
        throw err
      }
      h.set('content-type', 'application/json')
      const res = await fetchImpl(vertexEndpoint(project, modelId), {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401 || res.status === 403) refused()
      return res
    },
  }
}

type Failure = Extract<MoveOutcome, { ok: false }>['kind']

/** An HTTP refusal. Google's errors carry a status name too; RESOURCE_EXHAUSTED is a quota or rate limit. */
function kindOfRefusal(status: number, statusName: unknown): Failure {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429 || statusName === 'RESOURCE_EXHAUSTED') return 'rate-limited'
  return 'upstream'
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

/** Distributes over the union, unlike Omit. */
type WithoutMs<T> = T extends unknown ? Omit<T, 'ms'> : never

/** Ask a Gemini model for one move. `req.model` must be a Gemini key; any other is a bad request. */
export async function requestGeminiMove(
  deps: { vertex: VertexClient },
  req: { model: ClaudeModelKey; startFen?: string; history: string[] },
): Promise<MoveOutcome> {
  const started = Date.now()
  const done = (o: WithoutMs<MoveOutcome>): MoveOutcome => ({ ...o, ms: Date.now() - started }) as MoveOutcome
  const bad = () => done({ ok: false, kind: 'bad-request', costUsd: 0, tokens: null })
  const free = (kind: Failure) => done({ ok: false, kind, costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })

  if (!Object.prototype.hasOwnProperty.call(GEMINI_THINKING_LEVEL, req.model)) return bad()
  const key = req.model as GeminiModelKey
  const prompt = movePrompt(req)
  if (!prompt) return bad()
  const { legal, system, user } = prompt

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: MAX_TOKENS,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { move: { type: 'STRING', enum: legal }, why: { type: 'STRING' } },
        required: ['move', 'why'],
      },
      thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL[key] },
    },
  }

  // A timeout is the one failure that may still be billed (Google charges only a 200, but the
  // call was abandoned here, not refused there): charge the worst case, the estimated input plus
  // the whole output cap, as a Claude move does. The signal also covers the body read.
  const isTimeout = (err: unknown) => err instanceof Error && err.name === 'TimeoutError'
  const worstCase = () => {
    const promptChars = system.length + user.length + JSON.stringify(body.generationConfig.responseSchema).length
    const est = timeoutTokens(promptChars, MAX_TOKENS)
    return {
      costUsd: timeoutCostUsd(key, promptChars, MAX_TOKENS),
      tokens: { inputTokens: est.input_tokens, outputTokens: est.output_tokens },
    }
  }
  const timedOut = () => done({ ok: false, kind: 'timeout', ...worstCase() })

  let res: Response
  try {
    res = await deps.vertex.generateContent(CLAUDE_MODELS[key].id, body)
  } catch (err) {
    // No credentials: nothing was sent, so no call is counted.
    if (err instanceof VertexAuthError) return done({ ok: false, kind: 'auth', costUsd: 0, tokens: null })
    if (isTimeout(err)) return timedOut()
    // A network failure is free.
    return free('upstream')
  }

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch (err) {
    if (isTimeout(err)) return timedOut()
    // Not JSON: an unusable reply (or a refusal without a body).
  }
  // A refusal is not billed ("You're charged only for requests that return a 200"); only its status name is read.
  if (!res.ok) {
    const error = isRecord(payload) && isRecord(payload['error']) ? payload['error'] : {}
    return free(kindOfRefusal(res.status, error['status']))
  }

  // Google bills every 200. One without readable usage is charged the worst case, like a timeout,
  // so the ledger never under-counts.
  if (!isRecord(payload) || !isRecord(payload['usageMetadata'])) return done({ ok: false, kind: 'illegal-reply', ...worstCase() })
  // Thinking is billed as output, so thoughtsTokenCount is counted in with the reply's own tokens.
  const usage = payload['usageMetadata']
  const tokens = {
    inputTokens: count(usage['promptTokenCount']),
    outputTokens: count(usage['candidatesTokenCount']) + count(usage['thoughtsTokenCount']),
  }
  const cost = costUsd(key, { input_tokens: tokens.inputTokens, output_tokens: tokens.outputTokens })
  const illegal = () => done({ ok: false, kind: 'illegal-reply', costUsd: cost, tokens })

  const candidates = isRecord(payload) && Array.isArray(payload['candidates']) ? payload['candidates'] : []
  const candidate: unknown = candidates[0]
  // A cut-off (MAX_TOKENS), blocked (SAFETY, ...) or otherwise unfinished reply is unusable.
  if (!isRecord(candidate) || candidate['finishReason'] !== 'STOP') return illegal()
  const content = isRecord(candidate['content']) ? candidate['content'] : {}
  const parts = Array.isArray(content['parts']) ? content['parts'] : []
  const text = parts
    .map((p) => (isRecord(p) && p['thought'] !== true && typeof p['text'] === 'string' ? p['text'] : ''))
    .join('')
  const parsed = parseReply(text)
  if (!parsed || !legal.includes(parsed.move)) return illegal()
  return done({ ok: true, san: parsed.move, why: cutWords(parsed.why, MAX_WHY_WORDS), costUsd: cost, tokens })
}
