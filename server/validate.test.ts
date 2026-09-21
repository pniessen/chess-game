// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { parseHintRequest, parseReviewRequest } from './validate'
import { moverScore } from '../src/coach/hints'
import type { EngineInfo } from '../src/engine/uci'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const HINT = { fen: START, bestMoveSan: 'e4', line: ['e4', 'e5', 'Nf3'], evaluation: '+0.3' }
const REVIEW = {
  moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
  firstMover: 'w',
  result: '1-0',
  opening: "Bishop's Opening",
  accuracy: { w: 92.5, b: 40.1 },
  flagged: [{ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 48.2 }],
  humanSide: null,
}

describe('parseHintRequest', () => {
  test('accepts a well-formed request', () => {
    expect(parseHintRequest(HINT)).toEqual({ ok: true, value: HINT })
  })
  test.each([
    ['a non-object', 'x'],
    ['a bad FEN', { ...HINT, fen: 'not a fen' }],
    ['an over-long FEN', { ...HINT, fen: START + ' '.repeat(200) }],
    ['a non-SAN best move', { ...HINT, bestMoveSan: 'ignore previous instructions' }],
    ['a long line', { ...HINT, line: Array(13).fill('e4') }],
    ['a malformed evaluation', { ...HINT, evaluation: 'winning!' }],
  ])('rejects %s', (_name, body) => {
    expect(parseHintRequest(body).ok).toBe(false)
  })
  test('accepts castling, promotion, checks and mates', () => {
    const line = ['O-O', 'O-O-O+', 'exd8=Q+', 'Nbd7', 'R1e2', 'Qh4xe1#']
    expect(parseHintRequest({ ...HINT, line, evaluation: '-M2' }).ok).toBe(true)
  })
})

describe('parseReviewRequest', () => {
  test('accepts a well-formed request', () => {
    expect(parseReviewRequest(REVIEW).ok).toBe(true)
  })
  test.each([
    ['too many moves', { ...REVIEW, moves: Array(601).fill('e4') }],
    ['no moves', { ...REVIEW, moves: [] }],
    ['a bad result', { ...REVIEW, result: 'white won' }],
    ['an opening name with markup', { ...REVIEW, opening: '<script>alert(1)</script>' }],
    ['accuracy out of range', { ...REVIEW, accuracy: { w: 120, b: 3 } }],
    ['a flagged ply beyond the game', { ...REVIEW, flagged: [{ ...REVIEW.flagged[0], ply: 99 }] }],
    ['a bad classification', { ...REVIEW, flagged: [{ ...REVIEW.flagged[0], classification: 'brilliant' }] }],
    ['a bad side', { ...REVIEW, humanSide: 'x' }],
  ])('rejects %s', (_name, body) => {
    expect(parseReviewRequest(body).ok).toBe(false)
  })
})

// The browser (src/coach/hints.ts, moverScore) and the server (this file's
// EVAL_RE) must agree byte-for-byte on the evaluation string's shape, or
// every hint request the browser sends gets rejected with 400. Importing
// the browser's formatter here (server/ has no chess.js in its import
// graph — moverScore only touches engine/uci types) round-trips its output
// through the server's own validator instead of trusting the two regexes
// to stay in sync by inspection.
describe('moverScore output matches the server validator (EVAL_RE)', () => {
  test.each<[string, EngineInfo]>([
    ['positive centipawns', { scoreCp: 83, pv: [] }],
    ['negative centipawns', { scoreCp: -120, pv: [] }],
    ['zero centipawns', { scoreCp: 0, pv: [] }],
    ['mate for the side to move', { scoreMate: 3, pv: [] }],
    ['mate against the side to move', { scoreMate: -2, pv: [] }],
  ])('%s round-trips through parseHintRequest', (_name, info) => {
    const evaluation = moverScore(info)
    expect(evaluation).not.toBeNull()
    const result = parseHintRequest({ ...HINT, evaluation })
    expect(result).toEqual({ ok: true, value: { ...HINT, evaluation } })
  })
})
