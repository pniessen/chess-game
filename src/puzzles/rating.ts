import type { PuzzleOutcome } from './session'

export const START_RATING = 1200
/** Rated results played with the fast-moving K. */
export const PROVISIONAL_GAMES = 20
export const RATING_FLOOR = 400
export const RATING_CEIL = 3200

export function kFactor(games: number): number {
  return games < PROVISIONAL_GAMES ? 40 : 20
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400))
}

/** Elo against the puzzle's own rating; `games` = rated results before this one. */
export function nextRating(rating: number, puzzleRating: number, outcome: PuzzleOutcome, games: number): number {
  const score = outcome === 'win' ? 1 : 0
  const raw = rating + kFactor(games) * (score - expectedScore(rating, puzzleRating))
  return Math.min(RATING_CEIL, Math.max(RATING_FLOOR, Math.round(raw)))
}
