/**
 * One move from TypeSafe's Jev, through its System One API: the legal moves
 * become the criteria of a single `choice` question, so Jev can only ever
 * pick a listed move. Same outcome shape as a Claude move (./claudeMove), so
 * the ledger, the usage totals and the browser treat the two alike.
 *
 * Contract: docs.typesafe.ai/api.md and /primitives/choice.md (read 2026-09-30).
 * The key lives only in createJevClient's closure and the request header;
 * it is never in a request body, an outcome, a log line or the browser.
 */
import { Chess, type Move } from 'chess.js'
import { MOVE_TIMEOUT_MS, CLAUDE_MODELS, costUsd, estimateInputTokens, type ClaudeModelKey } from '../src/claude/models'
import { Position } from '../src/game-core/position'
import { STARTING_FEN } from '../src/game-core/types'
import { numberedMoves } from '../src/review/moveNumber'
import type { MoveOutcome } from './claudeMove'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** System One, as the move code needs it: one POST of a JSON body. Injectable so tests never touch the network. */
export interface JevClient {
  systemone(body: unknown): Promise<Response>
}

/**
 * The real client. `fetch` is injectable for tests; `timeoutMs` (default
 * MOVE_TIMEOUT_MS, like a Claude move) aborts the request, which rejects
 * with a `TimeoutError`.
 */
export function createJevClient(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): JevClient {
  const { apiKey } = opts
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = opts.timeoutMs ?? MOVE_TIMEOUT_MS
  return {
    systemone: (body) =>
      fetchImpl(JEV_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      }),
  }
}

const PIECE: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

/** "Bxf7+: bishop from c4 to f7, capturing a pawn, check" — a criterion's description. */
export function describeMove(m: Pick<Move, 'san' | 'piece' | 'from' | 'to'> & { captured?: string; promotion?: string }): string {
  const parts = [`${m.san}: ${PIECE[m.piece]} from ${m.from} to ${m.to}`]
  if (m.san.startsWith('O-O')) parts.push('castling')
  if (m.captured) parts.push(`capturing a ${PIECE[m.captured]}`)
  if (m.promotion) parts.push(`promoting to ${PIECE[m.promotion]}`)
  if (m.san.includes('#')) parts.push('checkmate')
  else if (m.san.includes('+')) parts.push('check')
  return parts.join(', ')
}

type Failure = Extract<MoveOutcome, { ok: false }>['kind']

/** An HTTP refusal, by status (docs: 401 bad key, 422 validation, 429 rate limit, 529 overloaded). */
function kindOfStatus(status: number): Failure {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429 || status === 529) return 'rate-limited'
  return 'upstream'
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

/** Distributes over the union, unlike Omit. */
type WithoutMs<T> = T extends unknown ? Omit<T, 'ms'> : never

/** Ask Jev for one move. `req.model` is always 'jev'; it is taken for symmetry with requestMove. */
export async function requestJevMove(
  deps: { jev: JevClient },
  req: { model: ClaudeModelKey; startFen?: string; history: string[] },
): Promise<MoveOutcome> {
  const started = Date.now()
  const done = (o: WithoutMs<MoveOutcome>): MoveOutcome => ({ ...o, ms: Date.now() - started }) as MoveOutcome
  const bad = () => done({ ok: false, kind: 'bad-request', costUsd: 0, tokens: null })

  const startFen = req.startFen ?? STARTING_FEN
  if (!Position.fromFen(startFen).ok) return bad()
  const pos = new Position(startFen)
  const firstMover = pos.turn()
  for (const san of req.history) {
    if (!pos.trySan(san).ok) return bad()
  }
  if (pos.status().kind !== 'in-progress') return bad()
  const chess = new Chess(pos.fen())
  const moves = chess.moves({ verbose: true })
  if (moves.length === 0) return bad()

  const side = chess.turn() === 'w' ? 'White' : 'Black'
  const criteria: Record<string, string> = {}
  moves.forEach((m, i) => {
    criteria[`m${i}`] = describeMove(m)
  })
  const body = {
    model: CLAUDE_MODELS.jev.id,
    state: {
      fen: chess.fen(),
      side_to_move: side,
      board: chess.ascii(),
      moves_so_far: req.history.length ? numberedMoves(req.history, firstMover) : '(none)',
      ...(req.startFen !== undefined && req.startFen !== STARTING_FEN ? { start_fen: req.startFen } : {}),
    },
    questions: {
      move: {
        type: 'choice',
        instructions: `You are playing chess as ${side}. Choose the strongest legal move in this position: win material, deliver checkmate, and avoid losing pieces. The game so far is in \`moves_so_far\`; a position that repeats three times is a draw.`,
        criteria,
      },
    },
  }

  // Only a timeout may still be billed (the request reached TypeSafe and was abandoned here):
  // charge its input, estimated from the body; output tokens are free. The timeout signal also
  // covers reading the body, so it can fire on either await below.
  const isTimeout = (err: unknown) => err instanceof Error && err.name === 'TimeoutError'
  const timedOut = () => {
    const inputTokens = estimateInputTokens(JSON.stringify(body).length)
    return done({
      ok: false,
      kind: 'timeout',
      costUsd: costUsd('jev', { input_tokens: inputTokens, output_tokens: 0 }),
      tokens: { inputTokens, outputTokens: 0 },
    })
  }

  let res: Response
  try {
    res = await deps.jev.systemone(body)
  } catch (err) {
    if (isTimeout(err)) return timedOut()
    // A network failure is free.
    return done({ ok: false, kind: 'upstream', costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })
  }
  // A refusal is not billed; nothing from its body is kept (it may echo the request).
  if (!res.ok) return done({ ok: false, kind: kindOfStatus(res.status), costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })

  let payload: unknown = null
  try {
    payload = await res.json()
  } catch (err) {
    if (isTimeout(err)) return timedOut()
    // Not JSON: an unusable reply.
  }
  const usage = isRecord(payload) && isRecord(payload['usage']) ? payload['usage'] : {}
  const tokens = { inputTokens: count(usage['input_tokens']), outputTokens: count(usage['output_tokens']) }
  const cost = costUsd('jev', { input_tokens: tokens.inputTokens, output_tokens: tokens.outputTokens })

  const answers = isRecord(payload) && isRecord(payload['answers']) ? payload['answers'] : {}
  const answer = isRecord(answers['move']) ? answers['move'] : {}
  const choice = answer['choice']
  const picked = typeof choice === 'string' && /^m\d+$/.test(choice) ? moves[Number(choice.slice(1))] : undefined
  if (!picked || typeof choice !== 'string') return done({ ok: false, kind: 'illegal-reply', costUsd: cost, tokens })

  // Jev gives no reason, only a probability: say that much and nothing more.
  const probs = isRecord(answer['probabilities']) ? answer['probabilities'] : {}
  const p = probs[choice]
  const why = typeof p === 'number' && Number.isFinite(p) ? `Jev's pick (p ${p.toFixed(2)})` : "Jev's pick"
  return done({ ok: true, san: picked.san, why, costUsd: cost, tokens })
}
