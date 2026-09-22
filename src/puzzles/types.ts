import type { Color } from '../game-core/types'

/** A Lichess puzzle as bundled in public/puzzles/puzzles.json. */
export interface RatedPuzzle {
  id: string
  /** The position BEFORE the opponent's setup move (Lichess format). */
  fen: string
  /** UCI. moves[0] is the opponent's setup move; then solver, opponent, …, solver. */
  moves: string[]
  rating: number
  themes: string[]
}

/** One row of the bundled JSON: [id, fen, space-separated UCI moves, rating, space-separated themes]. */
export type PuzzleRow = [id: string, fen: string, moves: string, rating: number, themes: string]

export interface PuzzleData {
  v: 1
  puzzles: PuzzleRow[]
}

/** What a session needs, whatever the puzzle's source. */
export interface PuzzleSpec {
  fen: string
  /** An opponent move played automatically before the solver's turn (Lichess); null for a blunder puzzle. */
  setup: string | null
  /** Solver, opponent, …, solver (odd length), UCI. */
  solution: readonly string[]
}

/** A position from one of the user's own reviewed games where they blundered. */
export interface BlunderPuzzle {
  /** `b:` + the position's EPD — one puzzle per position. */
  id: string
  /** The position before the blunder; the solver is to move. */
  fen: string
  /** The engine's best move there, from the review (UCI). */
  solution: string
  bestSan: string
  /** The blunder that was actually played, e.g. "3... Nf6". */
  blunderLabel: string
  solver: Color
  gameId: string
  /** ISO 8601, from the history entry. */
  gameDate: string
  opening: string | null
  /** ISO 8601. */
  createdAt: string
  solved: boolean
}
