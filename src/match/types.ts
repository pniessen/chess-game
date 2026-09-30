import { ZERO_USAGE, type ClaudeModelKey, type SideUsage } from '../claude/models'
import type { ClockState, TimeControl } from '../clock/types'
import type { Game } from '../game-core/game'
import type { Color, GameStatus } from '../game-core/types'
import type { Level } from '../storage/storage'

export type Seat =
  | { kind: 'human' }
  | { kind: 'engine'; level: Level }
  | { kind: 'claude'; model: ClaudeModelKey }

/** Anything the controller moves for (an engine or Claude), i.e. not a human. */
export function isBotSeat(seat: Seat): boolean {
  return seat.kind !== 'human'
}

export interface MatchConfig {
  white: Seat
  black: Seat
  timeControl: TimeControl
  startFen?: string
  /** Pause between engine moves in a zero-player game (the speed slider). */
  engineDelayMs?: number
}

/**
 * 'adjudicated': a game with a Claude seat reached CLAUDE_MAX_PLIES and was
 * declared drawn (spec Q12) — a result, unlike the two aborts.
 */
export type FinishReason = 'normal' | 'flag' | 'resign' | 'engine-error' | 'claude-unavailable' | 'adjudicated'

/**
 * Why a 'claude-unavailable' finish happened, when it is not simply "Claude
 * failed": the server's 402 ('budget'), or a 403 on a begun game — the local
 * server restarted and no longer knows it ('server-restarted').
 */
export type FinishDetail = 'budget' | 'server-restarted'

export type MatchPhase =
  | { kind: 'idle' }
  | { kind: 'awaiting-human'; side: Color }
  | { kind: 'engine-thinking'; side: Color; requestId: number }
  | { kind: 'paused' }
  | { kind: 'finished'; status: GameStatus; reason: FinishReason; winner: Color | null; detail?: FinishDetail }

export interface MatchSnapshot {
  phase: MatchPhase
  game: Game
  clock: ClockState
  config: MatchConfig
  /** Claude-seat bookkeeping; `notes` is empty and the counts zero when no Claude seat played. */
  claude: ClaudeSnapshot
}

export interface ClaudeNote {
  /** Claude's short rationale; '' for a Stockfish fallback move. */
  why: string
  /** True when Stockfish played this ply in Claude's place. */
  fallback: boolean
}

export interface ClaudeSnapshot {
  /** Keyed by ply index (0 = the first move of the game record). */
  notes: Readonly<Record<number, ClaudeNote>>
  /** The server's last reported running total for this game, in dollars. */
  spentUsd: number
  /** Stockfish moves played in Claude's place, per side, this game. */
  fallbacks: { w: number; b: number }
  /**
   * The server's last reported per-side usage for this game (cost, model
   * time, tokens, calls), under the same rules as `spentUsd`.
   */
  usage: SideUsage
}

/** The `claude` snapshot of a game no Claude seat has touched. Shared and frozen: replace, never mutate. */
export const NO_CLAUDE: ClaudeSnapshot = Object.freeze({
  notes: Object.freeze({}),
  spentUsd: 0,
  fallbacks: Object.freeze({ w: 0, b: 0 }),
  usage: Object.freeze({ w: ZERO_USAGE, b: ZERO_USAGE }),
})
