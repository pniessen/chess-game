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
import { isClaudeModelKey } from '../src/claude/models'
import { Position } from '../src/game-core/position'
import { STARTING_FEN } from '../src/game-core/types'
import type { MessagesClient } from './claude'
import { requestMove } from './claudeMove'
import {
  GAMES_LIMITS,
  authorizeMove,
  budgetLeft,
  chargeMove,
  checkGameToken,
  endGame,
  startGame,
} from './games'
import type { GameStore } from './store'

export type GameEndpoint = 'start' | 'move' | 'end' | 'budget'

export interface GameDeps {
  store: GameStore
  /** Random per process; game tokens are HMACs under it. */
  secret: Buffer
  /** Null when no Anthropic key is configured. */
  client: MessagesClient | null
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
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** Fixed texts only: nothing from a caught error or from the request is echoed. */
const fail = (status: number, kind: string): Response =>
  json(status, { error: { kind, message: MESSAGES[kind] ?? 'Error.' } })

const MOVE_STATUS: Record<string, number> = {
  forbidden: 403,
  budget: 402,
  over: 409,
  'bad-request': 400,
  'no-key': 503,
}
// Everything else (illegal-reply, timeout, upstream, rate-limited) is a 502 the browser retries.
const moveStatus = (kind: string): number => MOVE_STATUS[kind] ?? 502

/** A key Anthropic rejects is a configuration problem, not something a retry fixes: report it as no key. */
const moveKind = (kind: string): string => (kind === 'auth' ? 'no-key' : kind)

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
  const wantMethod = endpoint === 'budget' ? 'GET' : 'POST'
  if (request.method !== wantMethod) return json(405, { error: { kind: 'bad-request', message: `Use ${wantMethod}.` } })

  // Same-origin GETs carry no Origin header, so it is only judged when present; POSTs must carry a loopback one.
  const origin = request.headers.get('origin')
  if (origin !== null || endpoint !== 'budget') {
    if (!isLoopbackOrigin(origin)) return fail(403, 'forbidden')
  }

  let body: unknown = null
  if (endpoint !== 'budget') {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > LIMITS.maxBodyBytes) return fail(413, 'bad-request')
    try {
      body = JSON.parse(raw)
    } catch {
      return fail(400, 'bad-request')
    }
    if (!isRecord(body)) return fail(400, 'bad-request')
  }

  try {
    switch (endpoint) {
      case 'budget':
        return json(200, { budgetLeftUsd: await budgetLeft(deps.store, now), monthlyUsd: GAMES_LIMITS.monthlyUsd })
      case 'start':
        return await start(body as Record<string, unknown>, deps, now)
      case 'move':
        return await move(body as Record<string, unknown>, deps, now)
      case 'end':
        return await end(body as Record<string, unknown>, deps, now)
    }
  } catch {
    // A store failure: not logged with detail here (it may carry request-derived text); the status says enough.
    return fail(500, 'upstream')
  }
}

async function start(body: Record<string, unknown>, deps: GameDeps, now: number): Promise<Response> {
  const { white, black } = body
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return fail(400, 'bad-request')
  const r = await startGame(deps.store, now, deps.secret, { white, black })
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
  if (!deps.client) return fail(503, 'no-key')

  const outcome = await requestMove(
    { client: deps.client },
    { model: auth.model, ...(startFen !== undefined ? { startFen } : {}), history },
  )
  // A reply that arrived cost money even when it was unusable: charge before answering either way.
  const spent = await chargeMove(deps.store, now, gameId, outcome.costUsd)
  if (!outcome.ok) return fail(moveStatus(moveKind(outcome.kind)), moveKind(outcome.kind))
  return json(200, { san: outcome.san, why: outcome.why, costUsd: outcome.costUsd, gameSpentUsd: spent })
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
