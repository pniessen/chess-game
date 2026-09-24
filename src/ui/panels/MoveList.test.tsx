import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
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
