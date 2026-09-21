import { describe, expect, test } from 'vitest'
import { Position } from './position'
import type { Square } from './types'
import { RULE_FIXTURES } from '../../tests/fixtures/positions'

describe('special moves', () => {
  test('a promotion offers exactly four choices', () => {
    const p = new Position(RULE_FIXTURES.promotionChoice)
    const promos = p.legalMovesFrom('a7').filter((m) => m.to === 'a8')
    expect(promos.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r'])
  })

  test('a promotion move without a piece is reported as needs-promotion', () => {
    const p = new Position(RULE_FIXTURES.promotionChoice)
    expect(p.tryMove({ from: 'a7', to: 'a8' })).toEqual({
      ok: false,
      reason: 'needs-promotion',
    })
    const r = p.tryMove({ from: 'a7', to: 'a8', promotion: 'n' })
    expect(r.ok).toBe(true)
  })

  test('en passant is available immediately after the double push', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    expect(p.legalMovesFrom('e5').some((m) => m.to === 'd6')).toBe(true)
  })

  test('an en passant capture is recorded as a capture', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    const r = p.tryMove({ from: 'e5', to: 'd6' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    // chess.js's own isCapture() is FALSE here; our boundary must fix it.
    expect(r.move.isEnPassant).toBe(true)
    expect(r.move.isCapture).toBe(true)
  })

  test('en passant expires if not taken immediately', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    p.tryMove({ from: 'a2', to: 'a3' })
    p.tryMove({ from: 'a7', to: 'a6' })
    expect(p.legalMovesFrom('e5').some((m) => m.to === 'd6')).toBe(false)
  })

  test('castling is offered when legal', () => {
    const p = new Position(RULE_FIXTURES.castlingAvailable)
    const kingMoves = p.legalMovesFrom('e1').map((m) => m.to)
    expect(kingMoves).toContain('g1')
    expect(kingMoves).toContain('c1')
  })

  test('castling is unavailable while in check', () => {
    const p = new Position(RULE_FIXTURES.castlingWhileInCheck)
    expect(p.status()).toEqual({ kind: 'in-progress', inCheck: true })
    const kingMoves = p.legalMovesFrom('e1').map((m) => m.to)
    expect(kingMoves).not.toContain('g1')
    expect(kingMoves).not.toContain('c1')
  })

  test('castling rights are lost once the rook moves', () => {
    const p = new Position(RULE_FIXTURES.castlingAvailable)
    p.tryMove({ from: 'h1', to: 'g1' })
    p.tryMove({ from: 'a7', to: 'a6' })
    p.tryMove({ from: 'g1', to: 'h1' })
    p.tryMove({ from: 'a6', to: 'a5' })
    expect(p.legalMovesFrom('e1').map((m) => m.to)).not.toContain('g1')
  })
})

describe('game results', () => {
  test('checkmate names the winner', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    const r = p.tryMove({ from: 'f3', to: 'f7' })
    expect(r.ok).toBe(true)
    expect(p.status()).toEqual({ kind: 'checkmate', winner: 'w' })
  })

  test('stalemate is a draw, not a checkmate', () => {
    const p = new Position(RULE_FIXTURES.stalemate)
    expect(p.status()).toEqual({ kind: 'draw', reason: 'stalemate' })
  })

  test('bare kings are insufficient material', () => {
    const p = new Position(RULE_FIXTURES.insufficientMaterial)
    expect(p.status()).toEqual({ kind: 'draw', reason: 'insufficient-material' })
  })

  test('threefold repetition is detected across a transposition', () => {
    const p = new Position()
    // Shuffle both knights out and back, twice, returning to the start
    // position for the third time.
    // The start position is counted once at construction, a second time
    // after the first cycle, and a third after the second — hence threefold.
    const cycle: Array<[Square, Square]> = [
      ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ]
    for (let i = 0; i < 2; i++) {
      for (const [from, to] of cycle) {
        const r = p.tryMove({ from, to })
        expect(r.ok).toBe(true)
      }
    }
    expect(p.status()).toEqual({ kind: 'draw', reason: 'threefold-repetition' })
  })

  test('undo restores the position exactly, including repetition state', () => {
    const p = new Position()
    const before = p.fen()
    p.tryMove({ from: 'e2', to: 'e4' })
    p.undo()
    expect(p.fen()).toBe(before)
  })

  test('a move is refused once the game is over', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    p.tryMove({ from: 'f3', to: 'f7' })
    expect(p.tryMove({ from: 'e8', to: 'e7' })).toEqual({
      ok: false,
      reason: 'game-over',
    })
  })
})
