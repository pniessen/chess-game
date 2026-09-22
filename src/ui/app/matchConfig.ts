import type { MatchConfig } from '../../match/types'
import type { Level } from '../../storage/storage'
import { TIME_CONTROLS } from '../../clock/types'
import type { Mode } from '../panels/NewGame'

export function timeControlFor(id: string) {
  return TIME_CONTROLS.find((t) => t.id === id)?.control ?? { kind: 'untimed' as const }
}

export function buildConfig(opts: {
  mode: Mode
  level: Level
  timeControlId: string
  color: 'white' | 'black'
  engineAvailable: boolean
}): MatchConfig {
  const timeControl = timeControlFor(opts.timeControlId)
  if (opts.mode === 'two-player' || !opts.engineAvailable) {
    return { white: { kind: 'human' }, black: { kind: 'human' }, timeControl }
  }
  if (opts.mode === 'zero-player') {
    return {
      white: { kind: 'engine', level: opts.level },
      black: { kind: 'engine', level: opts.level },
      timeControl,
      engineDelayMs: 500,
    }
  }
  const humanIsWhite = opts.color === 'white'
  return {
    white: humanIsWhite ? { kind: 'human' } : { kind: 'engine', level: opts.level },
    black: humanIsWhite ? { kind: 'engine', level: opts.level } : { kind: 'human' },
    timeControl,
  }
}
