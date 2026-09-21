import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Clock } from '../../clock/clock'
import { App } from '../App'
import { Clocks } from './Clocks'

const BLITZ_3_2 = { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 } as const

describe('the on-screen clock counts down between moves (C1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  test('App: after 1.e4 in a Blitz 3+2 game, Black\'s clock visibly runs down', async () => {
    localStorage.setItem(
      'chess-game:settings',
      JSON.stringify({ level: 3, timeControlId: 'blitz-3-2', orientation: 'white', soundEnabled: true, themeId: 'classic' }),
    )
    const { container } = render(<App />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const click = (sq: string) =>
      fireEvent.click(container.querySelector(`[data-square="${sq}"]`) as HTMLElement)
    click('e2')
    click('e4')
    expect(screen.getByTestId('clock-b')).toHaveTextContent('3:00')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_200)
    })
    // The snapshot was frozen at the move; only live polling moves this.
    expect(screen.getByTestId('clock-b')).toHaveTextContent('2:57')
    // White is not running and got its increment.
    expect(screen.getByTestId('clock-w')).toHaveTextContent('3:02')
  })

  test('polls only while a clock runs, and stops on unmount', async () => {
    const clock = new Clock(BLITZ_3_2)
    const readClock = vi.fn(() => clock.getState())

    // Not running: no polling at all.
    const stopped = render(<Clocks clock={clock.getState()} readClock={readClock} orientation="white" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(readClock).not.toHaveBeenCalled()
    stopped.unmount()

    clock.start('w')
    const running = render(<Clocks clock={clock.getState()} readClock={readClock} orientation="white" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(readClock.mock.calls.length).toBeGreaterThanOrEqual(9)
    expect(screen.getByTestId('clock-w')).toHaveTextContent('2:59')

    running.unmount()
    const callsAtUnmount = readClock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(readClock.mock.calls.length).toBe(callsAtUnmount)
    clock.dispose()
  })
})
