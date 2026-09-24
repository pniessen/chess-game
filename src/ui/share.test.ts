import { afterEach, describe, expect, test, vi } from 'vitest'
import { Game } from '../game-core/game'
import { STARTING_FEN } from '../game-core/types'
import { buildShareQuery, buildShareUrl, parseShareLink } from './share'

/** e4 e5 Nf3 — three played moves from the standard start. */
function threeMoveGame(): Game {
  const game = new Game()
  game.play({ from: 'e2', to: 'e4' })
  game.play({ from: 'e7', to: 'e5' })
  game.play({ from: 'g1', to: 'f3' })
  return game
}

describe('buildShareQuery', () => {
  test('carries the FEN of the currently displayed position', () => {
    const game = threeMoveGame()
    const query = buildShareQuery(game)
    const params = new URLSearchParams(query)
    expect(params.get('fen')).toBe(game.current().fen())
  })

  test('includes the move list when the game started from the standard position', () => {
    const game = threeMoveGame()
    const params = new URLSearchParams(buildShareQuery(game))
    expect(params.get('moves')).toBe('e4 e5 Nf3')
  })

  test('reflects a position mid-browse (game.ply), not the live position', () => {
    const game = threeMoveGame()
    game.goTo(1) // back to after 1.e4
    const params = new URLSearchParams(buildShareQuery(game))
    expect(params.get('fen')).toBe(game.current().fen())
    expect(params.get('moves')).toBe('e4')
  })

  test('omits the move list for a game that started from a custom position', () => {
    const custom = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const game = new Game({ fen: custom })
    const params = new URLSearchParams(buildShareQuery(game))
    expect(params.get('fen')).toBe(custom)
    expect(params.get('moves')).toBeNull()
  })

  test('omits the empty move list at the start position', () => {
    const game = new Game()
    const params = new URLSearchParams(buildShareQuery(game))
    expect(params.get('fen')).toBe(STARTING_FEN)
    expect(params.get('moves')).toBeNull()
  })
})

describe('buildShareUrl', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('is absolute, under the current origin, at the default (root) base', () => {
    const game = threeMoveGame()
    const url = buildShareUrl(game)
    expect(url.startsWith(window.location.origin)).toBe(true)
    expect(url).toBe(`${window.location.origin}/${buildShareQuery(game)}`)
  })

  // Review round 1 (Task 14) polish: the previous version of this test
  // passed even with `prefixedBase` deleted from buildShareUrl entirely —
  // it never actually exercised a non-root base. This is the same
  // `vi.stubEnv('BASE_URL', ...)` mechanism assetUrl.test.ts uses for the
  // identical GitHub Pages concern.
  test('under the GitHub Pages base path, the link carries the /chess-game/ prefix', () => {
    vi.stubEnv('BASE_URL', '/chess-game/')
    const game = threeMoveGame()
    const url = buildShareUrl(game)
    expect(url).toBe(`${window.location.origin}/chess-game/${buildShareQuery(game)}`)
  })

  test('a base without a trailing slash still joins cleanly', () => {
    vi.stubEnv('BASE_URL', '/chess-game')
    const game = threeMoveGame()
    const url = buildShareUrl(game)
    expect(url).toBe(`${window.location.origin}/chess-game/${buildShareQuery(game)}`)
  })
})

describe('parseShareLink', () => {
  test('no fen param at all: none', () => {
    expect(parseShareLink('')).toEqual({ kind: 'none' })
    expect(parseShareLink('?foo=bar')).toEqual({ kind: 'none' })
  })

  test('round-trips a built share query back to the same position, replaying the moves', () => {
    const game = threeMoveGame()
    const result = parseShareLink(buildShareQuery(game))
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.position.game.current().fen()).toBe(game.current().fen())
    // The move list reconstructed too, not just a bare FEN with no history.
    expect(result.position.game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3'])
  })

  test('a bare FEN with no moves param loads as a single-position game', () => {
    const result = parseShareLink(`?fen=${encodeURIComponent(STARTING_FEN)}`)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.position.game.current().fen()).toBe(STARTING_FEN)
    expect(result.position.game.moves.length).toBe(0)
  })

  test('a moves param that does not match the fen falls back to the FEN alone', () => {
    const game = threeMoveGame()
    const wrongMoves = 'd4 d5'
    const query = `?fen=${encodeURIComponent(game.current().fen())}&moves=${encodeURIComponent(wrongMoves)}`
    const result = parseShareLink(query)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.position.game.current().fen()).toBe(game.current().fen())
    // Fell all the way back to a bare FEN load: no history reconstructed.
    expect(result.position.game.moves.length).toBe(0)
  })

  test('a garbage fen is reported as an error, never thrown', () => {
    const result = parseShareLink('?fen=not-a-fen-at-all')
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') throw new Error('expected error')
    expect(result.message.length).toBeGreaterThan(0)
  })

  test('an empty fen param is an error', () => {
    const result = parseShareLink('?fen=')
    expect(result.kind).toBe('error')
  })

  test('an absurdly long fen param is rejected defensively, never thrown or hung', () => {
    const hostile = 'x'.repeat(50_000)
    const result = parseShareLink(`?fen=${hostile}`)
    expect(result.kind).toBe('error')
  })

  test('a garbage moves param with a valid fen still falls back to the FEN', () => {
    const game = threeMoveGame()
    const query = `?fen=${encodeURIComponent(game.current().fen())}&moves=${encodeURIComponent('not;valid<>san')}`
    const result = parseShareLink(query)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('expected ok')
    expect(result.position.game.current().fen()).toBe(game.current().fen())
  })

  test('a malformed query string never throws', () => {
    expect(() => parseShareLink('%%%not%valid%%%')).not.toThrow()
  })
})
