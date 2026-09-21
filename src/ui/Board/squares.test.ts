import { describe, expect, test } from 'vitest'
import { squaresInOrder } from './squares'

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
