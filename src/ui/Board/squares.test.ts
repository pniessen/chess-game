import { describe, expect, test } from 'vitest'
import { isLightSquare, squaresInOrder } from './squares'

describe('isLightSquare', () => {
  test('pins standard board colouring: a1 dark, h1 light, a8 light, h8 dark', () => {
    expect(isLightSquare('a1')).toBe(false)
    expect(isLightSquare('h1')).toBe(true)
    expect(isLightSquare('a8')).toBe(true)
    expect(isLightSquare('h8')).toBe(false)
  })
})

describe('squaresInOrder', () => {
  test('white orientation reads a8 first and h1 last', () => {
    const s = squaresInOrder('white')
    expect(s).toHaveLength(64)
    expect(s[0]).toBe('a8')
    expect(s[63]).toBe('h1')
  })

  test('black orientation is the exact reverse', () => {
    expect(squaresInOrder('black')).toEqual([...squaresInOrder('white')].reverse())
  })

  test('every square appears exactly once', () => {
    expect(new Set(squaresInOrder('white')).size).toBe(64)
  })
})
