// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { ClaudeModelKey } from '../../src/claude/models'
import { buildSchedule, nextAction, type GameSpec } from './schedule'

const ALL: ClaudeModelKey[] = ['fable', 'opus', 'sonnet', 'haiku', 'jev', 'gemini-pro', 'gemini-flash']

describe('buildSchedule', () => {
  const games = buildSchedule(ALL, 4)

  test('all 7 seats: 21 pairings x 4 games = 84, unique ids', () => {
    expect(games).toHaveLength(84)
    expect(new Set(games.map((g) => g.id)).size).toBe(84)
    const pairs = new Set(games.map((g) => g.pair))
    expect(pairs.size).toBe(21)
    for (const g of games) expect(g.white).not.toBe(g.black)
  })

  test('colours are 2/2 within every pairing, and 12/12 per model', () => {
    const byPair = new Map<string, GameSpec[]>()
    for (const g of games) byPair.set(g.pair, [...(byPair.get(g.pair) ?? []), g])
    for (const list of byPair.values()) {
      expect(list).toHaveLength(4)
      const [a, b] = list[0]!.pair.split('|') as [ClaudeModelKey, ClaudeModelKey]
      expect(list.filter((g) => g.white === a)).toHaveLength(2)
      expect(list.filter((g) => g.white === b)).toHaveLength(2)
    }
    for (const m of ALL) {
      expect(games.filter((g) => g.white === m)).toHaveLength(12)
      expect(games.filter((g) => g.black === m)).toHaveLength(12)
    }
  })

  test('ids are stable whatever order the models are given in', () => {
    const shuffled = buildSchedule([...ALL].reverse(), 4)
    expect(new Set(shuffled.map((g) => `${g.id}:${g.white}`))).toEqual(new Set(games.map((g) => `${g.id}:${g.white}`)))
  })

  test('each round of the circle method pairs disjoint models, so concurrent games are possible from the start', () => {
    // The first three games of the order share no model.
    const first = games.slice(0, 3).flatMap((g) => [g.white, g.black])
    expect(new Set(first).size).toBe(6)
  })

  test('the pilot: three models, one game per pair', () => {
    const pilot = buildSchedule(['haiku', 'jev', 'gemini-flash'], 1)
    expect(pilot).toHaveLength(3)
    expect(new Set(pilot.map((g) => g.pair)).size).toBe(3)
    // With one game per pair the colours still spread: no model is White in every game.
    for (const m of ['haiku', 'jev', 'gemini-flash'] as const) {
      const mine = pilot.filter((g) => g.white === m || g.black === m)
      expect(mine).toHaveLength(2)
    }
  })

  test('refuses fewer than two models, duplicates and a non-positive game count', () => {
    expect(() => buildSchedule(['haiku'], 4)).toThrow()
    expect(() => buildSchedule(['haiku', 'haiku'], 4)).toThrow()
    expect(() => buildSchedule(['haiku', 'jev'], 0)).toThrow()
  })
})

describe('nextAction: the same-model rule and the cap', () => {
  const games = buildSchedule(ALL, 4)
  const always = () => true

  test('never starts a game whose model is already playing', () => {
    const busy = new Set<ClaudeModelKey>([games[0]!.white])
    const a = nextAction(games, busy, 1, always)
    expect(a.kind).toBe('start')
    if (a.kind === 'start') {
      expect(a.spec.white).not.toBe(games[0]!.white)
      expect(a.spec.black).not.toBe(games[0]!.white)
    }
  })

  test('waits when every pending game has a busy model', () => {
    const pending = games.filter((g) => g.pair === 'opus|haiku')
    expect(nextAction(pending, new Set<ClaudeModelKey>(['opus']), 1, always)).toEqual({ kind: 'wait' })
  })

  test('in order: an unaffordable next game waits for running ones, and blocks when nothing runs', () => {
    const tooDear = (g: GameSpec) => g.id !== games[0]!.id
    expect(nextAction(games, new Set(), 1, tooDear)).toEqual({ kind: 'wait' })
    expect(nextAction(games, new Set(), 0, tooDear)).toEqual({ kind: 'blocked', spec: games[0] })
  })

  test('done when nothing is pending', () => {
    expect(nextAction([], new Set(), 0, always)).toEqual({ kind: 'done' })
  })
})
