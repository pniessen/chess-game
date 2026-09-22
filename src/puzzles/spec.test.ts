import { describe, expect, test } from 'vitest'
import { isUci, positionAfter, specOfBlunder, specOfRated, validateSpec } from './spec'
import type { BlunderPuzzle } from './types'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

test('isUci accepts long algebraic moves only', () => {
  expect(isUci('e2e4')).toBe(true)
  expect(isUci('e7e8q')).toBe(true)
  expect(isUci('e7e8k')).toBe(false)
  expect(isUci('Nf3')).toBe(false)
  expect(isUci('z9a1')).toBe(false)
})

// Breaks if the Lichess setup move is treated as the solver's first move.
test('specOfRated: moves[0] is the setup, the rest is the solution', () => {
  expect(specOfRated(DEFENCE)).toEqual({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8', 'f6d8'] })
})

test('specOfBlunder: no setup, a one-move solution', () => {
  const p: BlunderPuzzle = {
    id: 'b:x', fen: DEFENCE.fen, solution: 'd3d6', bestSan: 'Qd6', blunderLabel: '27. Qe2', solver: 'w',
    gameId: 'g', gameDate: '2026-09-21T00:00:00.000Z', opening: null, createdAt: '2026-09-21T00:00:00.000Z', solved: false,
  }
  expect(specOfBlunder(p)).toEqual({ fen: DEFENCE.fen, setup: null, solution: ['d3d6'] })
})

describe('validateSpec (through game-core)', () => {
  test('real Lichess lines and the synthetic fixture validate', () => {
    for (const p of [DEFENCE, MULTI, BACK_RANK]) expect(validateSpec(specOfRated(p))).toBeNull()
  })

  // Breaks if a move is skipped or applied without legality checking.
  test('an illegal move is reported with its 1-based index in the full line', () => {
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8', 'a1a8'] })).toMatch(
      /^move 4 \(a1a8\) is illegal/,
    )
  })

  // Breaks if a line ending on the opponent's move is accepted (nothing left for the solver).
  test('an even-length solution is rejected', () => {
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8'] })).toMatch(/odd number/)
    expect(validateSpec({ fen: DEFENCE.fen, setup: null, solution: [] })).toMatch(/odd number/)
  })

  test('a bad FEN and non-UCI text are rejected, never thrown', () => {
    expect(validateSpec({ fen: 'not a fen', setup: null, solution: ['e2e4'] })).toMatch(/^bad FEN/)
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'Qd6', solution: ['f8d8'] })).toMatch(/^move 1 is not UCI/)
  })
})

test('positionAfter replays through game-core and returns null on any failure', () => {
  expect(positionAfter(DEFENCE.fen, ['d3d6'])?.fen()).toBe('5rk1/1p3ppp/pq1Q1b2/8/8/1P3N2/P4PPP/3R2K1 b - - 3 27')
  expect(positionAfter(DEFENCE.fen, ['a1a8'])).toBeNull()
  expect(positionAfter(DEFENCE.fen, ['zz'])).toBeNull()
  expect(positionAfter('garbage', [])).toBeNull()
})
