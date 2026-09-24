import { describe, expect, test } from 'vitest'
import {
  hintSuggestionOf,
  lastPlayedMoveOf,
  mistakeOriginText,
  nextMistake,
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
  wrongMoveSquare,
} from './puzzleView'
import { playReply, playSetup, playSolutionStep, revealSolution, startSession, submitMove } from '../../puzzles/session'
import { specOfRated } from '../../puzzles/spec'
import { DEFENCE } from '../../../tests/fixtures/puzzles'
import type { BlunderPuzzle } from '../../puzzles/types'

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

// Task 7: the shake target for a wrong move — the same square
// puzzleAnnotations tints red, but only ever while 'failed' is current.
describe('wrongMoveSquare', () => {
  test('the wrong move\'s destination, only while failed', () => {
    expect(wrongMoveSquare(failed)).toBe('c7')
  })
  test('null before, during and after — never on a correct or solved session', () => {
    expect(wrongMoveSquare(ready)).toBeNull()
    expect(wrongMoveSquare(reply)).toBeNull()
    expect(wrongMoveSquare(solved)).toBeNull()
    expect(wrongMoveSquare(startSession(DEF))).toBeNull()
  })
})

test('rating change text', () => {
  expect(ratingDeltaText(33)).toBe('+33')
  expect(ratingDeltaText(-7)).toBe('-7')
  expect(ratingDeltaText(0)).toBe('+0')
})

const mistake = (id: string, over: Partial<BlunderPuzzle> = {}): BlunderPuzzle => ({
  id,
  fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
  solution: 'd1d8',
  bestSan: 'Qd8#',
  blunderLabel: '25. h3',
  solver: 'w',
  gameId: 'g1',
  gameDate: '2026-09-20T10:00:00.000Z',
  opening: 'C50 Italian Game',
  createdAt: '2026-09-20T10:05:00.000Z',
  solved: false,
  ...over,
})

test('mistakeOriginText says which game and which move', () => {
  expect(mistakeOriginText(mistake('a'))).toBe(
    'From your game on 2026-09-20 (C50 Italian Game): you played 25. h3?? — find the better move.',
  )
  expect(mistakeOriginText(mistake('a', { opening: null }))).toBe(
    'From your game on 2026-09-20: you played 25. h3?? — find the better move.',
  )
})

describe('nextMistake', () => {
  const list = [mistake('a'), mistake('b', { solved: true }), mistake('c'), mistake('d', { solved: true })]
  test('first unsolved, then the next unsolved after the current one, wrapping', () => {
    expect(nextMistake(list, null)?.id).toBe('a')
    expect(nextMistake(list, 'a')?.id).toBe('c')
    expect(nextMistake(list, 'c')?.id).toBe('a')
  })
  test('when all are solved, simply the next one; empty list gives null', () => {
    const solved = list.map((p) => ({ ...p, solved: true }))
    expect(nextMistake(solved, 'b')?.id).toBe('c')
    expect(nextMistake(solved, 'd')?.id).toBe('a')
    expect(nextMistake([], null)).toBeNull()
  })
})

// The board animates a puzzle move the same way it animates a game move,
// so it needs the whole move record, not just the two squares lastMoveOf
// reports.
describe('lastPlayedMoveOf', () => {
  test('is null before anything has been played', () => {
    expect(lastPlayedMoveOf(startSession(DEF))).toBeNull()
  })

  test('reports the setup move the opponent just made', () => {
    const move = lastPlayedMoveOf(ready)
    expect(move?.from).toBe(DEF.setup?.slice(0, 2))
    expect(move?.to).toBe(DEF.setup?.slice(2, 4))
    expect(move?.san).toBeTruthy()
  })

  test("reports the solver's own move, with its capture detail", () => {
    const move = lastPlayedMoveOf(solved)
    expect([move?.from, move?.to]).toEqual(['f6', 'd8'])
    expect(move?.isCapture).toBe(true)
    expect(move?.captured).toBe('q')
  })
})
