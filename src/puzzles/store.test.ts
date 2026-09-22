import { beforeEach, describe, expect, test } from 'vitest'
import {
  BLUNDER_PUZZLE_LIMIT,
  SEEN_LIMIT,
  addBlunderPuzzles,
  loadBlunderPuzzles,
  loadPuzzleStats,
  markBlunderPuzzleSolved,
  markPuzzleSeen,
  recordPuzzleResult,
} from './store'
import type { BlunderPuzzle } from './types'

const STATS = 'chess-game:puzzles'
const BLUNDERS = 'chess-game:blunder-puzzles'
const raw = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown

beforeEach(() => localStorage.clear())

describe('puzzle stats', () => {
  test('defaults: 1200, nothing played, nothing seen', () => {
    expect(loadPuzzleStats()).toEqual({ rating: 1200, games: 0, wins: 0, losses: 0, seen: [] })
  })

  test('a result updates the rating with the right K and counts it; versioned record', () => {
    expect(recordPuzzleResult(1468, 'win')).toMatchObject({ rating: 1233, games: 1, wins: 1, losses: 0 })
    expect(recordPuzzleResult(1468, 'loss')).toMatchObject({ games: 2, wins: 1, losses: 1 })
    expect(raw(STATS)).toMatchObject({ v: 1, games: 2 })
  })

  test('seen ids are kept once each, newest last, capped (oldest dropped)', () => {
    markPuzzleSeen('a')
    markPuzzleSeen('b')
    expect(markPuzzleSeen('a').seen).toEqual(['a', 'b'])
    const full = Array.from({ length: SEEN_LIMIT }, (_, i) => `p${i}`)
    localStorage.setItem(STATS, JSON.stringify({ v: 1, rating: 1200, games: 0, wins: 0, losses: 0, seen: full }))
    const seen = markPuzzleSeen('new').seen
    expect(seen).toHaveLength(SEEN_LIMIT)
    expect(seen[0]).toBe('p1')
    expect(seen.at(-1)).toBe('new')
  })

  // Breaks if corrupt storage crashes puzzle mode or is never repaired.
  test('corrupt or malformed stats reset gracefully and are overwritten', () => {
    localStorage.setItem(STATS, '{broken')
    expect(loadPuzzleStats().rating).toBe(1200)
    markPuzzleSeen('x')
    expect(raw(STATS)).toMatchObject({ v: 1, rating: 1200, seen: ['x'] })
    localStorage.setItem(STATS, JSON.stringify({ v: 1, rating: 'high', games: -3, wins: 1.5, seen: ['a', 7, null] }))
    expect(loadPuzzleStats()).toEqual({ rating: 1200, games: 0, wins: 0, losses: 0, seen: ['a'] })
  })

  // Breaks if a newer build's data is destroyed by this build (the history lesson).
  test('a record from a newer version reads as defaults and is never overwritten', () => {
    const future = JSON.stringify({ v: 2, rating: 2000, extra: true })
    localStorage.setItem(STATS, future)
    expect(loadPuzzleStats().rating).toBe(1200)
    recordPuzzleResult(1500, 'win')
    markPuzzleSeen('z')
    expect(localStorage.getItem(STATS)).toBe(future)
  })
})

describe('blunder puzzles', () => {
  const blunder = (id: string, over: Partial<BlunderPuzzle> = {}): BlunderPuzzle => ({
    id,
    fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
    solution: 'd1d8',
    bestSan: 'Qd8#',
    blunderLabel: '25. h3',
    solver: 'w',
    gameId: 'g1',
    gameDate: '2026-09-20T10:00:00.000Z',
    opening: null,
    createdAt: '2026-09-20T10:05:00.000Z',
    solved: false,
    ...over,
  })

  test('empty by default; added ones come first, in the order given; versioned record', () => {
    expect(loadBlunderPuzzles()).toEqual([])
    addBlunderPuzzles([blunder('b:1')])
    addBlunderPuzzles([blunder('b:2'), blunder('b:3')])
    expect(loadBlunderPuzzles().map((p) => p.id)).toEqual(['b:2', 'b:3', 'b:1'])
    expect(raw(BLUNDERS)).toMatchObject({ v: 1 })
  })

  // Breaks if reviewing the same game twice (or the same position twice) duplicates puzzles.
  test('one puzzle per position: an existing id is kept as it is (solved state too)', () => {
    addBlunderPuzzles([blunder('b:1')])
    markBlunderPuzzleSolved('b:1')
    const after = addBlunderPuzzles([blunder('b:1'), blunder('b:1'), blunder('b:2')])
    expect(after.map((p) => [p.id, p.solved])).toEqual([['b:2', false], ['b:1', true]])
  })

  test(`capped at the newest ${BLUNDER_PUZZLE_LIMIT}`, () => {
    addBlunderPuzzles(Array.from({ length: BLUNDER_PUZZLE_LIMIT + 5 }, (_, i) => blunder(`b:${i}`)))
    expect(loadBlunderPuzzles()).toHaveLength(BLUNDER_PUZZLE_LIMIT)
  })

  test('markBlunderPuzzleSolved flags one puzzle and persists it', () => {
    addBlunderPuzzles([blunder('b:1'), blunder('b:2')])
    expect(markBlunderPuzzleSolved('b:2').find((p) => p.id === 'b:2')?.solved).toBe(true)
    expect(loadBlunderPuzzles().find((p) => p.id === 'b:1')?.solved).toBe(false)
  })

  // Breaks if a tampered entry can reach the board (illegal solution, wrong types).
  test('malformed or unplayable entries are dropped; corrupt data resets; a newer version is left alone', () => {
    localStorage.setItem(BLUNDERS, JSON.stringify({
      v: 1,
      puzzles: [blunder('ok'), { id: 3 }, null, blunder('illegal', { solution: 'h2h5' }), blunder('bad-side', { solver: 'x' as never })],
    }))
    expect(loadBlunderPuzzles().map((p) => p.id)).toEqual(['ok'])
    localStorage.setItem(BLUNDERS, '{broken')
    expect(loadBlunderPuzzles()).toEqual([])
    addBlunderPuzzles([blunder('b:1')])
    expect(loadBlunderPuzzles()).toHaveLength(1)
    const future = JSON.stringify({ v: 2, puzzles: [] })
    localStorage.setItem(BLUNDERS, future)
    addBlunderPuzzles([blunder('b:9')])
    expect(localStorage.getItem(BLUNDERS)).toBe(future)
  })
})
