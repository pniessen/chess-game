import { describe, expect, test } from 'vitest'
import { templatedHint } from './templated'
import { Position } from '../game-core/position'
import type { EngineInfo } from '../engine/uci'

const info = (over: Partial<EngineInfo>): EngineInfo => ({ pv: ['e2e4'], ...over })

describe('templatedHint', () => {
  test('announces a forced mate with the move and the distance', () => {
    // d1h5 (Qh5) is only legal after e4 e5, not in starting position
    const pos = new Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2')
    const hint = templatedHint([info({ scoreMate: 3, pv: ['d1h5'] })], pos)
    expect(hint).toMatch(/mate in 3/i)
    expect(hint).toMatch(/Qh5/)
  })

  test('names the best move in standard notation, not UCI', () => {
    const hint = templatedHint([info({ scoreCp: 30, pv: ['g1f3'] })], new Position())
    expect(hint).toMatch(/Nf3/)
    expect(hint).not.toMatch(/g1f3/)
  })

  test('reports a winning capture', () => {
    const pos = new Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 0 2')
    const hint = templatedHint([info({ scoreCp: 120, pv: ['b8c6'] })], pos)
    expect(hint).not.toBeNull()
  })

  test('returns null when there is nothing to say', () => {
    expect(templatedHint([], new Position())).toBeNull()
    expect(templatedHint([info({ pv: [] })], new Position())).toBeNull()
  })

  test('an unplayable suggestion is rejected rather than shown', () => {
    const hint = templatedHint([info({ scoreCp: 10, pv: ['a1a8'] })], new Position())
    expect(hint).toBeNull()
  })
})
