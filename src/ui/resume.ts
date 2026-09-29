import { TIME_CONTROLS, type TimeControl } from '../clock/types'
import type { MatchConfig } from '../match/types'
import type { Level, StoredSetup } from '../storage/storage'
import type { Mode } from './panels/NewGame'

/**
 * What the running match's config looks like when persisted. A Claude seat
 * persists as its model key alone: no owner token, cost or game id is kept.
 */
export function setupOf(config: MatchConfig): StoredSetup | null {
  return {
    white: config.white,
    black: config.black,
    timeControl: config.timeControl,
    ...(config.engineDelayMs !== undefined ? { engineDelayMs: config.engineDelayMs } : {}),
  }
}

export interface ResumePlan {
  config: MatchConfig
  /** What the New Game panel should show, so it matches the resumed match. */
  mode: Mode
  level: Level | null
  humanColor: 'white' | 'black' | null
  timeControlId: string | null
  /**
   * True when the game cannot be resumed as it was being played (an engine
   * seat, but no engine): it is resumed two-player, and its result must NOT
   * be scored, since two-player scoring would misreport it.
   */
  degraded: boolean
  /**
   * True when the match must load paused: a game with a Claude seat never
   * asks Claude on its own after a reload (that spends money); the owner
   * resumes it, which starts a fresh server game.
   */
  paused: boolean
}

function timeControlIdOf(tc: TimeControl): string | null {
  const found = TIME_CONTROLS.find((t) =>
    t.control.kind === 'untimed'
      ? tc.kind === 'untimed'
      : tc.kind === 'timed' &&
        t.control.initialMs === tc.initialMs &&
        t.control.incrementMs === tc.incrementMs,
  )
  return found?.id ?? null
}

/**
 * Turn a stored setup back into the config to resume with — the ORIGINAL
 * mode, so a one-player game stays one-player. A missing setup (an older
 * save) falls back to two-player with the current time-control setting.
 */
export function planResume(
  setup: StoredSetup | null,
  engineAvailable: boolean,
  fallbackTimeControl: TimeControl,
): ResumePlan {
  const twoPlayer = (timeControl: TimeControl, degraded: boolean): ResumePlan => ({
    config: { white: { kind: 'human' }, black: { kind: 'human' }, timeControl },
    mode: 'two-player',
    level: null,
    humanColor: null,
    timeControlId: timeControlIdOf(timeControl),
    degraded,
    paused: false,
  })

  if (!setup) return twoPlayer(fallbackTimeControl, false)

  const { white, black, timeControl } = setup
  if (white.kind === 'claude' || black.kind === 'claude') {
    // Claude needs no local engine; a Claude game is not a scored engine game
    // either, so the mode shown is the neutral one until Task 8 adds its own.
    return {
      config: {
        white,
        black,
        timeControl,
        ...(setup.engineDelayMs !== undefined ? { engineDelayMs: setup.engineDelayMs } : {}),
      },
      mode: 'two-player',
      level: null,
      humanColor: null,
      timeControlId: timeControlIdOf(timeControl),
      degraded: false,
      paused: true,
    }
  }
  const engineSeat = white.kind === 'engine' ? white : black.kind === 'engine' ? black : null
  if (!engineSeat) return twoPlayer(timeControl, false)
  if (!engineAvailable) return twoPlayer(timeControl, true)

  const zeroPlayer = white.kind === 'engine' && black.kind === 'engine'
  return {
    config: {
      white,
      black,
      timeControl,
      // Zero-player defaults to the same 500ms pace a New Game uses.
      ...(setup.engineDelayMs !== undefined
        ? { engineDelayMs: setup.engineDelayMs }
        : zeroPlayer
          ? { engineDelayMs: 500 }
          : {}),
    },
    mode: zeroPlayer ? 'zero-player' : 'one-player',
    level: engineSeat.level,
    humanColor: zeroPlayer ? null : white.kind === 'human' ? 'white' : 'black',
    timeControlId: timeControlIdOf(timeControl),
    degraded: false,
    paused: false,
  }
}
