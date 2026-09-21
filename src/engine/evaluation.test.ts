import { describe, expect, test } from 'vitest'
import { evalFromLines, formatEval, toWhitePov, whiteWinPercent, winPercentFromCp } from './evaluation'

describe('toWhitePov', () => {
  test('scores are side-to-move relative; Black to move flips the sign', () => {
    expect(toWhitePov({ scoreCp: 50, pv: [] }, 'w')).toEqual({ kind: 'cp', cp: 50 })
    expect(toWhitePov({ scoreCp: 50, pv: [] }, 'b')).toEqual({ kind: 'cp', cp: -50 })
  })
  test('mate scores flip too: Black to move and being mated means White mates', () => {
    expect(toWhitePov({ scoreMate: -3, pv: [] }, 'b')).toEqual({ kind: 'mate', mate: 3 })
    expect(toWhitePov({ scoreMate: 2, pv: [] }, 'b')).toEqual({ kind: 'mate', mate: -2 })
  })
  test('no score, no evaluation', () => {
    expect(toWhitePov({ pv: ['e2e4'] }, 'w')).toBeNull()
  })
  test('evalFromLines uses the principal line', () => {
    expect(
      evalFromLines(
        [
          { depth: 12, multipv: 1, scoreCp: 40, pv: ['e2e4'] },
          { depth: 12, multipv: 2, scoreCp: -90, pv: ['a2a3'] },
        ],
        'w',
      ),
    ).toEqual({ kind: 'cp', cp: 40 })
  })
})

describe('win percent (Lichess)', () => {
  test('matches the published formula, clamped at ±1000cp', () => {
    expect(winPercentFromCp(0)).toBe(50)
    expect(winPercentFromCp(100)).toBeCloseTo(59.1026, 3)
    expect(winPercentFromCp(-300)).toBeCloseTo(24.8874, 3)
    expect(winPercentFromCp(1000)).toBeCloseTo(97.5447, 3)
    expect(winPercentFromCp(5000)).toBeCloseTo(97.5447, 3)
  })
  test('mates and results are certain', () => {
    expect(whiteWinPercent({ kind: 'mate', mate: 4 })).toBe(100)
    expect(whiteWinPercent({ kind: 'mate', mate: -1 })).toBe(0)
    expect(whiteWinPercent({ kind: 'result', winner: null })).toBe(50)
    expect(whiteWinPercent({ kind: 'result', winner: 'b' })).toBe(0)
  })
})

test('formatEval', () => {
  expect(formatEval({ kind: 'cp', cp: 83 })).toBe('+0.8')
  expect(formatEval({ kind: 'cp', cp: -250 })).toBe('-2.5')
  expect(formatEval({ kind: 'cp', cp: 0 })).toBe('0.0')
  expect(formatEval({ kind: 'mate', mate: 1 })).toBe('M1')
  expect(formatEval({ kind: 'mate', mate: -3 })).toBe('-M3')
  expect(formatEval({ kind: 'result', winner: 'w' })).toBe('1-0')
  expect(formatEval({ kind: 'result', winner: null })).toBe('½-½')
})
