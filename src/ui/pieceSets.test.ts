import { afterEach, expect, test, vi } from 'vitest'
import { PIECE_SETS, pieceImageSrc, pieceSetOf } from './pieceSets'

test('two piece sets, Rhosgfx first (the existing default set)', () => {
  expect(PIECE_SETS.map((p) => p.id)).toEqual(['rhosgfx', 'cburnett'])
})

test('unknown ids fall back to rhosgfx (e.g. a setting saved by a future version)', () => {
  expect(pieceSetOf('cburnett').id).toBe('cburnett')
  expect(pieceSetOf('bogus').id).toBe('rhosgfx')
})

test('image src is namespaced by set id, so the two sets never collide', () => {
  expect(pieceImageSrc('rhosgfx', 'wK')).toBe('/pieces/rhosgfx/wK.svg')
  expect(pieceImageSrc('cburnett', 'bQ')).toBe('/pieces/cburnett/bQ.svg')
  // Unknown id falls back to rhosgfx, same as pieceSetOf.
  expect(pieceImageSrc('bogus', 'wP')).toBe('/pieces/rhosgfx/wP.svg')
})

// Breaks if the src goes back to a root-absolute path: on GitHub Pages the
// app is served from /chess-game/, where /pieces/... is a 404.
test('image src follows the deploy base', () => {
  vi.stubEnv('BASE_URL', '/chess-game/')
  expect(pieceImageSrc('cburnett', 'wK')).toBe('/chess-game/pieces/cburnett/wK.svg')
})

afterEach(() => vi.unstubAllEnvs())
