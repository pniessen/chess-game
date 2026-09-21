import { describe, expect, test } from 'vitest'
import { arrowLine, squareCenter } from './annotations'

describe('squareCenter', () => {
  test('white view: a8 top-left, h1 bottom-right', () => {
    expect(squareCenter('a8', 'white')).toEqual({ x: 0.5, y: 0.5 })
    expect(squareCenter('h1', 'white')).toEqual({ x: 7.5, y: 7.5 })
    expect(squareCenter('e1', 'white')).toEqual({ x: 4.5, y: 7.5 })
  })
  test('black view mirrors both axes', () => {
    expect(squareCenter('h1', 'black')).toEqual({ x: 0.5, y: 0.5 })
    expect(squareCenter('e1', 'black')).toEqual({ x: 3.5, y: 0.5 })
  })
})

describe('arrowLine', () => {
  test('starts at the from-centre and stops short of the to-centre', () => {
    const l = arrowLine('e2', 'e4', 'white')
    expect(l.x1).toBeCloseTo(4.5)
    expect(l.y1).toBeCloseTo(6.5)
    expect(l.x2).toBeCloseTo(4.5)
    expect(l.y2).toBeCloseTo(4.85)
  })
  test('flips with the board', () => {
    const l = arrowLine('e2', 'e4', 'black')
    expect(l.y1).toBeCloseTo(1.5)
    expect(l.y2).toBeCloseTo(3.15)
  })
})
