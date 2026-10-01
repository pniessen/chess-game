// The Claude-vs-Claude model allow-list. Dependency-free on purpose: the
// browser sends only these keys, and both the server and the UI import this file.
// Despite the name it also lists one non-Claude model, Jev, which takes a
// seat like any other: same ledger, usage, head-to-head and UI. Whose API
// answers a seat lives in ./providers, which public builds never import.

export type ClaudeModelKey = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'jev'

export interface ClaudeModel {
  id: string
  label: string
  /** USD per million input tokens. */
  priceIn: number
  /** USD per million output tokens. */
  priceOut: number
  /**
   * The lowest `output_config.effort` the model accepts. Absent for Haiku 4.5:
   * the claude-api skill says `effort` errors on it, so the field is not sent.
   */
  effort?: 'low'
}

// List prices are the claude-api skill's cached table (cached 2026-09-25,
// read 2026-09-29), first-party API, standard (non-fast, non-cached) rates.
// Haiku 4.5's $1 / $5 is the skill's `claude-haiku-4-5` row; the dated id
// `claude-haiku-4-5-20251001` is the same model.
//
// Jev's price is docs.typesafe.ai/models.md (read 2026-09-30): "$42 / $0.042"
// per Btok / per Mtok, "Charged per input token. Output tokens are free."
// `jev-latest` is an alias (jev-1.13.0 on that date), so its label carries no
// version; the seat picker adds its maker (seatLabel in ./providers).
export const CLAUDE_MODELS: Record<ClaudeModelKey, ClaudeModel> = {
  fable: { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', priceIn: 10, priceOut: 50, effort: 'low' },
  opus: { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', priceIn: 4, priceOut: 20, effort: 'low' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', priceIn: 2, priceOut: 10, effort: 'low' },
  haiku: { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', priceIn: 1, priceOut: 5 },
  jev: { id: 'jev-latest', label: 'Jev', priceIn: 0.042, priceOut: 0 },
}

/** The label without its "Claude " prefix ("Opus 5.5", "Jev"), for the clocks and the thinking line. */
export function shortModelLabel(key: ClaudeModelKey): string {
  return CLAUDE_MODELS[key].label.replace(/^Claude /, '')
}

export function isClaudeModelKey(v: unknown): v is ClaudeModelKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CLAUDE_MODELS, v)
}

/**
 * What a Claude seat's calls to Anthropic added up to: every call made for it,
 * a retried or timed-out one included (the pacing delay and Stockfish fallback
 * moves are not calls). `ms` is the server's wall time around each call;
 * `outputTokens` includes thinking. Kept per side of a game and per model per month.
 */
export interface Usage {
  costUsd: number
  ms: number
  inputTokens: number
  outputTokens: number
  /** Calls made; the divisor for per-move averages. */
  calls: number
}

export const ZERO_USAGE: Usage = Object.freeze({ costUsd: 0, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0 })

/** Usage per side of a game, keyed like the board's colours. */
export interface SideUsage {
  w: Usage
  b: Usage
}

/** Usage per model, only for models that have any. */
export type UsageByModel = Partial<Record<ClaudeModelKey, Usage>>

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** A stored or received usage, field by field: anything missing or malformed reads as zero. */
export function parseUsage(v: unknown): Usage {
  if (!isObject(v)) return { ...ZERO_USAGE }
  return {
    costUsd: finite(v['costUsd']),
    ms: finite(v['ms']),
    inputTokens: finite(v['inputTokens']),
    outputTokens: finite(v['outputTokens']),
    calls: finite(v['calls']),
  }
}

export function parseSideUsage(v: unknown): SideUsage {
  const o = isObject(v) ? v : {}
  return { w: parseUsage(o['w']), b: parseUsage(o['b']) }
}

/** Only known model keys with an object value are kept. */
export function parseUsageByModel(v: unknown): UsageByModel {
  const out: UsageByModel = {}
  if (!isObject(v)) return out
  for (const key of Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]) {
    if (isObject(v[key])) out[key] = parseUsage(v[key])
  }
  return out
}

