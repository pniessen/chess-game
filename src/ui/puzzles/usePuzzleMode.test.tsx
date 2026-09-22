import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MatchController, type EngineLike } from '../../match/controller'
import type { MatchConfig } from '../../match/types'
import { usePuzzleMode } from './usePuzzleMode'

/** A real controller over an engine whose searches we answer by hand. */
function pendingEngine() {
  const replies: Array<(best: string) => void> = []
  const engine: EngineLike = {
    waitReady: () => Promise.resolve(),
    configure: () => {},
    newGame: () => {},
    setPosition: () => {},
    search: () =>
      new Promise((resolve) => {
        replies.push((best) => resolve({ best, lines: [] }))
      }),
    stop: () => {},
    dispose: () => {},
  }
  return { engine, replies }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const HUMANS: MatchConfig = { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }
const ENGINE_WHITE: MatchConfig = {
  white: { kind: 'engine', level: 8 },
  black: { kind: 'human' },
  timeControl: { kind: 'timed', initialMs: 60_000, incrementMs: 0 },
  engineDelayMs: 0,
}

describe('usePuzzleMode', () => {
  // Breaks if puzzle mode lets the engine move or the clock run for the paused game.
  test('entering pauses a live game (engine reply dropped, clock stopped); exit resumes it', async () => {
    const { engine, replies } = pendingEngine()
    const c = new MatchController({ engine })
    c.start(ENGINE_WHITE)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    const { result } = renderHook(() => usePuzzleMode(c))

    act(() => result.current.enter())
    expect(result.current.screen).toBe('puzzles')
    expect(c.snapshot().phase.kind).toBe('paused')
    expect(c.clockState().running).toBeNull()
    await tick()
    for (const reply of replies) reply('e2e4')
    await tick()
    expect(c.snapshot().game.moves).toHaveLength(0)

    const asked = replies.length
    act(() => result.current.exit())
    expect(result.current.screen).toBe('game')
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    expect(c.clockState().running).toBe('w')
    await vi.waitFor(() => expect(replies.length).toBeGreaterThan(asked))
    replies.at(-1)?.('e2e4')
    await vi.waitFor(() => expect(c.snapshot().game.moves).toHaveLength(1))
    c.dispose()
  })

  test('a finished game is left alone on the way in and out', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start(HUMANS)
    c.resign('w')
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('finished')
    c.dispose()
  })

  // Breaks if exit resumes a game the USER had paused (zero-player pause button).
  test('a game the user paused stays paused after the round trip', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start({ ...ENGINE_WHITE, black: { kind: 'engine', level: 8 } })
    c.pause()
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('paused')
    c.dispose()
  })

  test('entering twice still resumes on exit', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start(HUMANS)
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.enter())
    expect(c.snapshot().phase.kind).toBe('paused')
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('awaiting-human')
    c.dispose()
  })
})
