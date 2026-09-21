import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Game } from '../../game-core/game'
import type { MatchPhase } from '../../match/types'
import { hintKeyOf } from '../gameKey'
import { useHints, type HintAnalyze } from './useHints'

describe('useHints reset on game end', () => {
  test('a hint still pending when the phase becomes finished is cleared, and its late answer is dropped', async () => {
    const game = new Game()
    const r = game.play({ from: 'e2', to: 'e4' })
    if (!r.ok) throw new Error('setup')

    let settle: ((v: Awaited<ReturnType<HintAnalyze>>) => void) | null = null
    const analyze = vi.fn<HintAnalyze>(
      () => new Promise((resolve) => { settle = resolve }),
    )
    const reason = vi.fn(async () => 'why')

    const { result, rerender } = renderHook(
      ({ phase }: { phase: MatchPhase['kind'] }) =>
        useHints({ resetKey: hintKeyOf(game, phase), analyze, reason }),
      { initialProps: { phase: 'awaiting-human' as MatchPhase['kind'] } },
    )

    act(() => result.current.advance(game.positionAt(game.livePly)))
    expect(result.current.pending).toBe(true)

    // The human resigns (or a clock flags): same Game, same ply, new phase.
    rerender({ phase: 'finished' })
    expect(result.current.pending).toBe(false)
    expect(result.current.stage).toBe(0)

    // The engine's late answer must not surface a hint after the game ended.
    await act(async () => {
      settle?.({ best: 'e7e5', lines: [{ depth: 12, multipv: 1, scoreCp: 20, scoreMate: null, pv: ['e7e5'] } as never] })
    })
    expect(result.current.stage).toBe(0)
    expect(result.current.pending).toBe(false)
  })
})
