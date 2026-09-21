import { describe, expect, test } from 'vitest'
import { hintRequestFrom, moverScore, nudgeText, sanLine, suggestionFrom } from './hints'
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

describe('hint request', () => {
  test('moverScore formats cp and mate from the side to move', () => {
    expect(moverScore({ scoreCp: 83, pv: [] })).toBe('+0.8')
    expect(moverScore({ scoreCp: -120, pv: [] })).toBe('-1.2')
    expect(moverScore({ scoreMate: 3, pv: [] })).toBe('M3')
    expect(moverScore({ scoreMate: -2, pv: [] })).toBe('-M2')
    expect(moverScore({ pv: [] })).toBeNull()
  })

  test('sanLine converts the PV and stops at the first unplayable move', () => {
    expect(sanLine(new Position(), ['e2e4', 'e7e5', 'g1f3'], 12)).toEqual(['e4', 'e5', 'Nf3'])
    expect(sanLine(new Position(), ['e2e4', 'a1a8', 'g1f3'], 12)).toEqual(['e4'])
    expect(sanLine(new Position(), ['e2e4', 'e7e5'], 1)).toEqual(['e4'])
  })

  test('hintRequestFrom builds a server-valid request', () => {
    const pos = new Position()
    const s = suggestionFrom([{ depth: 12, scoreCp: 25, pv: ['e2e4', 'e7e5'] }], pos)
    if (!s) throw new Error('no suggestion')
    expect(hintRequestFrom(s, pos)).toEqual({
      fen: pos.fen(),
      bestMoveSan: 'e4',
      line: ['e4', 'e5'],
      evaluation: '+0.3',
    })
  })
})
