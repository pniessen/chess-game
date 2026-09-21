import { describe, expect, test } from 'vitest'
import { Position } from './position'
import { RULE_FIXTURES } from '../../tests/fixtures/positions'

describe('Position', () => {
  test('a new position is the standard opening, White to move', () => {
    const p = new Position()
    expect(p.turn()).toBe('w')
    expect(p.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(p.status()).toEqual({ kind: 'in-progress', inCheck: false })
  })

  test('legalMovesFrom returns the pawn double and single push', () => {
    const p = new Position()
    const tos = p.legalMovesFrom('e2').map((m) => m.to).sort()
    expect(tos).toEqual(['e3', 'e4'])
  })

  test('tryMove returns ok and a PlayedMove for a legal move', () => {
    const p = new Position()
    const r = p.tryMove({ from: 'e2', to: 'e4' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.move.san).toBe('e4')
    expect(r.move.isCapture).toBe(false)
    expect(p.turn()).toBe('b')
  })

  test('tryMove REPORTS an illegal move instead of throwing', () => {
    const p = new Position()
    expect(() => p.tryMove({ from: 'e2', to: 'e5' })).not.toThrow()
    expect(p.tryMove({ from: 'e2', to: 'e5' })).toEqual({ ok: false, reason: 'illegal' })
    expect(p.turn()).toBe('w')
  })
})

describe('epd', () => {
  test('the start position', () => {
    expect(new Position().epd()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  })

  test('drops an en-passant square no pawn can use', () => {
    const p = new Position()
    p.tryMove({ from: 'e2', to: 'e4' })
    expect(p.epd()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')
  })

  test('keeps it when en passant is legal', () => {
    expect(new Position(RULE_FIXTURES.enPassantAvailable).epd()).toBe(
      'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6',
    )
  })

  test('transpositions that differ only by the last double push are equal', () => {
    const a = new Position()
    for (const san of ['c4', 'Nf6', 'd4']) a.trySan(san)
    const b = new Position()
    for (const san of ['d4', 'Nf6', 'c4']) b.trySan(san)
    expect(a.epd()).toBe(b.epd())
    expect(a.epd()).toBe('rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -')
  })
})

describe('trySan', () => {
  test('plays a legal SAN move', () => {
    const p = new Position()
    const r = p.trySan('Nf3')
    expect(r.ok && r.move.from === 'g1' && r.move.to === 'f3').toBe(true)
  })
  test('an illegal SAN move is a returned value, never a throw', () => {
    const p = new Position()
    expect(() => p.trySan('Nf6')).not.toThrow()
    expect(p.trySan('Nf6')).toEqual({ ok: false, reason: 'illegal' })
    expect(p.trySan('garbage')).toEqual({ ok: false, reason: 'illegal' })
  })
  test('refuses after the game is over', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    p.trySan('Qxf7#')
    expect(p.trySan('Ke7')).toEqual({ ok: false, reason: 'game-over' })
  })
})