/** Dollars for one response, from its `usage` and the list price. */
export function costUsd(key: ClaudeModelKey, usage: { input_tokens: number; output_tokens: number }): number {
  const m = CLAUDE_MODELS[key]
  return (usage.input_tokens * m.priceIn + usage.output_tokens * m.priceOut) / 1_000_000
}

/**
 * A conservative input-token count for text we never got `usage` for:
 * characters / 3.5, rounded up. English-and-SAN prompts run nearer 4
 * characters a token, so this over-counts slightly, which is the safe side.
 */
export function estimateInputTokens(promptChars: number): number {
  return Math.ceil(promptChars / 3.5)
}

/**
 * Dollars charged for a move request that timed out. The client abandoned the
 * call but the API may still finish and bill it, so the ledger assumes the
 * worst: the estimated input plus the whole `maxTokens` output cap.
 */
export function timeoutCostUsd(key: ClaudeModelKey, promptChars: number, maxTokens: number): number {
  return costUsd(key, timeoutTokens(promptChars, maxTokens))
}

/** The tokens a timed-out request is charged for (an estimate: its real `usage` never arrived). */
export function timeoutTokens(promptChars: number, maxTokens: number): { input_tokens: number; output_tokens: number } {
  return { input_tokens: estimateInputTokens(promptChars), output_tokens: maxTokens }
}

/**
 * Plies after which a Claude game is drawn by adjudication (spec Q12): 160
 * plies, i.e. 80 moves each. The browser's controller adjudicates when the
 * live ply count reaches it; the server refuses a move request at it (409)
 * as a backstop.
 */
export const CLAUDE_MAX_PLIES = 160

/** Wall-clock bound for one move request (the SDK timeout, in ms). */
export const MOVE_TIMEOUT_MS = 45_000

/**
 * How long the browser trusts a Claude game's server session without
 * contact. The server's one-game lock lapses 30 minutes after the last
 * authorised move (netlify/lib/games.ts `lockTtlMs`); past this the browser
 * treats its session as closed and begins a new one on Resume or Step,
 * instead of sending a move the server would refuse. Five minutes short of
 * the lock, which covers a whole move timeout and clock skew.
 */
export const CLAUDE_SESSION_IDLE_MS = 25 * 60_000

/**
 * Dollars held back per side for one game, sized to reach the 160-ply cap
 * (80 moves a side). Measured 2026-09-29 against the API directly (plan Task
 * 10): the dearest opening move was fable $0.0086, opus $0.0036, sonnet
 * $0.0018, haiku $0.0008, and a move's cost grows with the history in its
 * prompt — a 102-ply Haiku game's dearest move was $0.00135, 1.7x its opening
 * one. So each reserve is 80 moves x the dearest opening move x 1.75 for that
 * growth x 1.25 margin, rounded to the cent. The first, estimated values
 * (0.11 sonnet, 0.06 haiku) would have stopped a Haiku game near ply 130 with
 * "budget used up". Retune from the ledger's saved games if play drifts.
 */
export const RESERVE_PER_GAME_USD: Record<ClaudeModelKey, number> = {
  fable: 1.5,
  opus: 0.63,
  sonnet: 0.32,
  haiku: 0.14,
  // Jev's prompt carries the position and the legal moves, not the history, so
  // it does not grow over a game: the 2026-09-30 spike's largest was 1,305
  // input tokens. 80 moves x 3,000 tokens x $0.042/Mtok is $0.0101: two cents.
  jev: 0.02,
}

/**
 * The head-to-head record of the two models on the board, over every saved
 * Claude game between them (either colour order) that reached a result.
 * `GET /api/game/record?white=<key>&black=<key>` answers it.
 *
 * - `whiteModelWins` / `blackModelWins`: wins of the model asked for as
 *   `white` / as `black`, whichever colour it had in each game.
 * - `whiteWins` / `blackWins`: wins by colour over the same games. For a
 *   mirror match (one model on both sides) these are the meaningful pair, and
 *   the model counts equal them.
 * - `games` is wins plus draws; unfinished (`*`) and abandoned games are not in it.
 */
export interface HeadToHead {
  games: number
  whiteModelWins: number
  blackModelWins: number
  draws: number
  whiteWins: number
  blackWins: number
}
