import type { Level } from '../storage/storage'

export interface StrengthProfile {
  level: Level
  label: string
  /** Stockfish "Skill Level" option, 0-20. */
  skillLevel: number
  /**
   * Stockfish "UCI_Elo", 1320-3190, or null to use Skill Level instead.
   * Null below level 4: UCI_Elo cannot go under 1320, which is already far
   * too strong for a beginner.
   */
  uciElo: number | null
  depth: number
  moveTimeMs: number
  /** Probability of playing a deliberately weaker move. */
  blunderChance: number
  /** MultiPV width to choose the weaker move from. */
  blunderPool: number
  /** Probability of playing a dataset continuation when the position is in book (spec: 1–3 prefer it heavily). */
  bookChance: number
}

export const LEVELS: readonly StrengthProfile[] = [
  { level: 1, label: 'Beginner',      skillLevel: 0,  uciElo: null, depth: 1,  moveTimeMs: 50,   blunderChance: 0.55, blunderPool: 6, bookChance: 0.9 },
  { level: 2, label: 'Casual',        skillLevel: 1,  uciElo: null, depth: 2,  moveTimeMs: 100,  blunderChance: 0.40, blunderPool: 5, bookChance: 0.9 },
  { level: 3, label: 'Improving',     skillLevel: 3,  uciElo: null, depth: 3,  moveTimeMs: 150,  blunderChance: 0.28, blunderPool: 4, bookChance: 0.9 },
  { level: 4, label: 'Club (~1500)',  skillLevel: 6,  uciElo: 1500, depth: 5,  moveTimeMs: 250,  blunderChance: 0.15, blunderPool: 3, bookChance: 0.5 },
  { level: 5, label: 'Strong club (~1800)', skillLevel: 10, uciElo: 1800, depth: 8,  moveTimeMs: 400,  blunderChance: 0.07, blunderPool: 3, bookChance: 0.5 },
  { level: 6, label: 'Expert (~2100)',      skillLevel: 14, uciElo: 2100, depth: 12, moveTimeMs: 700,  blunderChance: 0.03, blunderPool: 2, bookChance: 0.5 },
  { level: 7, label: 'Master (~2400)',      skillLevel: 18, uciElo: 2400, depth: 16, moveTimeMs: 1200, blunderChance: 0.01, blunderPool: 2, bookChance: 0 },
  { level: 8, label: 'Full strength',       skillLevel: 20, uciElo: null, depth: 22, moveTimeMs: 2000, blunderChance: 0,    blunderPool: 1, bookChance: 0 },
]

export function profileFor(level: Level): StrengthProfile {
  const found = LEVELS.find((p) => p.level === level)
  if (!found) throw new Error(`unknown level: ${level}`)
  return found
}
