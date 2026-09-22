import { describe, expect, test } from 'vitest'
import { buildConfig, timeControlFor } from './matchConfig'

describe('timeControlFor', () => {
  test('a known id maps to its control; an unknown one falls back to untimed', () => {
    expect(timeControlFor('blitz-3-2')).toEqual({ kind: 'timed', initialMs: 180_000, incrementMs: 2_000 })
    expect(timeControlFor('nope')).toEqual({ kind: 'untimed' })
  })
})

describe('buildConfig', () => {
  const base = { level: 4 as const, timeControlId: 'untimed', color: 'black' as const, engineAvailable: true }

  test('two-player is two humans', () => {
    const c = buildConfig({ ...base, mode: 'two-player' })
    expect([c.white.kind, c.black.kind]).toEqual(['human', 'human'])
  })

  // Breaks if the engine-unavailable degradation stops forcing two humans.
  test('no engine degrades every mode to two humans', () => {
    for (const mode of ['one-player', 'zero-player'] as const) {
      const c = buildConfig({ ...base, mode, engineAvailable: false })
      expect([c.white.kind, c.black.kind]).toEqual(['human', 'human'])
    }
  })

  test('one-player seats the human on the chosen colour', () => {
    const c = buildConfig({ ...base, mode: 'one-player' })
    expect(c.white).toEqual({ kind: 'engine', level: 4 })
    expect(c.black).toEqual({ kind: 'human' })
    expect(c.engineDelayMs).toBeUndefined()
  })

  test('zero-player is two engines with the 500 ms default delay', () => {
    const c = buildConfig({ ...base, mode: 'zero-player', timeControlId: 'rapid-10-5' })
    expect(c.white).toEqual({ kind: 'engine', level: 4 })
    expect(c.black).toEqual({ kind: 'engine', level: 4 })
    expect(c.engineDelayMs).toBe(500)
    expect(c.timeControl).toEqual({ kind: 'timed', initialMs: 600_000, incrementMs: 5_000 })
  })
})
