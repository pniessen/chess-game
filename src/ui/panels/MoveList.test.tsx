import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

// Task 9: real FENs (unlike the bare `move` helper above), since the
// preview parses `fenAfter` into a position to render.
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
const moveWithFen = (san: string, color: 'w' | 'b', fenAfter: string): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter,
})

describe('MoveList', () => {
  test('renders numbered pairs', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={2} onJump={vi.fn()} />,
    )
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
    expect(screen.getByTestId('move-2')).toHaveTextContent('e5')
  })

  test('clicking a move jumps to that ply', () => {
    const onJump = vi.fn()
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={onJump} />)
    screen.getByTestId('move-1').click()
    expect(onJump).toHaveBeenCalledWith(1)
  })

  test('marks the current ply', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={1} onJump={vi.fn()} />,
    )
    expect(screen.getByTestId('move-1').className).toContain('current')
    expect(screen.getByTestId('move-2').className).not.toContain('current')
  })

  test('disabled: jumping does not fire onJump', () => {
    const onJump = vi.fn()
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={onJump} disabled />)
    screen.getByTestId('move-1').click()
    expect(onJump).not.toHaveBeenCalled()
  })

  test('review marks are shown next to the moves', () => {
    render(
      <MoveList
        moves={[move('e4', 'w'), move('f6', 'b')]}
        currentPly={2}
        onJump={vi.fn()}
        marks={
          new Map([
            [1, { classification: 'best', loss: 0 }],
            [2, { classification: 'blunder', loss: 38 }],
          ])
        }
      />,
    )
    expect(screen.getByTestId('mark-1')).toHaveTextContent('!')
    expect(screen.getByTestId('mark-2')).toHaveTextContent('??')
    expect(screen.getByTestId('move-2')).toHaveTextContent('f6??')
  })

  // Task 8: the chip is coloured per classification (readable in both
  // themes via app.css's mark-* rules) and its title is the hover tooltip —
  // the eval swing, not just the bare classification name.
  test('each chip carries its classification as a class and the eval swing as its tooltip', () => {
    render(
      <MoveList
        moves={[move('e4', 'w'), move('f6', 'b')]}
        currentPly={2}
        onJump={vi.fn()}
        marks={
          new Map([
            [1, { classification: 'best', loss: 0 }],
            [2, { classification: 'blunder', loss: 38 }],
          ])
        }
      />,
    )
    expect(screen.getByTestId('mark-1').className).toContain('mark-best')
    expect(screen.getByTestId('mark-1')).toHaveAttribute('title', 'Best move')
    expect(screen.getByTestId('mark-2').className).toContain('mark-blunder')
    expect(screen.getByTestId('mark-2')).toHaveAttribute('title', 'Blunder (−38% win)')
  })

  // 'ok' moves are never flagged and have no MARK glyph — no chip at all,
  // exactly as before this task (the review still ran; this move is just
  // unremarkable).
  test('an "ok" move (no glyph) shows no chip', () => {
    render(
      <MoveList
        moves={[move('e4', 'w')]}
        currentPly={1}
        onJump={vi.fn()}
        marks={new Map([[1, { classification: 'ok', loss: 3 }]])}
      />,
    )
    expect(screen.queryByTestId('mark-1')).not.toBeInTheDocument()
  })
})

// Task 9: move-list position preview.
describe('MoveList position preview', () => {
  const twoMoves = [
    moveWithFen('e4', 'w', AFTER_E4),
    moveWithFen('e5', 'b', AFTER_E5),
  ]

  test('no preview is shown until a move is hovered or focused', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    expect(screen.queryByTestId('move-preview')).not.toBeInTheDocument()
  })

  test('hovering a move shows a preview of the position after it', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('move-1'))
    const preview = screen.getByTestId('move-preview')
    expect(preview).toBeInTheDocument()
    // After 1. e4: a white pawn has left e2 for e4.
    expect(preview.querySelector('[data-piece="wP"]')).toBeInTheDocument()
    expect(preview).toHaveTextContent('Position after e4')
  })

  test('the triggering move is aria-describedby the preview, so a screen reader announces it on focus', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    const button = screen.getByTestId('move-1')
    expect(button).not.toHaveAttribute('aria-describedby')

    fireEvent.mouseEnter(button)
    const preview = screen.getByTestId('move-preview')
    expect(button).toHaveAttribute('aria-describedby', preview.id)
    expect(preview.id).toBeTruthy()

    // A move NOT showing its own preview never points at someone else's.
    fireEvent.mouseEnter(screen.getByTestId('move-2'))
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.getByTestId('move-2')).toHaveAttribute('aria-describedby', preview.id)
  })

  test('moving the mouse off the move hides the preview', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    const button = screen.getByTestId('move-1')
    fireEvent.mouseEnter(button)
    expect(screen.getByTestId('move-preview')).toBeInTheDocument()
    fireEvent.mouseLeave(button)
    expect(screen.queryByTestId('move-preview')).not.toBeInTheDocument()
  })

  test('is keyboard-reachable: focusing a move shows it, blurring hides it', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    const button = screen.getByTestId('move-2')
    act(() => button.focus())
    const preview = screen.getByTestId('move-preview')
    expect(preview).toHaveTextContent('Position after e5')
    act(() => button.blur())
    expect(screen.queryByTestId('move-preview')).not.toBeInTheDocument()
  })

  test('Escape dismisses the preview without moving focus off the move', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    const button = screen.getByTestId('move-1')
    act(() => button.focus())
    expect(screen.getByTestId('move-preview')).toBeInTheDocument()
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByTestId('move-preview')).not.toBeInTheDocument()
    // Escape hid the popover; it did not blur the trigger.
    expect(button).toHaveFocus()
  })

  test('hovering a move does not stop clicking it from jumping', () => {
    const onJump = vi.fn()
    render(<MoveList moves={twoMoves} currentPly={2} onJump={onJump} />)
    const button = screen.getByTestId('move-1')
    fireEvent.mouseEnter(button)
    fireEvent.click(button)
    expect(onJump).toHaveBeenCalledWith(1)
  })

  test('switching hover from one move to another swaps the preview instead of stacking two', () => {
    render(<MoveList moves={twoMoves} currentPly={2} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByTestId('move-1'))
    fireEvent.mouseEnter(screen.getByTestId('move-2'))
    expect(screen.getAllByTestId('move-preview')).toHaveLength(1)
    expect(screen.getByTestId('move-preview')).toHaveTextContent('Position after e5')
  })
})
