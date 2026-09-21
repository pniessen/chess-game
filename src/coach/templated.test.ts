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
    // After 1.e4 d5, White plays exd5 (e4 pawn captures d5 pawn)
    const pos = new Position('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2')
    const hint = templatedHint([info({ scoreCp: 120, pv: ['e4d5'] })], pos)
    expect(hint).not.toBeNull()
    expect(hint).toMatch(/wins a pawn/)
  })

  test('returns null when there is nothing to say', () => {
    expect(templatedHint([], new Position())).toBeNull()
    expect(templatedHint([info({ pv: [] })], new Position())).toBeNull()
  })

  test('an unplayable suggestion is rejected rather than shown', () => {
    const hint = templatedHint([info({ scoreCp: 10, pv: ['a1a8'] })], new Position())
    expect(hint).toBeNull()
  })

  test('MultiPV: selects multipv=1 at greatest depth, not the last-received line', () => {
    // Simulate a MultiPV search where:
    // - depth 10, multipv=1 (best move): e4
    // - depth 10, multipv=2 (worse move): Nf3
    // The last-received line is multipv=2, but we should pick multipv=1.
    const lines: EngineInfo[] = [
      { depth: 10, multipv: 1, scoreCp: 50, pv: ['e2e4'] },
      { depth: 10, multipv: 2, scoreCp: 20, pv: ['g1f3'] },
    ]
    const hint = templatedHint(lines, new Position())
    expect(hint).toMatch(/e4/)
    expect(hint).not.toMatch(/Nf3/)
  })

  test('negative mate: uses plain wording without "holds out longest"', () => {
    const pos = new Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2')
    const hint = templatedHint([info({ scoreMate: -3, pv: ['d1h5'] })], pos)
    expect(hint).not.toBeNull()
    expect(hint).toMatch(/mate.*against/)
    expect(hint).not.toMatch(/holds out longest/)
  })
})
