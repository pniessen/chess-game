import { describe, expect, test } from 'vitest'
import { isCriticalError, parseBestMove, parseInfo, principalLine, uciToIntent } from './uci'

describe('uciToIntent', () => {
  test('parses a plain move', () => {
    expect(uciToIntent('e2e4')).toEqual({ from: 'e2', to: 'e4' })
  })

  test('parses a promotion', () => {
    expect(uciToIntent('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' })
  })

  test('rejects the engine\'s "no move" marker and short strings', () => {
    expect(uciToIntent('(none)')).toBeNull()
    expect(uciToIntent('e2')).toBeNull()
  })
})

describe('parseBestMove', () => {
  test('parses a bestmove with a ponder move', () => {
    expect(parseBestMove('bestmove e2e4 ponder d7d6')).toEqual({
      best: 'e2e4', ponder: 'd7d6',
    })
  })

  test('parses a bestmove without a ponder move', () => {
    expect(parseBestMove('bestmove g1f3')).toEqual({ best: 'g1f3' })
  })

  test('parses a promotion bestmove', () => {
    expect(parseBestMove('bestmove e7e8q')).toEqual({ best: 'e7e8q' })
  })

  test('returns null for any other line', () => {
    expect(parseBestMove('info depth 1 score cp 17 pv e2e4')).toBeNull()
  })
})

describe('parseInfo', () => {
  test('parses a centipawn line', () => {
    const line =
      'info depth 4 seldepth 7 multipv 1 score cp 39 nodes 512 nps 128000 hashfull 0 tbhits 0 time 4 pv g1f3 d7d5 d2d4'
    expect(parseInfo(line)).toEqual({
      depth: 4, multipv: 1, scoreCp: 39, nodes: 512, timeMs: 4,
      pv: ['g1f3', 'd7d5', 'd2d4'],
    })
  })

  test('parses a mate line', () => {
    const line =
      'info depth 1 seldepth 1 multipv 1 score mate 1 nodes 31 nps 10333 hashfull 0 tbhits 0 time 3 pv d8h4'
    const info = parseInfo(line)
    expect(info?.scoreMate).toBe(1)
    expect(info?.scoreCp).toBeUndefined()
    expect(info?.pv).toEqual(['d8h4'])
  })

  test('parses a negative mate score', () => {
    expect(parseInfo('info depth 3 score mate -2 pv a1a2')?.scoreMate).toBe(-2)
  })

  test('returns null for a line with no principal variation', () => {
    expect(parseInfo('info string NNUE evaluation using nn-abc.nnue')).toBeNull()
  })

  test('returns null for non-info lines', () => {
    expect(parseInfo('bestmove e2e4')).toBeNull()
  })
})

describe('isCriticalError', () => {
  test('detects the fatal engine error line', () => {
    expect(isCriticalError('info string CRITICAL ERROR: illegal move in position')).toBe(true)
  })

  test('ordinary info strings are not errors', () => {
    expect(isCriticalError('info string NNUE evaluation using nn-abc.nnue')).toBe(false)
  })
})

describe('principalLine', () => {
  test('prefers multipv 1 at the greatest depth over later, weaker lines', () => {
    const best = principalLine([
      { depth: 8, multipv: 1, pv: ['d2d4'] },
      { depth: 10, multipv: 1, pv: ['e2e4'] },
      { depth: 10, multipv: 2, pv: ['g1f3'] },
    ])
    expect(best?.pv[0]).toBe('e2e4')
  })
  test('lines without multipv count as rank 1; empty input gives null', () => {
    expect(principalLine([{ depth: 3, pv: ['e2e4'] }])?.pv[0]).toBe('e2e4')
    expect(principalLine([])).toBeNull()
  })
})
