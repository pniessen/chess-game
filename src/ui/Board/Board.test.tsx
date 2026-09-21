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

  test('coordinates label the two edges nearest the viewer and flip with the board', () => {
    const { container, unmount } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    // White view: files along rank 1, ranks up the a-file.
    expect(container.querySelector('[data-square="a1"] .coord.file')).toHaveTextContent('a')
    expect(container.querySelector('[data-square="a1"] .coord.rank')).toHaveTextContent('1')
    expect(container.querySelector('[data-square="h8"] .coord')).toBeNull()
    expect(container.querySelectorAll('.coord.file')).toHaveLength(8)
    expect(container.querySelectorAll('.coord.rank')).toHaveLength(8)
    unmount()

    const flipped = render(
      <Board position={new Position()} orientation="black" highlights={{}} onSquareClick={vi.fn()} />,
    )
    // Black view: files along rank 8, ranks up the h-file.
    expect(flipped.container.querySelector('[data-square="h8"] .coord.file')).toHaveTextContent('h')
    expect(flipped.container.querySelector('[data-square="h8"] .coord.rank')).toHaveTextContent('8')
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
})
