import { describe, expect, test } from 'vitest'
import { templatedHint } from './templated'
import { suggestionFrom } from './hints'
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

  // Controller ruling: templatedHint and the hint's arrow (coach/hints.ts
  // suggestionFrom) must derive from the SAME engine line, via the ONE
  // selection rule in engine/uci.ts's principalLine. This constructs info
  // lines where "first multipv=1 line at the max depth" (e2e4) and "last
  // multipv=1 line at the max depth" (d2d4) differ, so a regression to two
  // independent selections (e.g. templatedHint reverting to its old
  // depth-strictly-greater loop) would pick e2e4 here while suggestionFrom
  // picks d2d4 — and this test would catch that divergence.
  test('arrow move and templated text agree on the same line when first-at-depth and last-at-depth differ', () => {
    const lines: EngineInfo[] = [
      { depth: 10, multipv: 1, scoreCp: 40, pv: ['e2e4'] }, // first line at the max depth
      { depth: 10, multipv: 1, scoreCp: 35, pv: ['d2d4'] }, // last line at the max depth
    ]
    const pos = new Position()

    const hint = templatedHint(lines, pos)
    const suggestion = suggestionFrom(lines, pos)

    expect(suggestion?.san).toBe('d4')
    expect(hint).toContain('d4')
    expect(hint).not.toContain('e4')
    // Same move, not just similar wording.
    expect(hint).toContain(suggestion!.san)
  })
})
