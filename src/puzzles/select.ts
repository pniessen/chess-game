import type { RatedPuzzle } from './types'

/** Widening distance from the user's rating; the last window takes anything. */
export const RATING_WINDOWS = [100, 200, 400, 800, Number.POSITIVE_INFINITY] as const

export interface SelectOptions {
  rating: number
  seen: ReadonlySet<string>
  /** A theme id from PUZZLE_THEMES, or null for all. */
  theme: string | null
  /** The puzzle on screen: Next never serves it again. */
  excludeId?: string | null
  /** Injected so tests and e2e are deterministic. */
  random: () => number
}

export function selectPuzzle(puzzles: readonly RatedPuzzle[], o: SelectOptions): RatedPuzzle | null {
  const pool = puzzles.filter((p) => p.id !== o.excludeId && (o.theme === null || p.themes.includes(o.theme)))
  if (pool.length === 0) return null
  const unseen = pool.filter((p) => !o.seen.has(p.id))
  const source = unseen.length > 0 ? unseen : pool
  for (const w of RATING_WINDOWS) {
    const near = source.filter((p) => Math.abs(p.rating - o.rating) <= w)
    if (near.length > 0) return near[Math.min(near.length - 1, Math.floor(o.random() * near.length))] ?? null
  }
  return null
}
