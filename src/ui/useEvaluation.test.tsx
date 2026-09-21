import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { BoundedEvalCache, useEvaluation, type EvalAnalyze, type EvalCache } from './useEvaluation'
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

describe('BoundedEvalCache', () => {
  const cp = (n: number) => ({ kind: 'cp' as const, cp: n })

  test('keeps at most `limit` FENs, evicting the least recently used', () => {
    const cache = new BoundedEvalCache(3)
    cache.set('a', cp(1))
    cache.set('b', cp(2))
    cache.set('c', cp(3))
    expect(cache.get('a')).toEqual(cp(1)) // a is now the most recent
    cache.set('d', cp(4))
    expect(cache.size).toBe(3)
    expect(cache.has('b')).toBe(false)
    expect([...cache.keys()]).toEqual(['c', 'a', 'd'])
  })

  test('re-setting a FEN does not grow the cache', () => {
    const cache = new BoundedEvalCache(2)
    cache.set('a', cp(1))
    cache.set('a', cp(5))
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toEqual(cp(5))
  })
})
