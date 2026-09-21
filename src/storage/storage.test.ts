import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS, loadScore, loadSettings, saveScore, saveSettings,
} from './storage'

beforeEach(() => localStorage.clear())

describe('storage', () => {
  test('missing settings fall back to defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('settings round-trip', () => {
    saveSettings({ ...DEFAULT_SETTINGS, level: 5, orientation: 'black' })
    expect(loadSettings().level).toBe(5)
    expect(loadSettings().orientation).toBe('black')
  })

  test('malformed JSON falls back to defaults', () => {
    localStorage.setItem('chess-game:settings', '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('a value of the wrong shape falls back to defaults', () => {
    localStorage.setItem('chess-game:settings', '"a string"')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('an out-of-range level falls back to the default level', () => {
    localStorage.setItem('chess-game:settings', JSON.stringify({ level: 99 }))
    expect(loadSettings().level).toBe(DEFAULT_SETTINGS.level)
  })

  test('a failing write does not throw', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow()
    spy.mockRestore()
  })

  test('score round-trips and defaults to zeroes', () => {
    expect(loadScore()).toEqual({ wins: 0, losses: 0, draws: 0 })
    saveScore({ wins: 2, losses: 1, draws: 3 })
    expect(loadScore()).toEqual({ wins: 2, losses: 1, draws: 3 })
  })
})
