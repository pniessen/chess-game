import type { PuzzleData, PuzzleRow, RatedPuzzle } from '../../src/puzzles/types'

/**
 * Lichess puzzle 0000D (CC0). White's setup 27.Qd6 hits the queen on b6 and
 * the bishop on f6; Black (the solver) answers ...Rd8, White takes Qxd8+,
 * Black recaptures Bxd8. Verified move by move through game-core.
 */
export const DEFENCE: RatedPuzzle = {
  id: '0000D',
  fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27',
  moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'],
  rating: 1468,
  themes: ['advantage', 'endgame', 'short'],
}

/** Lichess puzzle 00008 (CC0): solver White, three solver moves. */
export const MULTI: RatedPuzzle = {
  id: '00008',
  fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
  moves: ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'],
  rating: 1797,
  themes: ['crushing', 'hangingPiece', 'long', 'middlegame'],
}

/**
 * SYNTHETIC (not from Lichess): after the setup ...b6, White (the solver)
 * mates with the listed Qd8# — but Ra8# is mate too, so it must also solve.
 */
export const BACK_RANK: RatedPuzzle = {
  id: 'T0001',
  fen: '6k1/1p3ppp/8/8/8/8/5PPP/R2Q2K1 b - - 0 1',
  moves: ['b7b6', 'd1d8'],
  rating: 1500,
  themes: ['mate', 'mateIn1', 'backRankMate'],
}

/**
 * SYNTHETIC and deliberately broken: same as DEFENCE, but the last move
 * (a1a8) is illegal in the resulting position (the rook's path is blocked).
 * `validateSpec` must reject it; used to test that PuzzleScreen skips over
 * a corrupt puzzle instead of showing it.
 */
export const ILLEGAL_MOVE: RatedPuzzle = {
  id: 'BAD01',
  fen: DEFENCE.fen,
  moves: ['d3d6', 'f8d8', 'd6d8', 'a1a8'],
  rating: 1468,
  themes: ['advantage', 'endgame', 'short'],
}

/** A two-puzzle stand-in for public/puzzles/puzzles.json (unit tests and e2e). */
export const PUZZLE_FIXTURE: PuzzleData = {
  v: 1,
  puzzles: [DEFENCE, BACK_RANK].map((p): PuzzleRow => [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')]),
}
