import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Board } from './Board'
import { Position } from '../../game-core/position'

/**
 * Task 7: the puzzle-solved ring (`highlights.celebrate`) and the wrong-move
 * piece shake (`highlights.wrongMove`) — both PuzzleScreen-only flags that
 * Board simply turns into classes; the CSS itself (the ring/shake keyframes
 * and reduced-motion disabling them) is exercised by the e2e spec and its
 * reduced-motion computed-style checks. Mirrors Board.checkmate.test.tsx's
 * style for the same kind of Task 4 flags.
 */
describe('Board puzzle-celebration presentation', () => {
  test('celebrate adds the ring class to the board; unset (the main game) never does', () => {
    const { container, rerender } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[role="grid"]')?.className).not.toContain('celebrate-solved')

    rerender(
      <Board position={new Position()} orientation="white" highlights={{ celebrate: true }} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[role="grid"]')?.className).toContain('celebrate-solved')
  })

  test('wrongMove marks only that square; every other square is untouched', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{ wrongMove: 'c7' }} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[data-square="c7"]')?.className).toContain('wrong-move')
    expect(container.querySelector('[data-square="d2"]')?.className).not.toContain('wrong-move')
  })
})
