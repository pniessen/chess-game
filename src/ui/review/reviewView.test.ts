import { expect, test } from 'vitest'
import { currentMoveText, moveQualityTitle, reviewAnnotations, reviewMarks } from './reviewView'
import type { GameReview } from '../../review/run'

const review: GameReview = {
  firstMover: 'w',
  evals: [],
  accuracy: { w: 100, b: 20 },
  moves: [
    { ply: 1, san: 'e4', uci: 'e2e4', mover: 'w', classification: 'best', loss: 0, bestUci: 'e2e4', bestSan: 'e4' },
    { ply: 2, san: 'f6', uci: 'f7f6', mover: 'b', classification: 'mistake', loss: 22, bestUci: 'e7e5', bestSan: 'e5' },
  ],
}

test('marks every reviewed ply with its classification and eval swing', () => {
  expect([...reviewMarks(review)]).toEqual([
    [1, { classification: 'best', loss: 0 }],
    [2, { classification: 'mistake', loss: 22 }],
  ])
})

// Task 8: the chip's hover tooltip — the classification, plus the eval
// swing only when there was one (a 0-loss best move needs no "(−0% win)").
test('moveQualityTitle names the classification, and the eval swing when there is one', () => {
  expect(moveQualityTitle({ classification: 'best', loss: 0 })).toBe('Best move')
  expect(moveQualityTitle({ classification: 'mistake', loss: 22 })).toBe('Mistake (−22% win)')
  expect(moveQualityTitle({ classification: 'blunder', loss: 41.7 })).toBe('Blunder (−42% win)')
})

test('a flagged move shows where it went and an arrow for the better move', () => {
  expect(reviewAnnotations(review, 2)).toEqual([
    { kind: 'square', square: 'f6', tone: 'mistake' },
    { kind: 'arrow', from: 'e7', to: 'e5', tone: 'best' },
  ])
  expect(reviewAnnotations(review, 1)).toEqual([]) // not flagged
  expect(reviewAnnotations(review, 0)).toEqual([])
  expect(reviewAnnotations(null, 2)).toEqual([])
})

test('currentMoveText explains the flagged move', () => {
  expect(currentMoveText(review, 2)).toBe('1... f6? is a mistake. Better was e5.')
  expect(currentMoveText(review, 1)).toBe('1. e4! was the engine’s choice.')
  expect(currentMoveText(review, 0)).toBe('')
})
