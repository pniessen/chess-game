import { describe, expect, test } from 'vitest'
import { blunderIdOf, blunderPuzzlesFrom } from './blunders'
import { gameFromSan } from '../game-core/io'
import { uciOf } from '../game-core/notation'
import { STARTING_FEN, type PlayedMove } from '../game-core/types'
import type { GameReview, ReviewedMove } from '../review/run'
import type { MoveClass } from '../review/analysis'

const BEFORE_NF6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'
const SOURCE = { gameId: 'g-1', gameDate: '2026-09-21T10:00:00.000Z', opening: "C23 Bishop's Opening" }
const NOW = new Date('2026-09-21T11:00:00.000Z')

/** Scholar's mate; ply `flag` (1-based) is a blunder whose best move is `best`. */
function scholar(flag = 6, best: string | null = 'g7g6', cls: MoveClass = 'blunder') {
  const r = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  if (!r.ok) throw new Error(r.error)
  const moves: PlayedMove[] = [...r.game.moves]
  const reviewed: ReviewedMove[] = moves.map((m, i) => {
    const hit = i + 1 === flag
    return {
      ply: i + 1, san: m.san, uci: uciOf(m), mover: m.color,
      classification: hit ? cls : 'ok', loss: hit ? 60 : 1,
      bestUci: hit ? best : uciOf(m), bestSan: null,
    }
  })
  const review: GameReview = { firstMover: 'w', evals: [], moves: reviewed, accuracy: { w: null, b: null } }
  return { review, moves, startFen: r.game.startFen }
}

describe('blunderPuzzlesFrom', () => {
  test("Black's 3...Nf6?? becomes a one-move puzzle from the position before it", () => {
    const { review, moves, startFen } = scholar()
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([
      {
        id: 'b:r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq -',
        fen: BEFORE_NF6,
        solution: 'g7g6',
        bestSan: 'g6',
        blunderLabel: '3... Nf6',
        solver: 'b',
        gameId: 'g-1',
        gameDate: '2026-09-21T10:00:00.000Z',
        opening: "C23 Bishop's Opening",
        createdAt: '2026-09-21T11:00:00.000Z',
        solved: false,
      },
    ])
  })

  // Breaks if the engine's (or another human's) blunders become "my" mistakes.
  test('only human sides count', () => {
    const { review, moves, startFen } = scholar()
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['w'], source: SOURCE, now: NOW })).toEqual([])
  })

  test('mistakes and inaccuracies are not blunders', () => {
    const { review, moves, startFen } = scholar(6, 'g7g6', 'mistake')
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([])
  })

  // Breaks if an unverified or unplayable "solution" is stored.
  test('no best move, an illegal best move, or best = played: skipped', () => {
    for (const best of [null, 'a1a8', 'g8f6']) {
      const { review, moves, startFen } = scholar(6, best)
      expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([])
    }
  })

  test('a blunder on the first move uses the start position', () => {
    const { review, moves, startFen } = scholar(1, 'd2d4')
    const [p] = blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['w'], source: SOURCE, now: NOW })
    expect(p).toMatchObject({ fen: STARTING_FEN, solution: 'd2d4', bestSan: 'd4', blunderLabel: '1. e4', solver: 'w' })
  })
})

test('blunderIdOf keys a position by its EPD (move counters ignored)', () => {
  expect(blunderIdOf(BEFORE_NF6)).toBe('b:r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq -')
  expect(blunderIdOf(BEFORE_NF6.replace(' 3 3', ' 0 9'))).toBe(blunderIdOf(BEFORE_NF6))
})
