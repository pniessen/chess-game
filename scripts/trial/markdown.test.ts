// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { buildMarkdown } from './markdown'
import { computeStats } from './stats'
import { recordOf } from './testFixtures'
import type { GameRecord } from './types'

const games: GameRecord[] = [
  recordOf(['f3', 'e5', 'g4', 'Qh4#'], { gameId: 'haiku-jev-1', result: '0-1', winner: 'b', termination: 'checkmate' }),
  recordOf(['e4', 'e5'], { gameId: 'haiku-jev-2', white: 'jev', black: 'haiku', result: '1/2-1/2', termination: 'adjudicated', adjudication: { depth: 18, evalCp: 12, mate: null } }),
]

describe('report.md', () => {
  const md = buildMarkdown({
    config: { v: 1, trialId: 'pilot-x', createdAt: '', models: ['haiku', 'jev'], gamesPerPair: 2, capUsd: 1, maxPlies: 20, concurrency: 3 },
    stats: computeStats(['haiku', 'jev'], games, new Map()),
    games,
    ledger: { spentUsd: 0.0123, moveUsd: 0.0023, commentaryUsd: 0.01 },
    depth: 14,
    commentary: new Map([['jev', ['Jev won its only decisive game by checkmate (1 mate given).']]]),
    generatedAt: '2026-10-01T12:00:00Z',
  })

  test('a leaderboard, a cross-table and one section per model', () => {
    expect(md).toContain('# Round-robin trial pilot-x')
    expect(md).toContain('## Leaderboard')
    expect(md).toMatch(/\| 1 \| Jev \| 75% \| 1\.5\/2 \| 1-1-0 \|/)
    expect(md).toContain('| **Haiku 4.5** | — | 0.5/2 | 0.5/2 |')
    expect(md).toContain('| **Jev** | 1.5/2 | — | 1.5/2 |')
    expect(md).toContain('## Claude Haiku 4.5')
    expect(md).toContain('## Jev')
    expect(md).toContain('- Jev won its only decisive game by checkmate (1 mate given).')
    expect(md).toContain('adjudicated at the ply cap (0.12)')
    expect(md).toContain('Spent $0.012 of the $1.00 cap: $0.0023 on moves, $0.010 on this report\'s commentary.')
    // The fixture games carry no cost, so all $0.0023 of move spend is outside them.
    expect(md).toContain('Of the move spend, $0.0023 went on games not in this report (stopped by the cap, crashed or replayed).')
  })

  test('explains its terms for a non-expert', () => {
    expect(md).toContain('## How to read this')
    expect(md).toMatch(/100 centipawns is about one pawn/)
    expect(md).toMatch(/lets a forced mate slip/)
    expect(md).not.toMatch(/Strong human players/)
  })
})
