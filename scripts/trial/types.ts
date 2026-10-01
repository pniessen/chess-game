/**
 * The round-robin trial's on-disk shapes. Local only: nothing under
 * scripts/trial is imported by src/, so none of it reaches a bundle.
 */
import type { ClaudeModelKey } from '../../src/claude/models'
import type { Color } from '../../src/game-core/types'

/** An engine score from the side to move's point of view: centipawns, or mate in N (negative: being mated). */
export type Score = { cp: number } | { mate: number }

/** How a game ended. The first five are the rules; the last three are the trial's own. */
export type Termination =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  /** The ply cap was reached and Stockfish judged the final position. */
  | 'adjudicated'
  /** A seat could not go on, as in the app: 5 fallbacks, a missing or rejected key, or an unusable fallback. */
  | 'model-unavailable'
  /** The trial's hard spending cap stopped the game before its next call. Not saved as finished. */
  | 'cap'

export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'

/** One call to a model's API, as the move functions report it. */
export interface CallRecord {
  /** 'ok', or the failure kind (timeout, rate-limited, illegal-reply, upstream, auth, bad-request). */
  kind: string
  ms: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export interface MoveRecord {
  /** 1-based: ply 1 is White's first move. */
  ply: number
  side: Color
  /** The seat's model, also for a Stockfish fallback move (it counts against the model). */
  model: ClaudeModelKey
  san: string
  /** Stockfish played it after the model failed twice. */
  fallback: boolean
  /** The model's reason (empty for a fallback). */
  why: string
  /** The model's wall time for this move: every call made for it, back-offs and fallback search excluded. */
  ms: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  calls: CallRecord[]
}

export interface SideTotals {
  costUsd: number
  ms: number
  inputTokens: number
  outputTokens: number
  calls: number
  /** Moves this side played, fallbacks included. */
  moves: number
  fallbacks: number
  timeouts: number
  rateLimited: number
  illegalReplies: number
}

export interface Adjudication {
  depth: number
  /** White's point of view; null when the score was a mate. */
  evalCp: number | null
  /** Mate in N from White's point of view (negative: Black mates); null for a centipawn score. */
  mate: number | null
}

export interface GameRecord {
  v: 1
  trialId: string
  gameId: string
  /** The pairing's game number, 1-based. */
  round: number
  white: ClaudeModelKey
  black: ClaudeModelKey
  startedAt: string
  finishedAt: string
  wallMs: number
  maxPlies: number
  result: GameResult
  winner: Color | null
  termination: Termination
  adjudication?: Adjudication
  /** For model-unavailable: whose seat, and why. */
  unavailable?: { side: Color; reason: string }
  plies: number
  moves: MoveRecord[]
  pgn: string
  totals: { w: SideTotals; b: SideTotals }
}

/** The trial's settings, written once at its first run (trial.json). */
export interface TrialConfig {
  v: 1
  trialId: string
  createdAt: string
  models: ClaudeModelKey[]
  gamesPerPair: number
  capUsd: number
  maxPlies: number
  concurrency: number
}

/** One line of the trial's own ledger (ledger.jsonl): every charged call, and each commentary call. */
export interface LedgerEntry {
  t: string
  kind: 'move' | 'commentary'
  model: ClaudeModelKey | string
  gameId?: string
  /** A move line: 'ok' or the call's failure kind. */
  outcome?: string
  /** A commentary line: the model it was written about. */
  about?: ClaudeModelKey
  costUsd: number
  inputTokens: number
  outputTokens: number
  ms: number
}
