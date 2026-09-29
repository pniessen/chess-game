import type { MatchConfig } from '../../match/types'
import type { Level } from '../../storage/storage'
import { TIME_CONTROLS } from '../../clock/types'
import type { Mode } from '../panels/NewGame'
import { RESERVE_PER_GAME_USD, type ClaudeModelKey } from '../../claude/models'

/** The pace a zero-player game (engines or Claude) starts at. */
const ZERO_PLAYER_DELAY_MS = 500

/**
 * What a Claude vs Claude game is expected to cost: the per-game reserves are
 * the brainstorm's per-side estimates x1.5, so dividing their sum by 1.5 gives
 * the estimate back.
 */
export function claudeEstimateUsd(white: ClaudeModelKey, black: ClaudeModelKey): number {
  return (RESERVE_PER_GAME_USD[white] + RESERVE_PER_GAME_USD[black]) / 1.5
}

export function timeControlFor(id: string) {
  return TIME_CONTROLS.find((t) => t.id === id)?.control ?? { kind: 'untimed' as const }
}

export function buildConfig(opts: {
  mode: Mode
  level: Level
  timeControlId: string
  color: 'white' | 'black'
  engineAvailable: boolean
  claudeWhite?: ClaudeModelKey
  claudeBlack?: ClaudeModelKey
}): MatchConfig {
  const timeControl = timeControlFor(opts.timeControlId)
  if (opts.mode === 'two-player' || !opts.engineAvailable) {
    return { white: { kind: 'human' }, black: { kind: 'human' }, timeControl }
  }
  if (opts.mode === 'claude-vs-claude') {
    // Untimed only (spec Q7), whatever the time-control select says.
    return {
      white: { kind: 'claude', model: opts.claudeWhite ?? 'haiku' },
      black: { kind: 'claude', model: opts.claudeBlack ?? 'haiku' },
      timeControl: { kind: 'untimed' },
      engineDelayMs: ZERO_PLAYER_DELAY_MS,
    }
  }
  if (opts.mode === 'zero-player') {
    return {
      white: { kind: 'engine', level: opts.level },
      black: { kind: 'engine', level: opts.level },
      timeControl,
      engineDelayMs: ZERO_PLAYER_DELAY_MS,
    }
  }
  const humanIsWhite = opts.color === 'white'
  return {
    white: humanIsWhite ? { kind: 'human' } : { kind: 'engine', level: opts.level },
    black: humanIsWhite ? { kind: 'engine', level: opts.level } : { kind: 'human' },
    timeControl,
  }
}
