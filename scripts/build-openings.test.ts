// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { OUTPUT_FILE, buildOpeningsJson } from './openings-lib'
import { parseOpeningsData } from '../src/openings/data'

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
})
