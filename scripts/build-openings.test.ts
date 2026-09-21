// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { OUTPUT_FILE, buildOpeningsJson } from './openings-lib'
import { parseOpeningsData } from '../src/openings/data'
import { OpeningBook } from '../src/openings/book'
import { gameFromSan } from '../src/game-core/io'

describe('vendored openings', () => {
  test('the committed JSON is exactly what the TSVs build to (fix: npm run openings)', () => {
    expect(readFileSync(OUTPUT_FILE, 'utf8') === buildOpeningsJson()).toBe(true)
  }, 120_000)

  test('it is the full lichess dataset', () => {
    const data = parseOpeningsData(JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')))
    expect(data).not.toBeNull()
    expect(data?.openings.length).toBeGreaterThan(3000)
    expect(data?.openings.some(([eco, name]) => eco === 'B20' && name === 'Sicilian Defense')).toBe(true)
  })

  test('real transpositions reach the same name (Najdorf by two move orders)', () => {
    const data = parseOpeningsData(JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')))
    if (!data) throw new Error('no data')
    const book = new OpeningBook(data)
    const nameOf = (sans: string[]) => {
      const r = gameFromSan(sans)
      if (!r.ok) throw new Error(r.error)
      return book.identify(r.game.epds(sans.length))?.name
    }
    const main = nameOf(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])
    const transposed = nameOf(['e4', 'c5', 'Nc3', 'd6', 'Nf3', 'Nf6', 'd4', 'cxd4', 'Nxd4', 'a6'])
    expect(main).toBe('Sicilian Defense: Najdorf Variation')
    expect(transposed).toBe(main)
    expect(nameOf(['e4', 'c5'])).toBe('Sicilian Defense')
  })
})
