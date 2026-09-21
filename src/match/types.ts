import type { ClockState, TimeControl } from '../clock/types'
import type { Game } from '../game-core/game'
import type { Color, GameStatus } from '../game-core/types'
import type { Level } from '../storage/storage'

export type Seat = { kind: 'human' } | { kind: 'engine'; level: Level }

export interface MatchConfig {
  white: Seat
  black: Seat
  timeControl: TimeControl
  startFen?: string
  /** Pause between engine moves in a zero-player game (the speed slider). */
  engineDelayMs?: number
}

export type FinishReason = 'normal' | 'flag' | 'resign' | 'engine-error'

export type MatchPhase =
  | { kind: 'idle' }
  | { kind: 'awaiting-human'; side: Color }
  | { kind: 'engine-thinking'; side: Color; requestId: number }
  | { kind: 'paused' }
  | { kind: 'finished'; status: GameStatus; reason: FinishReason; winner: Color | null }

export interface MatchSnapshot {
  phase: MatchPhase
  game: Game
  clock: ClockState
  config: MatchConfig
}
