import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Board } from './Board'
import { FLIGHT_MS } from './useMoveFlight'
import { Position } from '../../game-core/position'
import type { PlayedMove } from '../../game-core/types'

/**
 * Every assertion here is about the END state, or about a class/attribute
 * that is either on or off — never about a mid-flight frame. jsdom runs no
 * animations at all: what is under test is which pieces the board puts in
 * the air and when it refuses to.
 */

interface Step {
  position: Position
  move: PlayedMove | null
}

/** The position a line starts from: rendered first, so nothing animates into it. */
const from = (fen?: string): Step => ({ position: new Position(fen), move: null })

/** Replay `sans` from `fen`, returning a step (position + move) for each. */
function line(sans: string[], fen?: string): Step[] {
  const board = new Position(fen)
  return sans.map((san) => {
    const played = board.trySan(san)
    if (!played.ok) throw new Error(`illegal test move ${san}`)
    return { position: new Position(played.move.fenAfter), move: played.move }
  })
}

const view = (step: Step | null, extra: { orientation?: 'white' | 'black'; cutKey?: number } = {}) => ({
  position: step?.position ?? new Position(),
  orientation: extra.orientation ?? ('white' as const),
  highlights: {},
  onSquareClick: vi.fn(),
  lastPlayed: step?.move ?? null,
  cutKey: extra.cutKey ?? 0,
})

const flyers = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-flight]')].map((e) => [
    e.getAttribute('data-flight'),
    e.getAttribute('data-flight-from'),
    e.getAttribute('data-flight-to'),
  ])

const arriving = (container: HTMLElement) =>
  [...container.querySelectorAll('.square.arriving')].map((e) => e.getAttribute('data-square'))

describe('Board move animation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('the first position rendered never animates', () => {
    const { container } = render(<Board {...view(null)} />)
    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
    expect(arriving(container)).toEqual([])
  })

  test('a played move puts the piece in the air and holds its arrival back', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!)} />)

    expect(flyers(container)).toEqual([['mover', 'e2', 'e4']])
    expect(arriving(container)).toEqual(['e4'])
    // The real board is already the new position — the animation is only
    // ever decoration on top of it.
    expect(container.querySelector('[data-square="e4"] [data-piece]')?.getAttribute('data-piece')).toBe('wP')
    expect(container.querySelector('[data-square="e2"] [data-piece]')).toBeNull()
  })

  test('the flight clears itself once the piece has landed', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!)} />)
    expect(container.querySelector('[data-testid="flight-layer"]')).not.toBeNull()

    act(() => void vi.advanceTimersByTime(FLIGHT_MS))

    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
    expect(arriving(container)).toEqual([])
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull()
  })

  test('a second move mid-flight replaces the first and strands nothing', () => {
    const [e4, e5] = line(['e4', 'e5'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!)} />)
    // No timer advance: the first move is still in the air.
    rerender(<Board {...view(e5!)} />)

    expect(flyers(container)).toEqual([['mover', 'e7', 'e5']])
    expect(arriving(container)).toEqual(['e5'])
    act(() => void vi.advanceTimersByTime(FLIGHT_MS))
    expect(arriving(container)).toEqual([])
  })

  test('a capture fades the taken piece under the arriving one', () => {
    const [, d5, exd5] = line(['e4', 'd5', 'exd5'])
    const { container, rerender } = render(<Board {...view(d5!)} />)
    rerender(<Board {...view(exd5!)} />)

    // Captured first in DOM order, so it paints underneath.
    expect(flyers(container)).toEqual([
      ['captured', 'd5', 'd5'],
      ['mover', 'e4', 'd5'],
    ])
    expect(arriving(container)).toEqual(['d5'])
  })

  test('castling flies the king and the rook', () => {
    const steps = line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
    const { container, rerender } = render(<Board {...view(steps[5]!)} />)
    rerender(<Board {...view(steps[6]!)} />)

    expect(flyers(container)).toEqual([
      ['mover', 'e1', 'g1'],
      ['mover', 'h1', 'f1'],
    ])
    expect(arriving(container).sort()).toEqual(['f1', 'g1'])
  })

  test('a promotion flies the pawn while the new piece waits on the square', () => {
    const fen = '8/P6k/8/8/8/8/8/7K w - - 0 1'
    const [promotion] = line(['a8=Q'], fen)
    const { container, rerender } = render(<Board {...view(from(fen))} />)
    rerender(<Board {...view(promotion!)} />)

    const img = container.querySelector('[data-flight="mover"] img')
    expect(img?.getAttribute('src')).toContain('wP.svg')
    expect(container.querySelector('[data-square="a8"] [data-piece]')?.getAttribute('data-piece')).toBe('wQ')
    expect(arriving(container)).toEqual(['a8'])
  })

  test('a cutKey change makes the next position cut — history browsing never animates', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    // Exactly what clicking the first move in the move list looks like:
    // one ply forward, but a jump.
    rerender(<Board {...view(e4!, { cutKey: 1 })} />)

    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
    expect(arriving(container)).toEqual([])
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull()
  })

  // A cut that changes no position must not be carried forward: starting a
  // new game, or jumping to the ply already on screen, would otherwise eat
  // the animation of the next real move.
  test('a cut that changes nothing does not swallow the next move', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(null, { cutKey: 1 })} />)
    rerender(<Board {...view(e4!, { cutKey: 1 })} />)

    expect(flyers(container)).toEqual([['mover', 'e2', 'e4']])
  })

  test('flipping the board cuts', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!, { orientation: 'black' })} />)

    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
  })

  test('an unrelated position cuts, even with a move to point at', () => {
    const [e4] = line(['e4'])
    const elsewhere = new Position('8/8/8/4k3/8/8/4K3/8 w - - 0 1')
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(
      <Board
        position={elsewhere}
        orientation="white"
        highlights={{}}
        onSquareClick={vi.fn()}
        lastPlayed={e4!.move}
      />,
    )

    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
  })

  test('taking a move back cuts', () => {
    const [e4, e5] = line(['e4', 'e5'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e5!)} />)
    act(() => void vi.advanceTimersByTime(FLIGHT_MS))
    rerender(<Board {...view(e4!, { cutKey: 1 })} />)

    expect(container.querySelector('[data-testid="flight-layer"]')).toBeNull()
    expect(container.querySelector('[data-square="e7"] [data-piece]')?.getAttribute('data-piece')).toBe('bP')
  })

  // A bare `captured` class would pick up the captured-pieces card styling
  // in app.css — a white surface and an "No captures yet" label — right in
  // the middle of the board.
  test('flyer classes are namespaced, so no app-level class can claim them', () => {
    const [, d5, exd5] = line(['e4', 'd5', 'exd5'])
    const { container, rerender } = render(<Board {...view(d5!)} />)
    rerender(<Board {...view(exd5!)} />)

    const classes = [...container.querySelectorAll('[data-flight]')].map((e) => e.className)
    expect(classes).toEqual(['flight-piece flight-captured', 'flight-piece flight-mover'])
  })

  test('the flight layer adds no squares and no [data-piece] nodes', () => {
    const [e4] = line(['e4'])
    const { container, rerender } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!)} />)

    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
    expect(container.querySelectorAll('[data-piece]')).toHaveLength(32)
    expect(container.querySelector('[data-testid="flight-layer"]')?.getAttribute('aria-hidden')).toBe('true')
  })

  test('unmounting mid-flight leaves no timer running', () => {
    const [e4] = line(['e4'])
    const { rerender, unmount } = render(<Board {...view(null)} />)
    rerender(<Board {...view(e4!)} />)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
