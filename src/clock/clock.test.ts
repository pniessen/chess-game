import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Clock } from './clock'
import type { TimeControl } from './types'

const FIVE_MIN: TimeControl = { kind: 'timed', initialMs: 300_000, incrementMs: 3_000 }

describe('Clock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a new clock holds the initial time and is not running', () => {
    const c = new Clock(FIVE_MIN)
    expect(c.getState()).toEqual({
      whiteMs: 300_000, blackMs: 300_000, running: null, flagged: null,
    })
  })

  test('the running side loses time; the idle side does not', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(3_000)
    const s = c.getState()
    expect(s.whiteMs).toBe(297_000)
    expect(s.blackMs).toBe(300_000)
    expect(s.running).toBe('w')
  })

  test('switching sides applies the increment to the side that moved', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(3_000)
    c.switchTo('b')
    const s = c.getState()
    expect(s.whiteMs).toBe(300_000) // 297_000 + 3_000 increment
    expect(s.running).toBe('b')
  })

  test('pause freezes the clock and resume continues from the same time', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(5_000)
    c.pause()
    vi.advanceTimersByTime(60_000)
    expect(c.getState().whiteMs).toBe(295_000)
    c.resume()
    vi.advanceTimersByTime(1_000)
    expect(c.getState().whiteMs).toBe(294_000)
  })

  test('running out fires onFlag once and clamps at zero', () => {
    const c = new Clock({ kind: 'timed', initialMs: 1_000, incrementMs: 0 })
    const flagged = vi.fn()
    c.onFlag(flagged)
    c.start('w')
    vi.advanceTimersByTime(5_000)
    expect(flagged).toHaveBeenCalledTimes(1)
    expect(flagged).toHaveBeenCalledWith('w')
    const s = c.getState()
    expect(s.whiteMs).toBe(0)
    expect(s.flagged).toBe('w')
  })

  test('an untimed control never runs and never flags', () => {
    const c = new Clock({ kind: 'untimed' })
    const flagged = vi.fn()
    c.onFlag(flagged)
    c.start('w')
    vi.advanceTimersByTime(600_000)
    expect(flagged).not.toHaveBeenCalled()
    expect(c.getState().running).toBe(null)
  })

  test('resume after pause + switchTo does not erase elapsed time or misattribute running side', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(3_000)
    c.pause()
    // pausedSide is now 'w' with 297_000 remaining
    c.switchTo('b')
    // black is now running with 300_000; pausedSide is cleared to null by switchTo
    vi.advanceTimersByTime(2_000)
    // black should now be at 298_000
    c.resume()
    // resume does nothing (pausedSide is null); settle still protects black's time
    const s = c.getState()
    expect(s.blackMs).toBe(298_000) // black's 2s elapsed should NOT be erased
    expect(s.whiteMs).toBe(297_000) // white stays at paused value
    expect(s.running).toBe('b') // black is still running (resume was no-op)
  })
})
