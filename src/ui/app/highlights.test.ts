import { describe, expect, test } from 'vitest'
import { gameFromSan } from '../../game-core/io'
import { Position } from '../../game-core/position'
import { RULE_FIXTURES } from '../../../tests/fixtures/positions'
import { highlightsFor } from './highlights'

function after(sans: string[]) {
  const built = gameFromSan(sans)
  if (!built.ok) throw new Error(built.error)
  const game = built.game
  const position = game.current()
  return { position, lastMove: game.moves[game.ply - 1], displayedStatus: position.status() }
}

describe('highlightsFor', () => {
  test('idle at the start: no selection, no legal targets, no last move', () => {
    expect(highlightsFor({ selection: { kind: 'idle' }, ...after([]) })).toEqual({ legal: [] })
  })

  test('a selected piece shows its legal targets; the last move is marked', () => {
    const h = highlightsFor({ selection: { kind: 'selected', square: 'g1' }, ...after(['e4', 'e5']) })
    expect(h.selected).toBe('g1')
    expect([...(h.legal ?? [])].sort()).toEqual(['e2', 'f3', 'h3'])
    expect(h.lastMove).toEqual(['e7', 'e5'])
    expect(h.check).toBeUndefined()
  })

  // Breaks if check is no longer marked on the checked king's square.
  test('check marks the king of the side to move', () => {
    const h = highlightsFor({ selection: { kind: 'idle' }, ...after(['e4', 'f5', 'Qh5+']) })
    expect(h.check).toBe('e8')
    expect(h.checkmate).toBeUndefined()
  })

  // Breaks if checkmate stops marking the mated king (the glow that must
  // "hold" in Board/board.css has nothing to hold onto without this).
  test('checkmate keeps the check highlight on the mated king and flags checkmate', () => {
    const h = highlightsFor({
      selection: { kind: 'idle' },
      ...after(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']),
    })
    expect(h.check).toBe('e8')
    expect(h.checkmate).toBe(true)
  })

  // Breaks if stalemate (or any other draw) is wrongly treated as checkmate
  // — no shake, no held glow.
  test('stalemate marks neither check nor checkmate', () => {
    const position = new Position(RULE_FIXTURES.stalemate)
    const h = highlightsFor({
      selection: { kind: 'idle' },
      position,
      lastMove: undefined,
      displayedStatus: position.status(),
    })
    expect(h.check).toBeUndefined()
    expect(h.checkmate).toBeUndefined()
  })
})
