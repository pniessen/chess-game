import { describe, expect, test } from 'vitest'
import { Position } from './position'

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
