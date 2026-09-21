import { describe, expect, test } from 'vitest'
import { exceedsDragThreshold, squareFromElement } from './useDragMove'

describe('exceedsDragThreshold', () => {
  test('a tiny movement is a click, not a drag', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false)
  })

  test('a clear movement is a drag', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 60, y: 40 })).toBe(true)
  })

  test('the threshold is symmetric in both axes', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 0, y: 30 })).toBe(true)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 30, y: 0 })).toBe(true)
  })
})

describe('squareFromElement', () => {
  test('reads the square name from an element carrying data-square', () => {
    const el = document.createElement('div')
    el.setAttribute('data-square', 'e4')
    expect(squareFromElement(el)).toBe('e4')
  })

  test('finds it on an ancestor when the pointer lands on a piece', () => {
    const square = document.createElement('div')
    square.setAttribute('data-square', 'd5')
    const piece = document.createElement('img')
    square.appendChild(piece)
    expect(squareFromElement(piece)).toBe('d5')
  })

  test('returns null outside the board', () => {
    expect(squareFromElement(document.createElement('div'))).toBeNull()
    expect(squareFromElement(null)).toBeNull()
  })
})
