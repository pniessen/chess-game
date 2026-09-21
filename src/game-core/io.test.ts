import { describe, expect, test } from 'vitest'
import { Game } from './game'
import { exportPgn, importFen, importPgn } from './io'

function playedGame(): Game {
  const g = new Game()
  g.play({ from: 'e2', to: 'e4' })
  g.play({ from: 'e7', to: 'e5' })
  g.play({ from: 'g1', to: 'f3' })
  return g
}

describe('PGN', () => {
  test('export includes the moves', () => {
    const pgn = exportPgn(playedGame())
    expect(pgn).toContain('1. e4 e5')
    expect(pgn).toContain('Nf3')
  })

  test('export includes the headers we set', () => {
    const pgn = exportPgn(playedGame(), { White: 'Alice', Black: 'Stockfish' })
    expect(pgn).toContain('[White "Alice"]')
    expect(pgn).toContain('[Black "Stockfish"]')
  })

  test('a game round-trips through export and import', () => {
    const before = playedGame()
    const result = importPgn(exportPgn(before))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.game.moves.map((m) => m.san)).toEqual(
      before.moves.map((m) => m.san),
    )
  })

  test('a malformed PGN reports an error and does not throw', () => {
    const result = importPgn('1. e4 e5 2. Qxz9 ??')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.length).toBeGreaterThan(0)
  })

  test('empty input is an error, not an empty game', () => {
    expect(importPgn('   ').ok).toBe(false)
  })
})

describe('FEN', () => {
  test('a valid FEN loads', () => {
    const r = importFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.game.current().turn()).toBe('w')
  })

  test('a malformed FEN reports an error', () => {
    const r = importFen('this is not a fen')
    expect(r.ok).toBe(false)
  })

  test('a FEN with too few ranks reports an error', () => {
    expect(importFen('8/8/8 w - - 0 1').ok).toBe(false)
  })
})
