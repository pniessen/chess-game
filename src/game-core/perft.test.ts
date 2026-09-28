import { describe, expect, test } from 'vitest'
import { Position } from './position'
import { perft } from './perft'
import { PERFT_POSITIONS } from '../../tests/fixtures/positions'

describe('perft', () => {
  for (const pos of PERFT_POSITIONS) {
    // Depths 1-3 run on every test invocation; depth 4 is millions of nodes
    // for some positions and would make the suite unusable.
    for (let depth = 1; depth <= 3; depth++) {
      test(`${pos.name} depth ${depth}`, () => {
        expect(perft(new Position(pos.fen), depth)).toBe(pos.nodes[depth - 1])
        // Depth 3's cap is wall-clock, and this is a pure CPU benchmark
        // with no I/O to absorb contention: measured around 112-119s for
        // the whole file on a quiet machine, but the old 60s per-test cap
        // timed out for two unrelated sessions on the same afternoon when
        // several suites ran at once. A gate whose pass/fail depends on
        // how busy the machine is tells you nothing, so the cap is set
        // well clear of the real runtime rather than close to it.
      }, depth === 3 ? 180_000 : 10_000)
    }
  }
})

describe.skip('perft depth 4 (slow — run manually)', () => {
  for (const pos of PERFT_POSITIONS) {
    test(`${pos.name} depth 4`, () => {
      expect(perft(new Position(pos.fen), 4)).toBe(pos.nodes[3])
    }, 120_000)
  }
})
