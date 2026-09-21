import { expect, test } from 'vitest'
import { moveLabel, numberedMoves } from './moveNumber'

test('moveLabel numbers plies from the side that moved first', () => {
  expect(moveLabel(1, 'e4', 'w')).toBe('1. e4')
  expect(moveLabel(2, 'e5', 'w')).toBe('1... e5')
  expect(moveLabel(6, 'Nf6', 'w')).toBe('3... Nf6')
  expect(moveLabel(1, 'e5', 'b')).toBe('1... e5')
  expect(moveLabel(2, 'Nf3', 'b')).toBe('2. Nf3')
})

test('numberedMoves writes a PGN-style move text', () => {
  expect(numberedMoves(['e4', 'e5', 'Nf3'], 'w')).toBe('1. e4 e5 2. Nf3')
  expect(numberedMoves(['e5', 'Nf3'], 'b')).toBe('1... e5 2. Nf3')
  expect(numberedMoves([], 'w')).toBe('')
})
