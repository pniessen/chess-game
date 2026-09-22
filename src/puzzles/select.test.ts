import { describe, expect, test } from 'vitest'
import { selectPuzzle } from './select'
import type { RatedPuzzle } from './types'
import { DEFENCE } from '../../tests/fixtures/puzzles'

const mk = (id: string, rating: number, themes: string[] = []): RatedPuzzle => ({ ...DEFENCE, id, rating, themes })
const SET = [mk('a', 1150), mk('b', 1310), mk('c', 1450, ['fork']), mk('d', 2100, ['fork']), mk('e', 1195)]
const base = { rating: 1200, seen: new Set<string>(), theme: null, random: () => 0 }

describe('selectPuzzle', () => {
  test('nearest window first (±100): only a and e qualify; random picks among them in data order', () => {
    expect(selectPuzzle(SET, base)?.id).toBe('a')
    expect(selectPuzzle(SET, { ...base, random: () => 0.99 })?.id).toBe('e')
  })

  // Breaks if the window never widens (a strong or weak user would get nothing).
  test('the window widens until something fits', () => {
    expect(selectPuzzle(SET, { ...base, rating: 1800 })?.id).toBe('c') // ±400 → c and d, data order → c
    expect(selectPuzzle(SET, { ...base, rating: 2800 })?.id).toBe('d') // ±800 → d only
    expect(selectPuzzle(SET, { ...base, rating: 4000 })?.id).toBe('a') // nothing within 800: anything
  })

  // Breaks if seen puzzles are served again while unseen ones remain.
  test('unseen puzzles first; once all are seen they come round again', () => {
    expect(selectPuzzle(SET, { ...base, seen: new Set(['a', 'e']) })?.id).toBe('b')
    expect(selectPuzzle(SET, { ...base, seen: new Set(['a', 'b', 'c', 'd', 'e']) })?.id).toBe('a')
  })

  test('theme filter; null when nothing has the theme', () => {
    expect(selectPuzzle(SET, { ...base, theme: 'fork' })?.id).toBe('c')
    expect(selectPuzzle(SET, { ...base, theme: 'zugzwang' })).toBeNull()
    expect(selectPuzzle([], base)).toBeNull()
  })

  test('Next never repeats the current puzzle, even when everything is seen', () => {
    expect(selectPuzzle(SET, { ...base, excludeId: 'a' })?.id).toBe('e')
    expect(selectPuzzle([mk('only', 1200)], { ...base, excludeId: 'only' })).toBeNull()
  })

  test('a random() of exactly 1 cannot index past the end', () => {
    expect(selectPuzzle(SET, { ...base, random: () => 1 })?.id).toBe('e')
  })
})
