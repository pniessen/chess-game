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
      }, depth === 3 ? 60_000 : 10_000)
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
