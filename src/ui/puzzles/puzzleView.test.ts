import { describe, expect, test } from 'vitest'
import {
  hintSuggestionOf,
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
} from './puzzleView'
import { playReply, playSetup, playSolutionStep, revealSolution, startSession, submitMove } from '../../puzzles/session'
import { specOfRated } from '../../puzzles/spec'
import { DEFENCE } from '../../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const ready = playSetup(startSession(DEF))
const reply = submitMove(ready, { from: 'f8', to: 'd8' }).session
const failed = submitMove(ready, { from: 'b6', to: 'c7' }).session
const solved = submitMove(playReply(reply), { from: 'f6', to: 'd8' }).session

test('status text for every phase', () => {
  expect(puzzleStatusText(startSession(DEF), 'b')).toBe("Watch your opponent's move…")
  expect(puzzleStatusText(ready, 'b')).toBe('Find the best move for Black.')
  expect(puzzleStatusText(reply, 'b')).toBe('Correct!')
  expect(puzzleStatusText(playReply(reply), 'b')).toBe('Correct! Keep going.')
  expect(puzzleStatusText(failed, 'b')).toBe("That's not it. Retry, or show the solution.")
  expect(puzzleStatusText(solved, 'b')).toBe('Solved!')
  const showing = revealSolution(ready)
  expect(puzzleStatusText(showing, 'b')).toBe('Showing the solution…')
  expect(puzzleStatusText(playSolutionStep(playSolutionStep(playSolutionStep(showing))), 'b')).toBe('Solution shown.')
  expect(sideName('w')).toBe('White')
})

// Breaks if the hint is taken from anywhere but the stored solution.
test('the hint suggestion is the listed solution move, only on the solver turn', () => {
  expect(hintSuggestionOf(ready)).toMatchObject({ from: 'f8', to: 'd8', san: 'Rd8', piece: 'r', lines: [] })
  expect(hintSuggestionOf(reply)).toBeNull()
  expect(hintSuggestionOf(startSession(DEF))).toBeNull()
})

describe('annotations (reusing the hint overlay)', () => {
  test('stage 0 nothing; stage 1 the piece; stage 2 the piece and the move', () => {
    expect(puzzleAnnotations(ready, 0)).toEqual([])
    expect(puzzleAnnotations(ready, 1)).toEqual([{ kind: 'square', square: 'f8', tone: 'hint' }])
    expect(puzzleAnnotations(ready, 2)).toEqual([
      { kind: 'square', square: 'f8', tone: 'hint' },
      { kind: 'arrow', from: 'f8', to: 'd8', tone: 'hint' },
    ])
  })

  test('a wrong move is marked as a blunder; the solving move as best', () => {
    expect(puzzleAnnotations(failed, 0)).toEqual([{ kind: 'square', square: 'c7', tone: 'blunder' }])
    expect(puzzleAnnotations(solved, 0)).toEqual([{ kind: 'square', square: 'd8', tone: 'best' }])
  })
})

test('hint text and button label', () => {
  expect(puzzleHintText(ready, 0)).toBe('')
  expect(puzzleHintText(ready, 1)).toBe('Look at your rook.')
  expect(puzzleHintText(ready, 2)).toBe('Look at your rook. Try Rd8.')
  expect(puzzleHintButtonLabel(0)).toBe('Hint')
  expect(puzzleHintButtonLabel(1)).toBe('Show move')
  expect(puzzleHintButtonLabel(2)).toBe('Hint')
})

test('rating change text', () => {
  expect(ratingDeltaText(33)).toBe('+33')
  expect(ratingDeltaText(-7)).toBe('-7')
  expect(ratingDeltaText(0)).toBe('+0')
})
