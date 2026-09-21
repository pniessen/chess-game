import { describe, expect, test } from 'vitest'
import { toMovePairs } from './movePairs'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('toMovePairs', () => {
  test('pairs white and black moves with move numbers', () => {
    const pairs = toMovePairs([move('e4', 'w'), move('e5', 'b'), move('Nf3', 'w')])
    expect(pairs).toEqual([
      { number: 1, white: { san: 'e4', ply: 1 }, black: { san: 'e5', ply: 2 } },
      { number: 2, white: { san: 'Nf3', ply: 3 } },
    ])
  })

  test('a game starting with Black leaves the first white slot empty', () => {
    const pairs = toMovePairs([move('e5', 'b'), move('Nf3', 'w')])
    expect(pairs[0]).toEqual({ number: 1, black: { san: 'e5', ply: 1 } })
    expect(pairs[1]).toEqual({ number: 2, white: { san: 'Nf3', ply: 2 } })
  })

  test('an empty game has no pairs', () => {
    expect(toMovePairs([])).toEqual([])
  })
})
