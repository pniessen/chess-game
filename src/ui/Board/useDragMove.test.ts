import { describe, expect, test } from 'vitest'
import { exceedsDragThreshold, shouldSuppressClick, squareFromElement } from './useDragMove'

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

// Finding 2: the trailing synthesized `click` is only ever hit-tested (and
// so only ever fires) when the release point lands on a square — a release
// off the board produces no click. `shouldSuppressClick` is the pure
// decision `useDragMove` consults before setting the suppression flag, so
// that flag can never be set true in a case where no click will arrive to
// consume it (which is exactly how it used to get stranded).
describe('shouldSuppressClick', () => {
  test('suppresses when the release lands on a square', () => {
    expect(shouldSuppressClick('e4')).toBe(true)
  })

  test('does not suppress when the release lands off the board', () => {
    expect(shouldSuppressClick(null)).toBe(false)
  })
})
