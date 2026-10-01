// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { buildSchedule } from './schedule'
import { estimateTrial, gameSeconds, sideCostUsd, simulateWallSeconds } from './estimate'

describe('the dry-run estimate', () => {
  test('a side\'s cost grows with the history; Jev\'s does not', () => {
    expect(sideCostUsd('haiku', 2, true)).toBeCloseTo(0.0008)
    expect(sideCostUsd('haiku', 2, false)).toBeCloseTo(0.0008 * 1.007)
    expect(sideCostUsd('jev', 160, true)).toBeCloseTo(80 * 0.000045)
    expect(sideCostUsd('haiku', 160, true)).toBeGreaterThan(80 * 0.0008)
  })

  test('wall time respects the slots and the same-model rule', () => {
    const two = buildSchedule(['haiku', 'jev'], 2)
    // Same pair twice: never in parallel, whatever the slots.
    expect(simulateWallSeconds(two, 3, () => 10)).toBe(20)
    const four = buildSchedule(['haiku', 'jev', 'opus', 'sonnet'], 1)
    // Six games; each round of the circle method has two disjoint games.
    expect(simulateWallSeconds(four, 3, () => 10)).toBe(30)
    expect(simulateWallSeconds(four, 1, () => 10)).toBe(60)
  })

  test('the full field: 84 games, two scenarios, every model in 24 games', () => {
    const all = buildSchedule(['fable', 'opus', 'sonnet', 'haiku', 'jev', 'gemini-pro', 'gemini-flash'], 4)
    const e = estimateTrial(all, { maxPlies: 160, concurrency: 3 })
    expect(e.games).toBe(84)
    expect(e.scenarios).toHaveLength(2)
    expect(e.scenarios[1]!.costUsd).toBeGreaterThan(e.scenarios[0]!.costUsd)
    for (const m of e.perModel) expect(m.games).toBe(24)
    expect(gameSeconds(all[0]!, 2)).toBeGreaterThan(0)
  })
})
