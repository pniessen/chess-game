// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Position } from '../../src/game-core/position'
import { analyzeAll, analyzeGame, nonPawnMaterial, phaseOf, scoreToCp } from './analyze'
import { ensureDirs } from './store'
import type { TrialEngine } from './stockfish'
import type { Score } from './types'
import { recordOf } from './testFixtures'

/** Scores in the order positions are asked for. */
function engineOf(scores: Score[]) {
  const asked: string[] = []
  const engine: TrialEngine = {
    async evaluate(fen) {
      asked.push(fen)
      return { score: scores[asked.length - 1] ?? { cp: 0 }, best: 'e2e4' }
    },
    fallbackMove: async () => null,
  }
  return { engine, asked }
}

describe('scores and phases', () => {
  test('mates map to +-10000 less the distance', () => {
    expect(scoreToCp({ cp: 35 })).toBe(35)
    expect(scoreToCp({ mate: 1 })).toBe(9999)
    expect(scoreToCp({ mate: -2 })).toBe(-9998)
    expect(scoreToCp({ mate: 0 })).toBe(-10000)
  })

  test('opening to ply 20, then middlegame or endgame by non-pawn material', () => {
    const start = new Position().fen()
    expect(nonPawnMaterial(start)).toBe(62)
    expect(phaseOf(20, start)).toBe('opening')
    expect(phaseOf(21, start)).toBe('middlegame')
    expect(phaseOf(21, '4k3/8/8/8/8/8/8/R3K2R w - - 0 40')).toBe('endgame')
  })
})

describe('analyzeGame', () => {
  test('a move\'s loss is the score before it less the score it leads to, from the mover\'s side, capped at 1000', async () => {
    // Fool's mate: f3 e5 g4 Qh4#. Positions 0..3 are searched; 4 is mate (not searched).
    const { engine, asked } = engineOf([{ cp: 30 }, { cp: -60 }, { cp: 200 }, { mate: 1 }])
    const a = await analyzeGame(recordOf(['f3', 'e5', 'g4', 'Qh4#']), engine, 12)
    expect(asked).toHaveLength(4)
    expect(a.plies.map((p) => [p.before, p.after, p.cpl])).toEqual([
      [30, 60, 0], // f3: 30 before, Black's -60 is White's +60 after: no loss
      [-60, -200, 140], // e5
      [200, -9999, 1000], // g4 walks into mate: capped
      [9999, 10000, 0], // Qh4# is the best there is
    ])
    expect(a.plies.map((p) => p.phase)).toEqual(['opening', 'opening', 'opening', 'opening'])
    expect(a.depth).toBe(12)
  })

  test('a move into a drawn position scores 0 after it', async () => {
    const { engine } = engineOf([{ cp: 0 }, { cp: 0 }, { cp: 0 }, { cp: 0 }, { cp: 0 }, { cp: 0 }, { cp: 0 }, { cp: 120 }])
    const a = await analyzeGame(recordOf(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']), engine)
    // The eighth move completes the threefold repetition: after is 0, so Black (at +120 before) lost 120.
    expect(a.plies.at(-1)).toMatchObject({ before: 120, after: 0, cpl: 120 })
  })

  test('analyzeAll caches per game and depth; a replayed game is analysed again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trial-analysis-'))
    await ensureDirs(dir)
    const g = recordOf(['e4', 'e5'], { termination: 'adjudicated' })
    const first = engineOf([])
    await analyzeAll(dir, [g], async () => first.engine)
    expect(first.asked).toHaveLength(3)
    const second = engineOf([])
    await analyzeAll(dir, [g], async () => second.engine)
    expect(second.asked).toHaveLength(0)
    await analyzeAll(dir, [g], async () => second.engine, { depth: 10 })
    expect(second.asked).toHaveLength(3)
    const third = engineOf([])
    await analyzeAll(dir, [recordOf(['d4', 'd5'], { termination: 'adjudicated' })], async () => third.engine)
    expect(third.asked).toHaveLength(3)
    await rm(dir, { recursive: true })
  })
})
