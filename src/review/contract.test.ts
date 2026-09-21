// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseReviewRequest } from '../../server/validate'
import { gameFromSan } from '../game-core/io'
import { OpeningBook } from '../openings/book'
import { parseOpeningsData } from '../openings/data'
import { uciOf } from '../game-core/notation'
import { runReview, type ReviewAnalyze } from './run'
import { reviewRequestFrom } from './summary'
import type { GameReview } from './run'

/**
 * The browser -> server contract for /api/review, end to end on the real
 * data: a realistic game (mate scores in the evals, a mating finish, a
 * named opening from the shipped dataset) goes runReview -> reviewRequestFrom
 * -> the server's own parseReviewRequest.
 */
const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'public/openings/openings.json'), 'utf8'))
const parsed = parseOpeningsData(raw)
if (!parsed) throw new Error('openings.json did not parse')
const book = new OpeningBook(parsed)

// Légal's mate: Black grabs the queen and gets mated.
const LEGAL = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#']

function legalGame() {
  const r = gameFromSan(LEGAL)
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('review request contract', () => {
  test('a realistic reviewed game with mates and a named opening passes the server validator', async () => {
    const game = legalGame()
    // Engine view per position (side to move), 0..12; 13 is terminal (mate).
    const scores: Array<{ cp?: number; mate?: number; best: string }> = [
      { cp: 30, best: 'e2e4' },
      { cp: -30, best: 'e7e5' },
      { cp: 35, best: 'g1f3' },
      { cp: -40, best: 'b8c6' },
      { cp: 60, best: 'f1c4' },
      { cp: -70, best: 'g8f6' },
      { cp: 80, best: 'b1c3' },
      { cp: -90, best: 'g8f6' },
      { cp: 300, best: 'f3e5' }, // after 4...g6?
      { cp: -150, best: 'd6e5' }, // after 5.Nxe5: dxe5 was necessary
      { mate: 2, best: 'c4f7' }, // after 5...Bxd1??: White mates in 2
      { mate: -1, best: 'e8e7' }, // Black to move, mated in 1
      { mate: 1, best: 'c3d5' },
    ]
    let i = 0
    const analyze: ReviewAnalyze = async () => {
      const s = scores[i++]!
      return {
        best: s.best,
        lines: [{ depth: 12, pv: [s.best], ...(s.mate !== undefined ? { scoreMate: s.mate } : { scoreCp: s.cp! }) }],
      }
    }
    const review = await runReview({
      startFen: game.startFen,
      moves: game.moves,
      finalStatus: game.status(),
      analyze,
      signal: new AbortController().signal,
    })
    expect(review.evals).toContainEqual({ kind: 'mate', mate: 2 })
    expect(review.evals).toContainEqual({ kind: 'mate', mate: 1 })
    expect(review.evals.at(-1)).toEqual({ kind: 'result', winner: 'w' })

    const opening = book.identify(game.epds(Math.min(game.livePly, book.maxPly)))
    expect(opening).not.toBeNull()
    const name = `${opening!.eco} ${opening!.name}`

    const req = reviewRequestFrom(review, { result: '1-0', opening: name, humanSide: 'b' })
    expect(req.flagged.some((f) => f.ply === 10 && f.classification === 'blunder' && f.bestSan === 'dxe5')).toBe(true)
    const verdict = parseReviewRequest(JSON.parse(JSON.stringify(req)))
    expect(verdict).toEqual({ ok: true, value: req })
    // Sanity: the review's moves are exactly the game's.
    expect(review.moves.map((m) => m.uci)).toEqual(game.moves.map(uciOf))
  })

  test('every opening name in the shipped dataset is accepted by the server', () => {
    const base = reviewRequestFrom(
      { firstMover: 'w', evals: [], accuracy: { w: 50, b: 50 }, moves: [] } satisfies GameReview,
      { result: '*', opening: null, humanSide: null },
    )
    const rejected = book.all
      .map((o) => `${o.eco} ${o.name}`)
      .filter((opening) => !parseReviewRequest({ ...base, moves: ['e4'], opening }).ok)
    expect(rejected).toEqual([])
  })

  test('a game longer than the move cap never flags a ply beyond it', () => {
    const moves = Array.from({ length: 620 }, (_, k) => ({
      ply: k + 1,
      san: k % 2 === 0 ? 'Nf3' : 'Nf6',
      uci: 'g1f3',
      mover: (k % 2 === 0 ? 'w' : 'b') as 'w' | 'b',
      classification: (k === 610 ? 'blunder' : 'ok') as 'blunder' | 'ok',
      loss: k === 610 ? 40 : 1,
      bestUci: null,
      bestSan: null,
    }))
    const req = reviewRequestFrom(
      { firstMover: 'w', evals: [], accuracy: { w: 88.88, b: 77.77 }, moves },
      { result: '1/2-1/2', opening: null, humanSide: null },
    )
    expect(req.moves).toHaveLength(600)
    expect(req.flagged).toEqual([])
    expect(parseReviewRequest(req).ok).toBe(true)
  })
})
