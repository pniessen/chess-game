import { expect, test } from 'vitest'
import { expectedScore, kFactor, nextRating, START_RATING } from './rating'

test('starts at 1200; K is 40 for the first 20 rated puzzles, then 20', () => {
  expect(START_RATING).toBe(1200)
  expect(kFactor(0)).toBe(40)
  expect(kFactor(19)).toBe(40)
  expect(kFactor(20)).toBe(20)
})

test('expected score is the Elo logistic', () => {
  expect(expectedScore(1500, 1500)).toBe(0.5)
  expect(expectedScore(1200, 1468)).toBeCloseTo(0.17614, 4)
})

// These exact values are asserted by the e2e specs too; recompute them if K or rounding change.
test('the numbers the UI will show', () => {
  expect(nextRating(1200, 1468, 'win', 0)).toBe(1233)
  expect(nextRating(1200, 1468, 'loss', 0)).toBe(1193)
  expect(nextRating(1200, 1500, 'loss', 0)).toBe(1194)
  expect(nextRating(1500, 1500, 'win', 20)).toBe(1510)
})

test('clamped to 400..3200', () => {
  expect(nextRating(400, 3000, 'loss', 0)).toBe(400)
  expect(nextRating(3200, 600, 'win', 0)).toBe(3200)
})
