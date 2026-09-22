import type { TimeControl } from '../clock/types'

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Settings {
  level: Level
  timeControlId: string
  orientation: 'white' | 'black'
  soundEnabled: boolean
  themeId: string
  /** Piece-set id (see ../ui/pieceSets.ts); defensive default is the current Rhosgfx set. */
  pieceSetId: string
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
  pieceSetId: 'rhosgfx',
  showEval: true,
}

const KEYS = {
  settings: 'chess-game:settings',
  score: 'chess-game:score',
  inProgress: 'chess-game:in-progress',
  history: 'chess-game:history',
  puzzles: 'chess-game:puzzles',
  blunderPuzzles: 'chess-game:blunder-puzzles',
} as const

/** Every localStorage key the app uses. Other modules (src/puzzles/store.ts) read their keys from here. */
export const STORAGE_KEYS = KEYS

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is acceptable;
    // crashing the game is not.
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
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
    pieceSetId:
      typeof raw['pieceSetId'] === 'string' ? raw['pieceSetId'] : DEFAULT_SETTINGS.pieceSetId,
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
  /**
   * True once this game's finish has already been written to history (it
   * was finished, then taken back). Absent in older saves: reads as false,
   * and the app still treats an already-finished game as recorded.
   */
  recorded: boolean
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
 * Two stored shapes are accepted: the current `{ v: 2, pgn, setup, scored, recorded }`
 * record, and the original bare PGN string. The old shape (and any record
 * whose setup doesn't validate) still resumes — with `setup: null`, which
 * the app treats as a two-player game — rather than being lost or crashing.
 */
export function loadInProgress(): InProgressGame | null {
  const raw = readJson(KEYS.inProgress)
  if (typeof raw === 'string') return { pgn: raw, setup: null, scored: false, recorded: false }
  if (!isRecord(raw) || typeof raw['pgn'] !== 'string') return null
  return {
    pgn: raw['pgn'],
    setup: parseSetup(raw['setup']),
    scored: raw['scored'] === true,
    recorded: raw['recorded'] === true,
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

// ---- finished-game history ------------------------------------------------

export const HISTORY_LIMIT = 200

export interface HistoryEntry {
  id: string
  /** ISO 8601. */
  date: string
  result: '1-0' | '0-1' | '1/2-1/2'
  termination: 'normal' | 'resign' | 'flag'
  opening: string | null
  pgn: string
  /** Null until the game is reviewed. */
  accuracy: { w: number | null; b: number | null } | null
  white: string
  black: string
}

const RESULTS = ['1-0', '0-1', '1/2-1/2'] as const
const TERMINATIONS = ['normal', 'resign', 'flag'] as const

function numOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

function parseHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isRecord(v)) return null
  const { id, date, result, termination, opening, pgn, accuracy, white, black } = v
  if (typeof id !== 'string' || typeof date !== 'string' || typeof pgn !== 'string') return null
  if (typeof white !== 'string' || typeof black !== 'string') return null
  if (!RESULTS.includes(result as HistoryEntry['result'])) return null
  if (!TERMINATIONS.includes(termination as HistoryEntry['termination'])) return null
  if (opening !== null && typeof opening !== 'string') return null
  let acc: HistoryEntry['accuracy'] = null
  if (accuracy !== null) {
    if (!isRecord(accuracy) || !numOrNull(accuracy['w']) || !numOrNull(accuracy['b'])) return null
    acc = { w: accuracy['w'] as number | null, b: accuracy['b'] as number | null }
  }
  return {
    id,
    date,
    result: result as HistoryEntry['result'],
    termination: termination as HistoryEntry['termination'],
    opening,
    pgn,
    accuracy: acc,
    white,
    black,
  }
}

/** Finished games, newest first. Unknown versions and malformed entries read as absent. */
export function loadHistory(): HistoryEntry[] {
  const raw = readJson(KEYS.history)
  if (!isRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['games'])) return []
  return raw['games'].map(parseHistoryEntry).filter((e): e is HistoryEntry => e !== null)
}

let warnedUnwritableHistory = false

export type HistoryStatus = 'ok' | 'empty' | 'unreadable' | 'newer-version'

/**
 * A pure read of what shape `chess-game:history` is in, for UI that wants to
 * explain to the user why their games aren't being saved (see
 * `historyWritable`, which this backs):
 * - 'empty': the key is absent (or storage is unreadable outright) — a
 *   fresh history will be started on the next write, silently.
 * - 'ok': a v1 record this build understands.
 * - 'newer-version': parses as JSON with a numeric `v` greater than 1 — most
 *   likely written by a newer build of this app.
 * - 'unreadable': anything else (corrupt JSON, or a record of the wrong
 *   shape with no informative version).
 */
export function historyStatus(): HistoryStatus {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEYS.history)
  } catch {
    return 'empty' // storage disabled: reads as empty, consistent with readJson
  }
  if (raw === null) return 'empty'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'unreadable'
  }
  if (isRecord(parsed) && parsed['v'] === 1 && Array.isArray(parsed['games'])) return 'ok'
  if (isRecord(parsed) && typeof parsed['v'] === 'number' && parsed['v'] > 1) return 'newer-version'
  return 'unreadable'
}

/**
 * True when the history key is absent or holds a v1 record this build
 * understands. Anything else (a newer version, unparseable JSON, a v1
 * record without a games array) reads as empty but must NOT be replaced:
 * it may be a newer build's data, and overwriting it would destroy every
 * game in it. Warns once per session when it refuses.
 */
function historyWritable(): boolean {
  const status = historyStatus()
  if (status === 'ok' || status === 'empty') return true
  if (!warnedUnwritableHistory) {
    warnedUnwritableHistory = true
    console.warn('game history is in an unrecognised format; leaving it untouched and not recording new games')
  }
  return false
}

/**
 * Explicit user reset for an unreadable/newer-version history: deletes the
 * key outright (there is nothing this build can safely merge it with), so
 * the next finished game starts a fresh history. Only ever called from a
 * user-initiated "Reset history" confirmation — never automatically.
 */
export function resetHistory(): void {
  try {
    localStorage.removeItem(KEYS.history)
  } catch {
    // ignore
  }
  warnedUnwritableHistory = false
}

function saveHistory(games: HistoryEntry[]): HistoryEntry[] {
  if (!historyWritable()) return loadHistory()
  const capped = games.slice(0, HISTORY_LIMIT)
  writeJson(KEYS.history, { v: 1, games: capped })
  return capped
}

export function addHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  return saveHistory([entry, ...loadHistory().filter((e) => e.id !== entry.id)])
}

export function updateHistoryAccuracy(
  id: string,
  accuracy: { w: number | null; b: number | null },
): HistoryEntry[] {
  return saveHistory(loadHistory().map((e) => (e.id === id ? { ...e, accuracy } : e)))
}
