import { describe, expect, test } from 'vitest'
import { reviewRequestFrom, templatedSummary } from './summary'
import type { GameReview } from './run'
import { parseReviewRequest } from '../../server/validate'

const REVIEW: GameReview = {
  firstMover: 'w',
  evals: [],
  accuracy: { w: 97.26, b: 41.04 },
  moves: [
    { ply: 1, san: 'e4', uci: 'e2e4', mover: 'w', classification: 'best', loss: 0, bestUci: 'e2e4', bestSan: 'e4' },
    { ply: 2, san: 'e5', uci: 'e7e5', mover: 'b', classification: 'ok', loss: 1, bestUci: 'c7c5', bestSan: 'c5' },
    { ply: 3, san: 'Bc4', uci: 'f1c4', mover: 'w', classification: 'best', loss: 0, bestUci: 'f1c4', bestSan: 'Bc4' },
    { ply: 4, san: 'Nc6', uci: 'b8c6', mover: 'b', classification: 'inaccuracy', loss: 11.2, bestUci: 'g8f6', bestSan: 'Nf6' },
    { ply: 5, san: 'Qh5', uci: 'd1h5', mover: 'w', classification: 'ok', loss: 2, bestUci: 'g1f3', bestSan: 'Nf3' },
    { ply: 6, san: 'Nf6', uci: 'g8f6', mover: 'b', classification: 'blunder', loss: 45.41, bestUci: 'g7g6', bestSan: 'g6' },
    { ply: 7, san: 'Qxf7#', uci: 'h5f7', mover: 'w', classification: 'best', loss: 0, bestUci: 'h5f7', bestSan: 'Qxf7#' },
  ],
}

describe('templatedSummary', () => {
  test('reports accuracy, error counts per side, and the turning point', () => {
    const text = templatedSummary(REVIEW, { opening: "C23 Bishop's Opening", result: '1-0' })
    expect(text).toContain('White won')
    expect(text).toContain('Accuracy: White 97%, Black 41%')
    expect(text).toContain("Opening: C23 Bishop's Opening")
    expect(text).toContain('Black: 1 inaccuracy, 0 mistakes, 1 blunder')
    expect(text).toContain('White: 0 inaccuracies, 0 mistakes, 0 blunders')
    expect(text).toContain('The turning point was 3... Nf6?? — g6 was stronger.')
  })

  test('a clean game says so', () => {
    const clean = { ...REVIEW, moves: REVIEW.moves.map((m) => ({ ...m, classification: 'best' as const })) }
    expect(templatedSummary(clean, { opening: null, result: '1/2-1/2' })).toContain('No serious mistakes')
  })
})

describe('reviewRequestFrom', () => {
  test('produces a request the server accepts', () => {
    const req = reviewRequestFrom(REVIEW, { result: '1-0', opening: "C23 Bishop's Opening", humanSide: 'b' })
    expect(req.flagged.map((f) => f.ply)).toEqual([4, 6])
    expect(req.flagged[1]).toEqual({ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 45.4 })
    expect(req.accuracy).toEqual({ w: 97.3, b: 41 })
    expect(parseReviewRequest(req).ok).toBe(true)
  })
})
