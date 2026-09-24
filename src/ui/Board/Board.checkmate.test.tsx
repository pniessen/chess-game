import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Board } from './Board'
import { Position } from '../../game-core/position'

/**
 * Task 4: the check glow "holds" (no longer pulsing) and the board shakes
 * once, on checkmate only — never for a plain check or a stalemate/draw.
 * Class-based assertions only; the CSS itself (pulse vs. held, the shake
 * keyframes, and reduced-motion disabling all three) is exercised by the
 * e2e spec and the reduced-motion computed-style checks there.
 */
describe('Board checkmate presentation', () => {
  test('a plain check gets "check" but not "mated", and the board does not shake', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{ check: 'e1' }}
        onSquareClick={vi.fn()}
      />,
    )
    const king = container.querySelector('[data-square="e1"]')
    expect(king?.className).toContain('check')
    expect(king?.className).not.toContain('mated')
    expect(container.querySelector('[role="grid"]')?.className).not.toContain('checkmate-shake')
  })

  test('checkmate holds the glow ("mated") on the checked square and shakes the board', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{ check: 'e1', checkmate: true }}
        onSquareClick={vi.fn()}
      />,
    )
    const king = container.querySelector('[data-square="e1"]')
    expect(king?.className).toContain('check')
    expect(king?.className).toContain('mated')
    expect(container.querySelector('[role="grid"]')?.className).toContain('checkmate-shake')
  })

  test('stalemate (no check square at all) never shakes the board', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[role="grid"]')?.className).not.toContain('checkmate-shake')
  })

  // Final-review fix: most puzzles are solved BY delivering mate, so
  // `checkmate` and `celebrate` (Task 7's ring) are routinely both true on
  // the same render. The glow/mated styling stays, but the shake — this
  // branch's vocabulary for a bad outcome — must not play alongside a win.
  test('checkmate together with celebrate: the glow and ring show, but the board does not shake', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{ check: 'e1', checkmate: true, celebrate: true }}
        onSquareClick={vi.fn()}
      />,
    )
    const grid = container.querySelector('[role="grid"]')
    const king = container.querySelector('[data-square="e1"]')
    expect(king?.className).toContain('check')
    expect(king?.className).toContain('mated')
    expect(grid?.className).toContain('celebrate-solved')
    expect(grid?.className).not.toContain('checkmate-shake')
  })
})
