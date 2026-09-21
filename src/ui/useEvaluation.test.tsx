import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useEvaluation, type EvalAnalyze, type EvalCache } from './useEvaluation'
import type { GameStatus } from '../game-core/types'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const LIVE: GameStatus = { kind: 'in-progress', inCheck: false }

describe('useEvaluation', () => {
  test('analyses the position once, converts to White POV, and caches by FEN', async () => {
    const analyze = vi.fn<EvalAnalyze>(async () => ({ best: 'e7e5', lines: [{ depth: 14, scoreCp: -30, pv: ['e7e5'] }] }))
    const cache: EvalCache = new Map()
    const { result, rerender } = renderHook((p: { fen: string }) =>
      useEvaluation({ analyze, fen: p.fen, status: LIVE, enabled: true, cache }), { initialProps: { fen: AFTER_E4 } })
    await waitFor(() => expect(result.current).toEqual({ kind: 'cp', cp: 30 })) // Black to move: -30 -> +30
    rerender({ fen: AFTER_E4 })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  test('a position change aborts the old request', async () => {
    const signals: AbortSignal[] = []
    const analyze = vi.fn<EvalAnalyze>((_req, signal) => {
      signals.push(signal)
      return new Promise(() => {})
    })
    const { rerender } = renderHook((p: { fen: string }) =>
      useEvaluation({ analyze, fen: p.fen, status: LIVE, enabled: true, cache: new Map() }), { initialProps: { fen: START } })
    act(() => rerender({ fen: AFTER_E4 }))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  test('a finished position reports the result without asking the engine', () => {
    const analyze = vi.fn<EvalAnalyze>()
    const { result } = renderHook(() =>
      useEvaluation({ analyze, fen: START, status: { kind: 'checkmate', winner: 'b' }, enabled: true, cache: new Map() }))
    expect(result.current).toEqual({ kind: 'result', winner: 'b' })
    expect(analyze).not.toHaveBeenCalled()
  })

  test('disabled means no engine work', () => {
    const analyze = vi.fn<EvalAnalyze>()
    renderHook(() => useEvaluation({ analyze, fen: START, status: LIVE, enabled: false, cache: new Map() }))
    expect(analyze).not.toHaveBeenCalled()
  })
})
