import type { TimeControl } from '../clock/types'

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Settings {
  level: Level
  timeControlId: string
  orientation: 'white' | 'black'
  soundEnabled: boolean
  themeId: string
  showEval: boolean
}

export interface MatchScore {
  wins: number
  losses: number
  draws: number
}

export const DEFAULT_SETTINGS: Settings = {
  level: 3,
  timeControlId: 'untimed',
  orientation: 'white',
  soundEnabled: true,
  themeId: 'classic',
  showEval: true,
}

const KEYS = {
  settings: 'chess-game:settings',
  score: 'chess-game:score',
  inProgress: 'chess-game:in-progress',
} as const

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is acceptable;
    // crashing the game is not.
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function loadSettings(): Settings {
  const raw = readJson(KEYS.settings)
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS }
  const level = raw['level']
  const orientation = raw['orientation']
  return {
    level:
      typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 8
        ? (level as Level)
        : DEFAULT_SETTINGS.level,
    timeControlId:
      typeof raw['timeControlId'] === 'string'
        ? raw['timeControlId']
        : DEFAULT_SETTINGS.timeControlId,
    orientation:
      orientation === 'white' || orientation === 'black'
        ? orientation
        : DEFAULT_SETTINGS.orientation,
    soundEnabled:
      typeof raw['soundEnabled'] === 'boolean'
        ? raw['soundEnabled']
        : DEFAULT_SETTINGS.soundEnabled,
    themeId: typeof raw['themeId'] === 'string' ? raw['themeId'] : DEFAULT_SETTINGS.themeId,
    showEval: typeof raw['showEval'] === 'boolean' ? raw['showEval'] : DEFAULT_SETTINGS.showEval,
  }
}

export function saveSettings(s: Settings): void {
  writeJson(KEYS.settings, s)
}

export function loadScore(): MatchScore {
  const raw = readJson(KEYS.score)
  if (!isRecord(raw)) return { wins: 0, losses: 0, draws: 0 }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return { wins: num(raw['wins']), losses: num(raw['losses']), draws: num(raw['draws']) }
}

export function saveScore(s: MatchScore): void {
  writeJson(KEYS.score, s)
}

/** A seat as persisted with an in-progress game. */
export type StoredSeat = { kind: 'human' } | { kind: 'engine'; level: Level }

/**
 * How the in-progress game was being played, so a resume restores the
 * ORIGINAL mode (a one-player game must not come back as two-player, where
 * any decisive result would be scored as a "win").
 */
export interface StoredSetup {
  white: StoredSeat
  black: StoredSeat
  timeControl: TimeControl
  engineDelayMs?: number
}

export interface InProgressGame {
  pgn: string
  /** Null when not recorded (an older save) or unreadable: resume as two-player. */
  setup: StoredSetup | null
  /** True once this game's result has already been counted on the scoreboard. */
  scored: boolean
}

function isLevel(v: unknown): v is Level {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 8
}

function parseSeat(v: unknown): StoredSeat | null {
  if (!isRecord(v)) return null
  if (v['kind'] === 'human') return { kind: 'human' }
  if (v['kind'] === 'engine' && isLevel(v['level'])) return { kind: 'engine', level: v['level'] }
  return null
}

function parseTimeControl(v: unknown): TimeControl | null {
  if (!isRecord(v)) return null
  if (v['kind'] === 'untimed') return { kind: 'untimed' }
  const initialMs = v['initialMs']
  const incrementMs = v['incrementMs']
  if (
    v['kind'] === 'timed' &&
    typeof initialMs === 'number' && Number.isFinite(initialMs) && initialMs > 0 &&
    typeof incrementMs === 'number' && Number.isFinite(incrementMs) && incrementMs >= 0
  ) {
    return { kind: 'timed', initialMs, incrementMs }
  }
  return null
}

function parseSetup(v: unknown): StoredSetup | null {
  if (!isRecord(v)) return null
  const white = parseSeat(v['white'])
  const black = parseSeat(v['black'])
  const timeControl = parseTimeControl(v['timeControl'])
  if (!white || !black || !timeControl) return null
  const delay = v['engineDelayMs']
  return typeof delay === 'number' && Number.isFinite(delay) && delay >= 0
    ? { white, black, timeControl, engineDelayMs: delay }
    : { white, black, timeControl }
}

/**
 * The saved in-progress game, or null if there is none (or it is unusable).
 *
 * Two stored shapes are accepted: the current `{ v: 2, pgn, setup, scored }`
 * record, and the original bare PGN string. The old shape (and any record
 * whose setup doesn't validate) still resumes — with `setup: null`, which
 * the app treats as a two-player game — rather than being lost or crashing.
 */
export function loadInProgress(): InProgressGame | null {
  const raw = readJson(KEYS.inProgress)
  if (typeof raw === 'string') return { pgn: raw, setup: null, scored: false }
  if (!isRecord(raw) || typeof raw['pgn'] !== 'string') return null
  return {
    pgn: raw['pgn'],
    setup: parseSetup(raw['setup']),
    scored: raw['scored'] === true,
  }
}

export function saveInProgress(game: InProgressGame): void {
  writeJson(KEYS.inProgress, { v: 2, ...game })
}

export function clearInProgress(): void {
  try {
    localStorage.removeItem(KEYS.inProgress)
  } catch {
    // ignore
  }
}
