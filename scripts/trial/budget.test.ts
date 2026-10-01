// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RESERVE_PER_GAME_USD } from '../../src/claude/models'
import { canCall, canStart, committedUsd, readLedger, appendLedger, reserveFor } from './budget'

describe('the cap guard', () => {
  test('a game starts only if spent + running holds + both seats\' reserves fit under the cap', () => {
    const reserve = reserveFor('opus', 'haiku')
    expect(reserve).toBeCloseTo(RESERVE_PER_GAME_USD.opus + RESERVE_PER_GAME_USD.haiku)
    expect(canStart(40 - reserve, [], reserve, 40)).toBe(true)
    expect(canStart(40 - reserve + 0.01, [], reserve, 40)).toBe(false)
    // A running game holds what is left of its own reserve.
    const holds = [{ reserveUsd: 1, spentUsd: 0.25 }]
    expect(committedUsd(10, holds)).toBeCloseTo(10.75)
    expect(canStart(10, holds, 29.25, 40)).toBe(true)
    expect(canStart(10, holds, 29.26, 40)).toBe(false)
  })

  test('reserves are sized for 160 plies: a longer cap holds proportionally more, a shorter one the full reserve', () => {
    expect(reserveFor('opus', 'haiku', 320)).toBeCloseTo(2 * reserveFor('opus', 'haiku'))
    expect(reserveFor('opus', 'haiku', 20)).toBeCloseTo(reserveFor('opus', 'haiku'))
  })

  test('a game that has spent past its reserve holds nothing more', () => {
    expect(committedUsd(5, [{ reserveUsd: 0.5, spentUsd: 0.8 }])).toBe(5)
  })

  test('the hard cap: no call unless its worst case still fits', () => {
    expect(canCall(39.9, 0.1, 40)).toBe(true)
    expect(canCall(39.91, 0.1, 40)).toBe(false)
  })
})

describe('the trial ledger', () => {
  test('appends one line per charge and recomputes spend from the file, by kind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trial-ledger-'))
    expect(await readLedger(dir)).toMatchObject({ spentUsd: 0, moveUsd: 0, commentaryUsd: 0, entries: [] })
    await appendLedger(dir, { kind: 'move', model: 'haiku', gameId: 'g1', costUsd: 0.001, inputTokens: 100, outputTokens: 10, ms: 2000 })
    await appendLedger(dir, { kind: 'move', model: 'jev', gameId: 'g1', costUsd: 0.0001, inputTokens: 900, outputTokens: 0, ms: 200 })
    await appendLedger(dir, { kind: 'commentary', model: 'opus', costUsd: 0.04, inputTokens: 3000, outputTokens: 800, ms: 9000 })
    const l = await readLedger(dir)
    expect(l.entries).toHaveLength(3)
    expect(l.spentUsd).toBeCloseTo(0.0411)
    expect(l.moveUsd).toBeCloseTo(0.0011)
    expect(l.commentaryUsd).toBeCloseTo(0.04)
  })

  test('a torn last line (a crash mid-write) is skipped, not fatal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trial-ledger-'))
    await appendLedger(dir, { kind: 'move', model: 'haiku', gameId: 'g1', costUsd: 0.002, inputTokens: 1, outputTokens: 1, ms: 1 })
    await appendFile(join(dir, 'ledger.jsonl'), '{"kind":"move","cost')
    expect((await readLedger(dir)).spentUsd).toBeCloseTo(0.002)
  })

  test('the monthly app ledger is never the trial ledger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trial-ledger-'))
    await writeFile(join(dir, 'unrelated.json'), '{}')
    await appendLedger(dir, { kind: 'move', model: 'haiku', gameId: 'g1', costUsd: 0.002, inputTokens: 1, outputTokens: 1, ms: 1 })
    expect((await readLedger(dir)).file).toBe(join(dir, 'ledger.jsonl'))
    expect((await readLedger(dir)).file).not.toContain('claude-games')
  })
})
