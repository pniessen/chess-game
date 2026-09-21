import { describe, expect, test } from 'vitest'
import { capturedPieces, materialBalance } from './material'
import type { PlayedMove } from '../../game-core/types'

const cap = (color: 'w' | 'b', captured: 'p' | 'n' | 'b' | 'r' | 'q'): PlayedMove => ({
  san: 'x', color, from: 'e4', to: 'd5', piece: 'p', captured,
  isCapture: true, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('captured pieces', () => {
  test('groups captures by the capturing side', () => {
    const c = capturedPieces([cap('w', 'p'), cap('b', 'n'), cap('w', 'q')])
    expect(c.w).toEqual(['p', 'q'])
    expect(c.b).toEqual(['n'])
  })

  test('counts an en passant capture', () => {
    const ep: PlayedMove = {
      san: 'exd6', color: 'w', from: 'e5', to: 'd6', piece: 'p', captured: 'p',
      isCapture: true, isCastle: false, isEnPassant: true, fenAfter: '',
    }
    expect(capturedPieces([ep]).w).toEqual(['p'])
  })

  test('a promotion does not add a captured piece', () => {
    const promo: PlayedMove = {
      san: 'a8=Q', color: 'w', from: 'a7', to: 'a8', piece: 'p', promotion: 'q',
      isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
    }
    expect(capturedPieces([promo])).toEqual({ w: [], b: [] })
  })
})

describe('materialBalance', () => {
  test('is zero when both sides have taken the same value', () => {
    expect(materialBalance({ w: ['n'], b: ['b'] })).toBe(0)
  })

  test('is positive when White is ahead', () => {
    expect(materialBalance({ w: ['q'], b: ['p'] })).toBe(8)
  })

  test('is negative when Black is ahead', () => {
    expect(materialBalance({ w: [], b: ['r'] })).toBe(-5)
  })
})
