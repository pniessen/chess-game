import type { Game } from '../../game-core/game'
import { exportPgn } from '../../game-core/io'
import { resultTagOf } from '../../match/result'
import type { MatchConfig, MatchPhase, Seat } from '../../match/types'
import type { HistoryEntry } from '../../storage/storage'

export function seatLabel(seat: Seat): string {
  return seat.kind === 'human' ? 'Human' : `Stockfish (level ${seat.level})`
}

export function newHistoryId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** The history record for a just-finished match, or null if it should not be kept. */
export function historyEntryFor(opts: {
  phase: MatchPhase
  game: Game
  config: MatchConfig
  opening: string | null
  now: Date
  id: string
}): HistoryEntry | null {
  const { phase, game, config } = opts
  if (phase.kind !== 'finished' || phase.reason === 'engine-error' || game.moves.length === 0) return null
  const result = resultTagOf(phase)
  if (result === '*') return null
  const white = seatLabel(config.white)
  const black = seatLabel(config.black)
  return {
    id: opts.id,
    date: opts.now.toISOString(),
    result,
    termination: phase.reason === 'normal' ? 'normal' : phase.reason,
    opening: opts.opening,
    pgn: exportPgn(game, { White: white, Black: black, Result: result }),
    accuracy: null,
    white,
    black,
  }
}
