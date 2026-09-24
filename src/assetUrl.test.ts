import { afterEach, expect, test, vi } from 'vitest'
import { assetUrl } from './assetUrl'

afterEach(() => vi.unstubAllEnvs())

// Breaks if a caller goes back to a root-absolute string: at the default
// base the result is byte-identical to the old hardcoded paths.
test('the default base is the domain root', () => {
  expect(assetUrl('puzzles/puzzles.json')).toBe('/puzzles/puzzles.json')
  expect(assetUrl('/puzzles/puzzles.json')).toBe('/puzzles/puzzles.json')
})

// Breaks if a subpath deploy (GitHub Pages) would request the domain root.
test('a subpath deploy keeps every asset under its base', () => {
  vi.stubEnv('BASE_URL', '/chess-game/')
  expect(assetUrl('engine/stockfish-19-lite-single.js')).toBe('/chess-game/engine/stockfish-19-lite-single.js')
  expect(assetUrl('/pieces/cburnett/wK.svg')).toBe('/chess-game/pieces/cburnett/wK.svg')
})

test('a base without a trailing slash still joins cleanly', () => {
  vi.stubEnv('BASE_URL', '/chess-game')
  expect(assetUrl('openings/openings.json')).toBe('/chess-game/openings/openings.json')
})
