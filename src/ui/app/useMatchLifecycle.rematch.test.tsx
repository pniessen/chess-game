import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { MatchController } from '../../match/controller'
import type { MatchConfig } from '../../match/types'
import { DEFAULT_SETTINGS } from '../../storage/storage'
import { useMatchLifecycle } from './useMatchLifecycle'

/**
 * Task 6 review fix round 1: "Rematch" must go through the same engine
 * degradation a New game gets, and must leave the New game panel saying
 * what is actually being played.
 */

const BLITZ = { kind: 'timed', initialMs: 300_000, incrementMs: 3_000 } as const
/** Human Black against a level-5 engine, Blitz 5+3 — nothing like the panel's defaults. */
const ONE_PLAYER: MatchConfig = {
  white: { kind: 'engine', level: 5 },
  black: { kind: 'human' },
  timeControl: BLITZ,
}

function harness(config: MatchConfig, engineAvailable: boolean) {
  const start = vi.fn()
  const controller = { start, snapshot: () => ({ config }) } as unknown as MatchController
  const records = {
    pendingResume: null,
    setResumeChoice: vi.fn(),
    scoredRef: { current: true },
    recordedRef: { current: true },
    historyRef: { current: null },
  }
  const { result } = renderHook(() =>
    useMatchLifecycle({
      controller,
      settings: DEFAULT_SETTINGS,
      updateSettings: vi.fn(),
      engineAvailable,
      records: records as Parameters<typeof useMatchLifecycle>[0]['records'],
      resetInput: vi.fn(),
      onMatchReset: vi.fn(),
      onShowMoves: vi.fn(),
    }),
  )
  return { start, result }
}

describe('handleRematch', () => {
  // Red if the rematch stops keeping the seats, the level or the clock.
  test('replays the finished setup when the engine is there', () => {
    const { start, result } = harness(ONE_PLAYER, true)
    act(() => result.current.handleRematch())
    expect(start).toHaveBeenCalledWith(ONE_PLAYER)
  })

  // Red if the rematch hands the controller an engine seat that nothing can
  // fill — the board would simply wait for a move that never comes.
  test('degrades the engine seat to a human one when there is no engine', () => {
    const { start, result } = harness(ONE_PLAYER, false)
    act(() => result.current.handleRematch())
    expect(start).toHaveBeenCalledWith({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: BLITZ,
    })
  })

  // Red if the New game panel is left saying something the running match is
  // not — the next New game would silently use those stale values.
  test('brings the New game panel into step with what it just started', () => {
    const { result } = harness(ONE_PLAYER, true)
    expect(result.current.choices.mode).toBe('two-player')
    act(() => result.current.handleRematch())
    expect(result.current.choices.mode).toBe('one-player')
    expect(result.current.choices.level).toBe(5)
    expect(result.current.choices.color).toBe('black')
    expect(result.current.choices.timeControlId).toBe('blitz-5-3')
  })

  // Red if a degraded rematch tells the panel it is still a one-player game.
  test('a degraded rematch says two-player, since that is what is being played', () => {
    const { result } = harness(ONE_PLAYER, false)
    act(() => result.current.handleRematch())
    expect(result.current.choices.mode).toBe('two-player')
  })

  // Red if the pace of a zero-player rematch is dropped.
  test('an engine-vs-engine rematch keeps both seats and the speed', () => {
    const zero: MatchConfig = {
      white: { kind: 'engine', level: 2 },
      black: { kind: 'engine', level: 2 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 120,
    }
    const { start, result } = harness(zero, true)
    act(() => result.current.handleRematch())
    expect(start).toHaveBeenCalledWith(zero)
    expect(result.current.choices.mode).toBe('zero-player')
  })

  // Red if a game that began from a set-up position rematches from the
  // standard one (a stored setup carries no start position).
  test('keeps the position the finished game started from', () => {
    const fen = '4r2k/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQ - 0 1'
    const { start, result } = harness({ ...ONE_PLAYER, startFen: fen }, true)
    act(() => result.current.handleRematch())
    expect(start).toHaveBeenCalledWith({ ...ONE_PLAYER, startFen: fen })
  })
})
