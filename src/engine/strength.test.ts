import { describe, expect, test } from 'vitest'
import { LEVELS, profileFor } from './strength'
import type { Level } from '../storage/storage'

const ALL: Level[] = [1, 2, 3, 4, 5, 6, 7, 8]

describe('strength ladder', () => {
  test('there are exactly eight levels', () => {
    expect(LEVELS).toHaveLength(8)
  })

  test('every level has a non-empty label', () => {
    for (const l of ALL) expect(profileFor(l).label.length).toBeGreaterThan(0)
  })

  test('the top level is full strength with no blunders', () => {
    const top = profileFor(8)
    expect(top.blunderChance).toBe(0)
    expect(top.skillLevel).toBe(20)
  })

  test('difficulty is monotonic: depth never decreases', () => {
    for (let i = 1; i < ALL.length; i++) {
      expect(profileFor(ALL[i]!).depth).toBeGreaterThanOrEqual(profileFor(ALL[i - 1]!).depth)
    }
  })

  test('blunder chance never increases as the level rises', () => {
    for (let i = 1; i < ALL.length; i++) {
      expect(profileFor(ALL[i]!).blunderChance).toBeLessThanOrEqual(
        profileFor(ALL[i - 1]!).blunderChance,
      )
    }
  })

  test('levels below 4 do not use UCI_Elo, because its floor is 1320', () => {
    for (const l of [1, 2, 3] as Level[]) expect(profileFor(l).uciElo).toBeNull()
  })

  test("levels 4 and up use UCI_Elo within the engine's supported range", () => {
    for (const l of [4, 5, 6, 7, 8] as Level[]) {
      const elo = profileFor(l).uciElo
      if (elo !== null) {
        expect(elo).toBeGreaterThanOrEqual(1320)
        expect(elo).toBeLessThanOrEqual(3190)
      }
    }
  })

  test('a level that blunders has a pool to blunder from', () => {
    for (const l of ALL) {
      const p = profileFor(l)
      if (p.blunderChance > 0) expect(p.blunderPool).toBeGreaterThan(1)
    }
  })
})
