// @vitest-environment node
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { CURATED_FILE, PUZZLES_JSON, buildPuzzlesJson } from './puzzles-lib'
import { bucketOf } from './puzzles-curate-lib'
import { parsePuzzleData } from '../src/puzzles/data'
import { PUZZLE_THEMES } from '../src/puzzles/themes'
import type { RatedPuzzle } from '../src/puzzles/types'

function bundled(): RatedPuzzle[] {
  const set = parsePuzzleData(JSON.parse(readFileSync(PUZZLES_JSON, 'utf8')))
  if (!set) throw new Error('public/puzzles/puzzles.json is unreadable')
  return set
}

describe('bundled puzzles', () => {
  // Breaks when the CSV is edited (or the builder changes) without `npm run puzzles`.
  test('the committed JSON is exactly what the curated CSV builds to (fix: npm run puzzles)', () => {
    expect(readFileSync(PUZZLES_JSON, 'utf8') === buildPuzzlesJson()).toBe(true)
  }, 120_000)

  test('about three thousand unique puzzles, none dropped by the browser parser', () => {
    const rows = (JSON.parse(readFileSync(PUZZLES_JSON, 'utf8')) as { puzzles: unknown[] }).puzzles
    const set = bundled()
    expect(set.length).toBe(rows.length)
    expect(set.length).toBeGreaterThanOrEqual(2900)
    expect(set.length).toBeLessThanOrEqual(3000)
    expect(new Set(set.map((p) => p.id)).size).toBe(set.length)
  })

  test('balanced across the ten rating buckets 600-2599', () => {
    const counts = Array.from({ length: 10 }, () => 0)
    for (const p of bundled()) {
      const b = bucketOf(p.rating)
      if (b === null) throw new Error(`${p.id} rating ${p.rating} is out of range`)
      counts[b] = (counts[b] ?? 0) + 1
    }
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(250)
  })

  test('every theme in the filter has puzzles', () => {
    const set = bundled()
    for (const t of PUZZLE_THEMES) expect(set.filter((p) => p.themes.includes(t)).length, t).toBeGreaterThanOrEqual(10)
  })

  test('small enough to fetch lazily', () => {
    expect(statSync(PUZZLES_JSON).size).toBeLessThan(800 * 1024)
    expect(statSync(CURATED_FILE).size).toBeLessThan(800 * 1024)
  })
})
