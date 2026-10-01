/**
 * The request pipeline behind the local-only `/api/game/*` endpoints.
 *
 * Like `handler.ts` it takes everything from outside (store, secret,
 * Claude client, clock) so the tests run the real pipeline without a network,
 * and the local Express relay reuses it as-is. The rules themselves live in
 * `./games`; this file only checks the request, calls them and maps their
 * outcomes to HTTP.
 *
 * Any error thrown by the store becomes a 500. The guards in `./games` fail
 * closed by throwing, so an unreadable ledger can never turn into a game.
 */
import { LIMITS } from '../src/coach/protocol'
import { CLAUDE_MODELS, ZERO_USAGE, isClaudeModelKey, type ClaudeModelKey, type SideUsage } from '../src/claude/models'
import { providerOf, type ModelProvider } from '../src/claude/providers'
import { Position } from '../src/game-core/position'
import { STARTING_FEN } from '../src/game-core/types'
import type { MessagesClient } from './claude'
import type { JevClient } from './jevMove'
import type { VertexClient } from './geminiMove'
import { dispatchMove, noKeyKind } from './moveDispatch'
import {
  GAMES_LIMITS,
  authorizeMove,
  budgetLeft,
  chargeMove,
  checkGameToken,
  endGame,
  monthUsage,
  startGame,
} from './games'
import { headToHead } from './headToHead'
import type { GameStore } from './store'

export type GameEndpoint = 'start' | 'move' | 'end' | 'budget' | 'record'

/** The endpoints read with GET: no body, and a same-origin fetch of them carries no Origin. */
const GET_ENDPOINTS: ReadonlySet<GameEndpoint> = new Set(['budget', 'record'])

export interface GameDeps {
  store: GameStore
  /** Random per process; game tokens are HMACs under it. */
  secret: Buffer
  /** Random per process; a games lock taken under another boot is from a server that has restarted. */
  boot: string
  /** Null when no Anthropic key is configured. */
  client: MessagesClient | null
  /** TypeSafe's System One, for Jev seats; null or absent when no TYPESAFE_API_KEY is configured. */
  jev?: JevClient | null
  /** Vertex AI, for Gemini seats; null or absent when not configured. Seats them only while ADC works (`available`). */
  vertex?: VertexClient | null
  now?: () => number
}

const MESSAGES: Record<string, string> = {
  forbidden: 'Not allowed.',
  budget: 'The monthly Claude games budget is used up.',
  over: 'This game has reached its move limit.',
  busy: 'A game is already in progress.',
  'bad-request': 'Bad request.',
  'no-key': 'Claude is not configured.',
  'illegal-reply': 'Claude replied with an unusable move.',
  timeout: 'Claude took too long.',
  upstream: 'Claude is unavailable.',
  'rate-limited': 'Claude is rate-limiting requests.',
  'no-jev-key': 'Jev is not configured (no TYPESAFE_API_KEY).',
  'no-gemini-auth': 'Gemini is not configured (no Google Application Default Credentials).',
}

/** The same failures, worded for a Jev seat's move. */
const JEV_MESSAGES: Record<string, string> = {
  'illegal-reply': 'Jev replied with an unusable move.',
  timeout: 'Jev took too long.',
  upstream: 'Jev is unavailable.',
  'rate-limited': 'Jev is rate-limiting requests.',
}

/** And for a Gemini seat's move. */
const GEMINI_MESSAGES: Record<string, string> = {
  'illegal-reply': 'Gemini replied with an unusable move.',
  timeout: 'Gemini took too long.',
  upstream: 'Gemini is unavailable.',
  'rate-limited': 'Gemini is rate-limiting requests.',
}

