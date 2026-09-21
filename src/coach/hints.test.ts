import { describe, expect, test } from 'vitest'
import { nudgeText, suggestionFrom } from './hints'
import { Position } from '../game-core/position'

describe('suggestionFrom', () => {
  test('takes the best line (multipv 1, deepest) and resolves SAN and the moving piece', () => {
    const s = suggestionFrom(
      [
        { depth: 10, multipv: 1, scoreCp: 30, pv: ['g1f3', 'g8f6'] },
        { depth: 10, multipv: 2, scoreCp: 20, pv: ['e2e4'] },
      ],
      new Position(),
    )
    expect(s).toMatchObject({ from: 'g1', to: 'f3', san: 'Nf3', piece: 'n' })
  })
  test('an illegal or missing suggestion yields null', () => {
    expect(suggestionFrom([{ pv: ['a1a8'] }], new Position())).toBeNull()
    expect(suggestionFrom([], new Position())).toBeNull()
  })
})

test('nudgeText names the piece', () => {
  expect(nudgeText('q')).toBe('Look at your queen.')
})
