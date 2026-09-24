import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Position } from '../../game-core/position'
import { useDragMove } from './useDragMove'

/**
 * useDragMove.ts's own comment (right above the unmount effect) says the
 * point of that effect: "If the component unmounts while a snap-back is in
 * flight, nothing must be left running — the same contract useMoveFlight's
 * timer keeps." useMoveFlight's half of that contract has a test
 * (Board.animation.test.tsx's "unmounting mid-flight leaves no timer
 * running"); this is the other half, for the drag ghost's own timer.
 *
 * jsdom has no real layout, so `document.elementFromPoint` (used to find
 * the square under the pointer) isn't implemented at all here — stubbed
 * below to make an illegal drop reachable without a real browser. The
 * point of the test is the timer's lifecycle, not the geometry.
 */
describe('useDragMove unmount safety', () => {
  let boardEl: HTMLDivElement
  let fromEl: HTMLDivElement
  let toEl: HTMLDivElement
  let elementFromPointSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()

    boardEl = document.createElement('div')
    fromEl = document.createElement('div')
    fromEl.setAttribute('data-square', 'e2')
    toEl = document.createElement('div')
    // d2 holds White's own pawn in the start position — illegal for e2's
    // pawn regardless of shape, so the drop is guaranteed to take the
    // snap-back ("returning") branch rather than the instant handoff.
    toEl.setAttribute('data-square', 'd2')
    boardEl.appendChild(fromEl)
    boardEl.appendChild(toEl)
    document.body.appendChild(boardEl)

    // Real layout isn't available in jsdom; the square under the pointer
    // is always `toEl` here regardless of coordinates — enough to drive
    // the hook through "dragging" into "returning".
    elementFromPointSpy = vi.fn(() => toEl)
    document.elementFromPoint = elementFromPointSpy as unknown as typeof document.elementFromPoint
  })

  afterEach(() => {
    document.body.removeChild(boardEl)
    vi.useRealTimers()
  })

  test('unmounting while an illegal drop is snapping back leaves no timer running', () => {
    const position = new Position() // the start position: e2 is a White pawn
    const { result, unmount } = renderHook(() =>
      useDragMove({ position, enabled: true, onDrop: vi.fn() }),
    )

    const pointerId = 1
    result.current.onPointerDown({
      target: fromEl,
      currentTarget: boardEl,
      button: 0,
      pointerId,
      clientX: 0,
      clientY: 0,
    } as unknown as React.PointerEvent)

    // Exceed the drag threshold while still "over" the board, so capture
    // engages and the gesture is recognised as a drag (see useDragMove.ts).
    boardEl.dispatchEvent(
      new PointerEvent('pointermove', { pointerId, clientX: 20, clientY: 20, bubbles: true }),
    )

    // Release onto d2 — illegal, so this takes the snap-back branch and
    // schedules `returnTimer`.
    boardEl.dispatchEvent(
      new PointerEvent('pointerup', { pointerId, clientX: 20, clientY: 20, bubbles: true }),
    )
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
