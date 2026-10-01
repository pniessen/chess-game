// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient } from '../../server/claude'
import { costUsd } from '../../src/claude/models'
import type { GameAnalysis } from './analyze'
import { readLedger } from './budget'
import { commentaryPrompt, excerptsFor, styleFacts, writeCommentary } from './commentary'
import { computeStats } from './stats'
import { ensureDirs } from './store'
import { recordOf } from './testFixtures'

const games = [recordOf(['f3', 'e5', 'g4', 'Qh4#'], { gameId: 'g1', result: '0-1', winner: 'b', termination: 'checkmate' })]
const analyses = new Map<string, GameAnalysis>([
  [
    'g1',
    {
      v: 1,
      gameId: 'g1',
      depth: 14,
      movesKey: '',
      plies: games[0]!.moves.map((m) => ({ ply: m.ply, side: m.side, model: m.model, san: m.san, fallback: false, phase: 'opening' as const, best: m.ply === 3 ? 'e2e4' : null, before: 0, after: 0, cpl: m.ply === 3 ? 1000 : 0 })),
    },
  ],
])
const stats = computeStats(['haiku', 'jev'], games, analyses)
const haiku = stats.perModel.find((m) => m.model === 'haiku')!

describe('the style commentary', () => {
  test('the prompt carries only the computed stats and short excerpts, and forbids unsupported claims', () => {
    const p = commentaryPrompt(styleFacts(haiku, stats.field), excerptsFor(haiku, games, analyses))
    expect(p.system).toMatch(/3 to 5 bullets/)
    expect(p.system).toMatch(/Claim nothing the statistics or excerpts below do not support/)
    expect(p.user).toContain('"model": "Claude Haiku 4.5"')
    expect(p.user).toContain('"fieldAverages"')
    // The costliest move in context, with Stockfish's preference in SAN.
    expect(p.user).toContain('2. g4 {loses 1000 cp; Stockfish preferred e4}')
    expect(p.user).toContain('As White vs Jev (0-1, checkmate, 4 plies), first moves: 1. f3 1... e5 2. g4 2... Qh4#')
    // No whole PGN, no keys, no per-call costs.
    expect(p.user).not.toContain('[Event')
    expect(p.user).not.toMatch(/sk-ant|costUsd/)
  })

  test('one Opus call, charged to the trial ledger as commentary, then served from the cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trial-commentary-'))
    await ensureDirs(dir)
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = []
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          sent.push(params)
          return {
            content: [{ type: 'text', text: JSON.stringify({ bullets: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'] }) }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3000, output_tokens: 500 },
          } as unknown as Anthropic.Message
        },
      },
    }
    const prompt = commentaryPrompt(styleFacts(haiku, stats.field), [])
    const c = await writeCommentary(client, dir, haiku, prompt)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.model).toBe('claude-opus-5-5')
    expect(c.bullets).toEqual(['One.', 'Two.', 'Three.', 'Four.', 'Five.'])
    const ledger = await readLedger(dir)
    expect(ledger.entries).toMatchObject([{ kind: 'commentary', model: 'opus', about: 'haiku', inputTokens: 3000, outputTokens: 500 }])
    expect(ledger.commentaryUsd).toBeCloseTo(costUsd('opus', { input_tokens: 3000, output_tokens: 500 }))
    expect(ledger.moveUsd).toBe(0)

    const again = await writeCommentary(client, dir, haiku, prompt)
    expect(again.cached).toBe(true)
    expect(sent).toHaveLength(1)
    expect((await readLedger(dir)).entries).toHaveLength(1)
    await rm(dir, { recursive: true })
  })
})
