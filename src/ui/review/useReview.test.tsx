import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useReview, type Summarize } from './useReview'
import type { ReviewAnalyze, ReviewInput } from '../../review/run'
import { gameFromSan } from '../../game-core/io'

function input(sans: string[]): ReviewInput {
  const r = gameFromSan(sans)
  if (!r.ok) throw new Error(r.error)
  return { startFen: r.game.startFen, moves: r.game.moves, finalStatus: r.game.status() }
}

const instant: ReviewAnalyze = async () => ({ best: 'e2e4', lines: [{ depth: 12, pv: ['e2e4'], scoreCp: 20 }] })
const summarize: Summarize = async () => ({ text: 'SUMMARY', source: 'templated' })

/** An analyze whose jobs wait until released, recording each job's signal. */
function heldAnalyze() {
  const signals: AbortSignal[] = []
  const release: Array<() => void> = []
  const analyze: ReviewAnalyze = (_req, signal) =>
    new Promise((resolve, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new Error('analysis aborted')))
      release.push(() => resolve({ best: 'e2e4', lines: [{ depth: 12, pv: ['e2e4'], scoreCp: 20 }] }))
    })
  return { analyze, signals, release }
}

function setup(analyze: ReviewAnalyze, gameKey = 'g1|e4 e5') {
  return renderHook(
    (p: { gameKey: string }) =>
      useReview({ gameKey: p.gameKey, analyze, summarize, onEval: vi.fn(), onComplete: vi.fn() }),
    { initialProps: { gameKey } },
  )
}

describe('useReview', () => {
  test('runs to done with a summary', async () => {
    const { result } = setup(instant)
    act(() => result.current.start(input(['e4', 'e5'])))
    await waitFor(() => expect(result.current.state).toMatchObject({ kind: 'done', summary: 'SUMMARY' }))
  })

  test('a changed move list invalidates a finished review, and it does not come back with the old list', async () => {
    const { result, rerender } = setup(instant)
    act(() => result.current.start(input(['e4', 'e5'])))
    await waitFor(() => expect(result.current.state.kind).toBe('done'))

    rerender({ gameKey: 'g1|e4' }) // undo
    expect(result.current.state).toEqual({ kind: 'idle' }) // masked on this very render
    rerender({ gameKey: 'g1|e4 e5' }) // redo back onto the reviewed list
    expect(result.current.state).toEqual({ kind: 'idle' })
  })

  test('a changed key while running aborts the in-flight analysis', async () => {
    const h = heldAnalyze()
    const { result, rerender } = setup(h.analyze)
    act(() => result.current.start(input(['e4', 'e5'])))
    await waitFor(() => expect(h.signals).toHaveLength(1))
    expect(result.current.state).toMatchObject({ kind: 'running', done: 0, total: 3 })

    rerender({ gameKey: 'g2|' }) // a new game
    expect(h.signals[0]!.aborted).toBe(true)
    expect(result.current.state).toEqual({ kind: 'idle' })
  })

  test('browsing (same key) keeps the review', async () => {
    const { result, rerender } = setup(instant)
    act(() => result.current.start(input(['e4', 'e5'])))
    await waitFor(() => expect(result.current.state.kind).toBe('done'))
    rerender({ gameKey: 'g1|e4 e5' })
    expect(result.current.state.kind).toBe('done')
  })

  test('cancel aborts and returns to idle', async () => {
    const h = heldAnalyze()
    const { result } = setup(h.analyze)
    act(() => result.current.start(input(['e4', 'e5'])))
    await waitFor(() => expect(h.signals).toHaveLength(1))
    act(() => result.current.cancel())
    expect(h.signals[0]!.aborted).toBe(true)
    expect(result.current.state).toEqual({ kind: 'idle' })
  })
})