const MESSAGES_FOR: Record<ModelProvider, Record<string, string>> = {
  anthropic: MESSAGES,
  typesafe: JEV_MESSAGES,
  vertex: GEMINI_MESSAGES,
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Fixed texts only: nothing from a caught error or from the request is echoed. */
const fail = (status: number, kind: string, messages: Record<string, string> = MESSAGES): Response =>
  json(status, { error: { kind, message: messages[kind] ?? MESSAGES[kind] ?? 'Error.' } })

const MOVE_STATUS: Record<string, number> = {
  forbidden: 403,
  budget: 402,
  over: 409,
  'bad-request': 400,
  'no-key': 503,
  'no-jev-key': 503,
  'no-gemini-auth': 503,
}
// Everything else (illegal-reply, timeout, upstream, rate-limited) is a 502 the browser retries.
const moveStatus = (kind: string): number => MOVE_STATUS[kind] ?? 502

/** A key (or ADC) the provider rejects is a configuration problem, not something a retry fixes: report it as no key. */
const moveKind = (kind: string, model: ClaudeModelKey): string => (kind === 'auth' ? noKeyKind(model) : kind)

/** Whether this server can reach each provider now: a key for Anthropic and TypeSafe, working ADC for Vertex AI. */
async function providersUp(deps: GameDeps): Promise<Record<ModelProvider, boolean>> {
  return {
    anthropic: deps.client !== null,
    typesafe: Boolean(deps.jev),
    vertex: deps.vertex ? await deps.vertex.available() : false,
  }
}

/** The models this server can seat, in list order: the browser disables the others. */
const seatable = (up: Record<ModelProvider, boolean>): ClaudeModelKey[] =>
  (Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]).filter((k) => up[providerOf(k)])

const MAX_HISTORY = 400
const MAX_PGN_CHARS = 20_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_HISTORY && v.every((x) => typeof x === 'string' && x.length <= 16)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000

/** `http://localhost:*`, `http://127.0.0.1:*` or `http://[::1]:*`, and nothing else (not https, not other hosts). */
export function isLoopbackOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' || u.origin !== origin) return false
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
}

export async function handleGame(endpoint: GameEndpoint, request: Request, deps: GameDeps): Promise<Response> {
  const now = deps.now?.() ?? Date.now()
  const isGet = GET_ENDPOINTS.has(endpoint)
  const wantMethod = isGet ? 'GET' : 'POST'
  if (request.method !== wantMethod) return json(405, { error: { kind: 'bad-request', message: `Use ${wantMethod}.` } })

  // Same-origin GETs carry no Origin header, so it is only judged when present; POSTs must carry a loopback one.
  const origin = request.headers.get('origin')
  if (origin !== null || !isGet) {
    if (!isLoopbackOrigin(origin)) return fail(403, 'forbidden')
  }

  let body: unknown = null
  if (!isGet) {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > LIMITS.maxBodyBytes) return fail(413, 'bad-request')
    try {
      body = JSON.parse(raw)
    } catch {
      return fail(400, 'bad-request')
    }
    if (!isRecord(body)) return fail(400, 'bad-request')
  }

  // Without any key (or working ADC) no game can be played: say so on budget (the browser's
  // readiness probe, which then disables Start) and on start (nothing is
  // reserved or locked). With one provider's key only, budget lists the
  // models it can seat and start refuses the others (see start). A begun
  // game's move/end keep their own handling, and the record only reads the
  // saved games, so it needs no key.
  const needsSeats = endpoint === 'budget' || endpoint === 'start'
  const up = needsSeats ? await providersUp(deps) : null
  if (up && !up.anthropic && !up.typesafe && !up.vertex) return fail(503, 'no-key')

  try {
    switch (endpoint) {
      case 'budget':
        return json(200, {
          budgetLeftUsd: await budgetLeft(deps.store, now),
          monthlyUsd: GAMES_LIMITS.monthlyUsd,
          ...(await monthUsage(deps.store, now)),
          models: seatable(up!),
        })
      case 'start':
        return await start(body as Record<string, unknown>, deps, up!, now)
      case 'move':
        return await move(body as Record<string, unknown>, deps, now)
      case 'end':
        return await end(body as Record<string, unknown>, deps, now)
      case 'record':
        return await record(request, deps)
    }
  } catch {
    // A store failure: not logged with detail here (it may carry request-derived text); the status says enough.
    return fail(500, 'upstream')
  }
}

