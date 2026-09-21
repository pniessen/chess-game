import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Board } from './Board'
import { Position } from '../../game-core/position'

describe('Board', () => {
  test('renders 64 squares and 32 pieces from the start position', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
    expect(container.querySelectorAll('[data-piece]')).toHaveLength(32)
  })

  test('places the white king on e1 regardless of orientation', () => {
    for (const orientation of ['white', 'black'] as const) {
      const { container, unmount } = render(
        <Board position={new Position()} orientation={orientation} highlights={{}} onSquareClick={vi.fn()} />,
      )
      const e1 = container.querySelector('[data-square="e1"]')
      expect(e1?.querySelector('[data-piece]')?.getAttribute('data-piece')).toBe('wK')
      unmount()
    }
  })

  test('applies highlight classes', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{
          selected: 'e2',
          legal: ['e3', 'e4'],
          captures: ['d5'],
          lastMove: ['e2', 'e4'],
          check: 'e1',
        }}
        onSquareClick={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-square="e2"]')?.className).toContain('selected')
    expect(container.querySelector('[data-square="e4"]')?.className).toContain('legal')
    expect(container.querySelector('[data-square="d5"]')?.className).toContain('capture')
    expect(container.querySelector('[data-square="e1"]')?.className).toContain('check')
    // lastMove is a two-square tuple; both ends must carry the class.
    expect(container.querySelector('[data-square="e2"]')?.className).toContain('last-move')
    expect(container.querySelector('[data-square="e4"]')?.className).toContain('last-move')
  })

  test('coordinates sit in a gutter outside the board and flip with it', () => {
    const labels = (container: HTMLElement, sel: string) =>
      [...container.querySelectorAll(`${sel} .coord-label`)].map((e) => e.textContent)

    const { container, unmount } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(labels(container, '.coords-files')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(labels(container, '.coords-ranks')).toEqual(['8', '7', '6', '5', '4', '3', '2', '1'])
    // Nothing inside the board grid itself any more.
    expect(container.querySelector('[data-square] .coord, .board .coord-label')).toBeNull()
    // The gutters are siblings of the grid, not children of it.
    const grid = container.querySelector('[role="grid"]')
    expect(grid?.querySelector('.coords-files, .coords-ranks')).toBeNull()
    unmount()

    const flipped = render(
      <Board position={new Position()} orientation="black" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(labels(flipped.container, '.coords-files')).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
    expect(labels(flipped.container, '.coords-ranks')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  test('clicking a square reports it', async () => {
    const onSquareClick = vi.fn()
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={onSquareClick} />,
    )
    const e2 = container.querySelector('[data-square="e2"]') as HTMLElement
    e2.click()
    expect(onSquareClick).toHaveBeenCalledWith('e2')
  })

  test('annotations render in an overlay that never claims a square', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{}}
        onSquareClick={vi.fn()}
        annotations={[
          { kind: 'square', square: 'g1', tone: 'hint' },
          { kind: 'arrow', from: 'g1', to: 'f3', tone: 'hint' },
        ]}
      />,
    )
    const rect = container.querySelector('[data-annotation="square"]')
    expect(rect?.getAttribute('data-annotation-square')).toBe('g1')
    expect(rect?.getAttribute('x')).toBe('6')
    expect(rect?.getAttribute('y')).toBe('7')
    const arrow = container.querySelector('[data-annotation="arrow"]')
    expect(arrow?.getAttribute('data-from')).toBe('g1')
    expect(arrow?.getAttribute('data-to')).toBe('f3')
    // Still exactly 64 squares: the overlay must not add [data-square] nodes.
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
  })

  test('no annotations, no overlay', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="board-overlay"]')).toBeNull()
  })
})
