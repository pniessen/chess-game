import type { Color } from '../game-core/types'
import type { MatchConfig, MatchPhase } from './types'

/** The PGN result of a match: decided by phase.winner, never by status alone (resign/flag). */
export function resultTagOf(phase: MatchPhase): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (phase.kind !== 'finished' || phase.reason === 'engine-error') return '*'
  return phase.winner === 'w' ? '1-0' : phase.winner === 'b' ? '0-1' : '1/2-1/2'
}

/** The single human side in a one-player game; null for two- or zero-player. */
export function humanSideOf(config: MatchConfig): Color | null {
  const w = config.white.kind === 'human'
  const b = config.black.kind === 'human'
  if (w === b) return null
  return w ? 'w' : 'b'
}
