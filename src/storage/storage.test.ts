import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS, addHistoryEntry, loadHistory, loadInProgress, loadScore, loadSettings, saveInProgress,
  saveScore, saveSettings, updateHistoryAccuracy, HISTORY_LIMIT, type HistoryEntry,
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

  test('showEval defaults to true, including for settings saved before it existed', () => {
    expect(loadSettings().showEval).toBe(true)
    localStorage.setItem('chess-game:settings', JSON.stringify({ level: 2 }))
    expect(loadSettings().showEval).toBe(true)
    saveSettings({ ...DEFAULT_SETTINGS, showEval: false })
    expect(loadSettings().showEval).toBe(false)
  })
})

describe('in-progress game storage', () => {
  const SETUP = {
    white: { kind: 'human' },
    black: { kind: 'engine', level: 2 },
    timeControl: { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 },
  } as const

  test('round-trips the PGN, the seat setup and the scored flag', () => {
    saveInProgress({ pgn: '1. e4 *', setup: SETUP, scored: true })
    expect(loadInProgress()).toEqual({ pgn: '1. e4 *', setup: SETUP, scored: true })
  })

  test('an old-format bare PGN string still loads, as a setup-less (two-player) game', () => {
    localStorage.setItem('chess-game:in-progress', JSON.stringify('1. e4 e5 *'))
    expect(loadInProgress()).toEqual({ pgn: '1. e4 e5 *', setup: null, scored: false })
  })

  test('a malformed setup degrades to setup: null instead of crashing', () => {
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({ v: 2, pgn: '1. e4 *', setup: { white: { kind: 'engine', level: 42 } }, scored: 'yes' }),
    )
    expect(loadInProgress()).toEqual({ pgn: '1. e4 *', setup: null, scored: false })
  })

  test('garbage loads as no game at all', () => {
    localStorage.setItem('chess-game:in-progress', '{not json')
    expect(loadInProgress()).toBeNull()
    localStorage.setItem('chess-game:in-progress', JSON.stringify({ nope: 1 }))
    expect(loadInProgress()).toBeNull()
  })
})

describe('history', () => {
  const entry = (id: string): HistoryEntry => ({
    id,
    date: '2026-09-21T10:00:00.000Z',
    result: '1-0',
    termination: 'normal',
    opening: 'B20 Sicilian Defense',
    pgn: '1. e4 c5 *',
    accuracy: null,
    white: 'Human',
    black: 'Stockfish (level 3)',
  })

  test('empty by default; newest first; versioned record', () => {
    expect(loadHistory()).toEqual([])
    addHistoryEntry(entry('a'))
    addHistoryEntry(entry('b'))
    expect(loadHistory().map((e) => e.id)).toEqual(['b', 'a'])
    expect(JSON.parse(localStorage.getItem('chess-game:history') ?? 'null')).toMatchObject({ v: 1 })
  })

  test(`capped at the newest ${HISTORY_LIMIT}`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) addHistoryEntry(entry(`g${i}`))
    const all = loadHistory()
    expect(all).toHaveLength(HISTORY_LIMIT)
    expect(all[0]?.id).toBe(`g${HISTORY_LIMIT + 4}`)
  })

  test('accuracy can be added later', () => {
    addHistoryEntry(entry('a'))
    updateHistoryAccuracy('a', { w: 91.2, b: 64 })
    expect(loadHistory()[0]?.accuracy).toEqual({ w: 91.2, b: 64 })
  })

  test('malformed entries are dropped; an unknown version reads as empty', () => {
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 1, games: [entry('ok'), { id: 3 }, null] }))
    expect(loadHistory().map((e) => e.id)).toEqual(['ok'])
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 9, games: [entry('x')] }))
    expect(loadHistory()).toEqual([])
    localStorage.setItem('chess-game:history', '{broken')
    expect(loadHistory()).toEqual([])
  })
})
