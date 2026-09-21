export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Settings {
  level: Level
  timeControlId: string
  orientation: 'white' | 'black'
  soundEnabled: boolean
  themeId: string
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

export function loadInProgress(): string | null {
  const raw = readJson(KEYS.inProgress)
  return typeof raw === 'string' ? raw : null
}

export function saveInProgress(pgn: string): void {
  writeJson(KEYS.inProgress, pgn)
}

export function clearInProgress(): void {
  try {
    localStorage.removeItem(KEYS.inProgress)
  } catch {
    // ignore
  }
}