async function start(
  body: Record<string, unknown>,
  deps: GameDeps,
  up: Record<ModelProvider, boolean>,
  now: number,
): Promise<Response> {
  const { white, black } = body
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return fail(400, 'bad-request')
  // Refused before anything is reserved or locked.
  for (const model of [white, black]) if (!up[providerOf(model)]) return fail(503, noKeyKind(model))
  const r = await startGame(deps.store, now, deps.secret, { white, black }, deps.boot)
  if (!r.ok) return fail(r.kind === 'busy' ? 409 : r.kind === 'budget' ? 402 : 400, r.kind)
  return json(200, { gameId: r.gameId, token: r.token, budgetLeftUsd: r.budgetLeftUsd })
}

async function move(body: Record<string, unknown>, deps: GameDeps, now: number): Promise<Response> {
  const { gameId, token, startFen, history } = body
  if (typeof gameId !== 'string' || typeof token !== 'string' || !isStringArray(history)) return fail(400, 'bad-request')
  if (startFen !== undefined && (typeof startFen !== 'string' || startFen.length > 100)) return fail(400, 'bad-request')

  // Whose move it is follows from the start position and the number of plies played.
  const start = Position.fromFen(startFen ?? STARTING_FEN)
  if (!start.ok) return fail(400, 'bad-request')
  const firstMover = start.position.turn()
  const white = (firstMover === 'w') === (history.length % 2 === 0)

  const auth = await authorizeMove(deps.store, now, deps.secret, {
    gameId,
    token,
    side: white ? 'white' : 'black',
    plies: history.length,
  })
  if (!auth.ok) return fail(moveStatus(auth.kind), auth.kind)
  const model = auth.model
  const provider = providerOf(model)
  const moveReq = { model, ...(startFen !== undefined ? { startFen } : {}), history }
  const routed = await dispatchMove(deps, moveReq)
  if ('missing' in routed) return fail(503, routed.missing)
  const { outcome } = routed
  // A reply that arrived cost money even when it was unusable: charge before answering either way.
  // Every call made counts toward the side's usage; a bad request made none.
  const side = white ? 'white' : 'black'
  const noCall: { spent: number; usage: SideUsage } = { spent: 0, usage: { w: ZERO_USAGE, b: ZERO_USAGE } }
  const { spent, usage } = outcome.tokens
    ? await chargeMove(deps.store, now, gameId, { side, costUsd: outcome.costUsd, ms: outcome.ms, ...outcome.tokens })
    : noCall
  if (!outcome.ok) {
    const kind = moveKind(outcome.kind, model)
    return fail(moveStatus(kind), kind, MESSAGES_FOR[provider])
  }
  return json(200, { san: outcome.san, why: outcome.why, costUsd: outcome.costUsd, gameSpentUsd: spent, usage })
}

async function end(body: Record<string, unknown>, deps: GameDeps, now: number): Promise<Response> {
  const { gameId, token, pgn, fallbacks } = body
  if (typeof gameId !== 'string' || typeof token !== 'string') return fail(400, 'bad-request')
  if (typeof pgn !== 'string' || pgn.length > MAX_PGN_CHARS) return fail(400, 'bad-request')
  if (!isRecord(fallbacks) || !isCount(fallbacks['w']) || !isCount(fallbacks['b'])) return fail(400, 'bad-request')
  // The lock may have lapsed by now; ending a game needs only its own token.
  if (!checkGameToken(deps.secret, gameId, token)) return fail(403, 'forbidden')
  await endGame(deps.store, now, gameId, { pgn, fallbacks: { w: fallbacks['w'], b: fallbacks['b'] } })
  return json(200, { ok: true })
}

/**
 * `GET /api/game/record?white=<key>&black=<key>`: the head-to-head of the two
 * models over the saved games (see HeadToHead in src/claude/models.ts), where
 * the model counts are for the model asked for as `white` / `black`. A saved
 * game that cannot be read is left out; a failed listing is a 500.
 */
async function record(request: Request, deps: GameDeps): Promise<Response> {
  const params = new URL(request.url).searchParams
  const white = params.get('white')
  const black = params.get('black')
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return fail(400, 'bad-request')
  return json(200, await headToHead(deps.store, white, black))
}
