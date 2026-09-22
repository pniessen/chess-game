import { STORAGE_KEYS, isRecord, readJson, writeJson } from '../storage/storage'
import { RATING_CEIL, RATING_FLOOR, START_RATING, nextRating } from './rating'
import type { PuzzleOutcome } from './session'
import { isUci, specOfBlunder, validateSpec } from './spec'
import type { BlunderPuzzle } from './types'

const VERSION = 1
export const SEEN_LIMIT = 5000
export const BLUNDER_PUZZLE_LIMIT = 200

/**
 * Absent, unparseable or malformed data may be replaced (a graceful reset).
 * A record written by a NEWER build may not: it reads as defaults here but
 * is left untouched (see storage.ts historyWritable, commit 57057d2).
 */
function writable(key: string): boolean {
  const raw = readJson(key)
  return !(isRecord(raw) && typeof raw['v'] === 'number' && raw['v'] > VERSION)
}

// ---- rating + seen ---------------------------------------------------------

export interface PuzzleStats {
  rating: number
  /** Rated results so far (decides the K-factor). */
  games: number
  wins: number
  losses: number
  /** Ids of rated puzzles already shown, oldest first. */
  seen: string[]
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

export function loadPuzzleStats(): PuzzleStats {
  const raw = readJson(STORAGE_KEYS.puzzles)
  if (!isRecord(raw) || raw['v'] !== VERSION) return { rating: START_RATING, games: 0, wins: 0, losses: 0, seen: [] }
  const rating = raw['rating']
  const seen = raw['seen']
  return {
    rating:
      typeof rating === 'number' && Number.isFinite(rating) && rating >= RATING_FLOOR && rating <= RATING_CEIL
        ? Math.round(rating)
        : START_RATING,
    games: count(raw['games']),
    wins: count(raw['wins']),
    losses: count(raw['losses']),
    seen: Array.isArray(seen) ? seen.filter((x): x is string => typeof x === 'string').slice(-SEEN_LIMIT) : [],
  }
}

function saveStats(s: PuzzleStats): PuzzleStats {
  if (!writable(STORAGE_KEYS.puzzles)) return loadPuzzleStats()
  writeJson(STORAGE_KEYS.puzzles, { v: VERSION, ...s })
  return s
}

export function markPuzzleSeen(id: string): PuzzleStats {
  const s = loadPuzzleStats()
  if (s.seen.includes(id)) return s
  return saveStats({ ...s, seen: [...s.seen, id].slice(-SEEN_LIMIT) })
}

export function recordPuzzleResult(puzzleRating: number, outcome: PuzzleOutcome): PuzzleStats {
  const s = loadPuzzleStats()
  return saveStats({
    ...s,
    rating: nextRating(s.rating, puzzleRating, outcome, s.games),
    games: s.games + 1,
    wins: s.wins + (outcome === 'win' ? 1 : 0),
    losses: s.losses + (outcome === 'loss' ? 1 : 0),
  })
}

// ---- "My mistakes" ---------------------------------------------------------

function parseBlunder(v: unknown): BlunderPuzzle | null {
  if (!isRecord(v)) return null
  const str = (k: string): string | null => (typeof v[k] === 'string' ? (v[k] as string) : null)
  const id = str('id')
  const fen = str('fen')
  const solution = str('solution')
  const bestSan = str('bestSan')
  const blunderLabel = str('blunderLabel')
  const gameId = str('gameId')
  const gameDate = str('gameDate')
  const createdAt = str('createdAt')
  const { opening, solver, solved } = v
  if (!id || !fen || !solution || !bestSan || !blunderLabel || !gameId || !gameDate || !createdAt) return null
  if (!isUci(solution) || (solver !== 'w' && solver !== 'b') || typeof solved !== 'boolean') return null
  if (opening !== null && typeof opening !== 'string') return null
  const p: BlunderPuzzle = { id, fen, solution, bestSan, blunderLabel, solver, gameId, gameDate, opening, createdAt, solved }
  // Never let a tampered entry reach the board.
  return validateSpec(specOfBlunder(p)) === null ? p : null
}

/** Newest first. Malformed or unplayable entries read as absent. */
export function loadBlunderPuzzles(): BlunderPuzzle[] {
  const raw = readJson(STORAGE_KEYS.blunderPuzzles)
  if (!isRecord(raw) || raw['v'] !== VERSION || !Array.isArray(raw['puzzles'])) return []
  return (raw['puzzles'] as unknown[]).map(parseBlunder).filter((p): p is BlunderPuzzle => p !== null)
}

function saveBlunders(list: BlunderPuzzle[]): BlunderPuzzle[] {
  if (!writable(STORAGE_KEYS.blunderPuzzles)) return loadBlunderPuzzles()
  const capped = list.slice(0, BLUNDER_PUZZLE_LIMIT)
  writeJson(STORAGE_KEYS.blunderPuzzles, { v: VERSION, puzzles: capped })
  return capped
}

/** New positions go first, in the given order; a position already stored is kept as it is. */
export function addBlunderPuzzles(list: readonly BlunderPuzzle[]): BlunderPuzzle[] {
  const existing = loadBlunderPuzzles()
  const have = new Set(existing.map((p) => p.id))
  const fresh: BlunderPuzzle[] = []
  for (const p of list) {
    if (have.has(p.id)) continue
    have.add(p.id)
    fresh.push(p)
  }
  if (fresh.length === 0) return existing
  return saveBlunders([...fresh, ...existing])
}

export function markBlunderPuzzleSolved(id: string): BlunderPuzzle[] {
  return saveBlunders(loadBlunderPuzzles().map((p) => (p.id === id ? { ...p, solved: true } : p)))
}
