import { describe, expect, test, vi } from 'vitest'
import { runReview, type ReviewAnalyze } from './run'
import { gameFromSan } from '../game-core/io'

const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']

/** Engine output per position (side-to-move POV), in position order 0..6. Position 7 is mate: never asked. */
const SCRIPT = [
  { cp: 30, pv: 'e2e4' },
  { cp: -30, pv: 'e7e5' },
  { cp: 30, pv: 'f1c4' },
  { cp: -30, pv: 'b8c6' },
  { cp: 30, pv: 'd1h5' },
  { cp: -50, pv: 'g7g6' }, // after 3.Qh5, Black to move: g6 was the move
  { mate: 1, pv: 'h5f7' }, // after 3...Nf6??, White mates in one
]

function scholar() {
  const r = gameFromSan(SCHOLAR)
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('runReview', () => {
  test('analyses every non-terminal position once and classifies each move', async () => {
    const game = scholar()
    let call = 0
    const analyze = vi.fn<ReviewAnalyze>(async () => {
      const s = SCRIPT[call++]!
      return {
        best: s.pv,
        lines: [{ depth: 12, pv: [s.pv], ...(s.mate !== undefined ? { scoreMate: s.mate } : { scoreCp: s.cp }) }],
      }
    })
    const progress: Array<[number, number]> = []
    const cached: string[] = []
    const review = await runReview({
      startFen: game.startFen,
      moves: game.moves,
      finalStatus: game.status(),
      analyze,
      signal: new AbortController().signal,
      onProgress: (done, total) => progress.push([done, total]),
      onEval: (fen) => cached.push(fen),
    })

    expect(analyze).toHaveBeenCalledTimes(7)
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ depth: 12, moveTimeMs: 150, multiPv: 1 })
    expect(progress.at(-1)).toEqual([8, 8])
    expect(cached).toHaveLength(7)

    expect(review.evals[5]).toEqual({ kind: 'cp', cp: 50 }) // flipped to White POV
    expect(review.evals[7]).toEqual({ kind: 'result', winner: 'w' })

    const nf6 = review.moves[5]!
    expect(nf6).toMatchObject({ ply: 6, san: 'Nf6', mover: 'b', classification: 'blunder', bestUci: 'g7g6', bestSan: 'g6' })
    expect(review.moves[6]).toMatchObject({ san: 'Qxf7#', classification: 'best' })
    expect(review.moves[0]?.classification).toBe('best')
    expect(review.accuracy.b!).toBeLessThan(review.accuracy.w!)
    expect(review.firstMover).toBe('w')
  })

  test('an aborted analysis rejects the whole review', async () => {
    const game = scholar()
    const ctrl = new AbortController()
    const analyze: ReviewAnalyze = async (_req, signal) => {
      ctrl.abort()
      if (signal.aborted) throw new Error('analysis aborted')
      return { best: 'e2e4', lines: [] }
    }
    await expect(
      runReview({ startFen: game.startFen, moves: game.moves, finalStatus: game.status(), analyze, signal: ctrl.signal }),
    ).rejects.toThrow(/aborted/)
  })
})
