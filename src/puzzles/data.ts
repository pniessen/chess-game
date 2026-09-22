import { isUci } from './spec'
import type { RatedPuzzle } from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Shape check for our own asset: a truncated or stale file must not crash
 * puzzle mode. Rows that do not fit are dropped; chess legality was already
 * checked at build time (scripts/build-puzzles.ts).
 */
export function parsePuzzleData(raw: unknown): RatedPuzzle[] | null {
  if (!isRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['puzzles'])) return null
  const out: RatedPuzzle[] = []
  for (const row of raw['puzzles'] as unknown[]) {
    if (!Array.isArray(row) || row.length !== 5) continue
    const [id, fen, moves, rating, themes] = row as unknown[]
    if (typeof id !== 'string' || typeof fen !== 'string' || typeof moves !== 'string' || typeof themes !== 'string') continue
    if (typeof rating !== 'number' || !Number.isFinite(rating)) continue
    const ms = moves.split(' ').filter(Boolean)
    if (ms.length < 2 || ms.length % 2 !== 0 || !ms.every(isUci)) continue
    out.push({ id, fen, moves: ms, rating, themes: themes.split(' ').filter(Boolean) })
  }
  return out.length > 0 ? out : null
}

let cached: Promise<RatedPuzzle[] | null> | null = null

/** Fetched only when puzzle mode opens; cached on success, retried after a failure. */
export function loadPuzzleSet(
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
  url = '/puzzles/puzzles.json',
): Promise<RatedPuzzle[] | null> {
  cached ??= fetchImpl(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((raw: unknown) => parsePuzzleData(raw))
    .catch(() => null)
    .then((set) => {
      if (!set) cached = null
      return set
    })
  return cached
}

export function resetPuzzleSetCache(): void {
  cached = null
}
