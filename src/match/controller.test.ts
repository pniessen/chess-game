import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController } from './controller'
import type { MatchConfig } from './types'

/** An engine we resolve by hand, so no Stockfish and no waiting. */
function fakeEngine() {
  const calls: Array<{ resolve: (best: string) => void; reject: (e: Error) => void }> = []
  return {
    calls,
    client: {
      waitReady: () => Promise.resolve(),
      configure: vi.fn(),
      newGame: vi.fn(),
      setPosition: vi.fn(),
      search: () =>
        new Promise<{ best: string; lines: [] }>((resolve, reject) => {
          calls.push({
            resolve: (best) => resolve({ best, lines: [] }),
            reject,
          })
        }),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  }
}

const HUMAN_VS_ENGINE: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'engine', level: 4 },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

describe('MatchController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a human move is applied and the engine is asked to reply', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    expect(c.submitHumanMove({ from: 'e2', to: 'e4' }).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a stale engine reply is ignored after a new game starts', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)

    c.start(HUMAN_VS_ENGINE) // new game while the engine is thinking
    e.calls[0]?.resolve('e7e5') // the old reply lands late
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a human move is refused while the engine is thinking', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.submitHumanMove({ from: 'd2', to: 'd4' }).ok).toBe(false)
  })

  test('undo in one-player mode takes back both plies', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)

    c.undo()
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('running out of time finishes the game as a flag loss', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      ...HUMAN_VS_ENGINE,
      timeControl: { kind: 'timed', initialMs: 1_000, incrementMs: 0 },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('flag')
  })

  test('checkmate finishes the game normally', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    })
    c.submitHumanMove({ from: 'f3', to: 'f7' })
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('normal')
      expect(phase.status).toEqual({ kind: 'checkmate', winner: 'w' })
    }
  })

  test('step plays exactly one engine move, then re-pauses', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    })
    c.pause()
    expect(c.snapshot().phase.kind).toBe('paused')

    c.step()
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(1)
    expect(c.snapshot().phase.kind).toBe('paused')
  })

  test('two illegal engine moves finish the game as an engine error', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('a1a8') // illegal
    await vi.advanceTimersByTimeAsync(0)
    e.calls[1]?.resolve('a1a8') // illegal again
    await vi.advanceTimersByTimeAsync(0)

    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('engine-error')
    // The position must survive intact for export.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
  })

  test('subscribers are notified on every change', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const seen = vi.fn()
    c.subscribe(seen)
    c.start({
      white: { kind: 'human' }, black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
