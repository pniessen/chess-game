import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  describe('last-move arrow', () => {
    test('absent when there is no last move (start position, new game)', () => {
      const { container } = render(
        <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
      )
      expect(container.querySelector('[data-testid="last-move-arrow"]')).toBeNull()
    })

    test('drawn from the highlights.lastMove tuple — the same one the square tint uses', () => {
      const { container } = render(
        <Board
          position={new Position()}
          orientation="white"
          highlights={{ lastMove: ['e2', 'e4'] }}
          onSquareClick={vi.fn()}
        />,
      )
      const arrow = container.querySelector('[data-testid="last-move-arrow"]')
      expect(arrow?.getAttribute('data-from')).toBe('e2')
      expect(arrow?.getAttribute('data-to')).toBe('e4')
      // The tint and the arrow are driven by the same prop, so browsing
      // history (which only ever changes `highlights.lastMove`) moves both.
      expect(container.querySelector('[data-square="e2"]')?.className).toContain('last-move')
    })

    test('follows history browsing: swaps when the displayed lastMove changes, disappears at ply 0', () => {
      const { container, rerender } = render(
        <Board
          position={new Position()}
          orientation="white"
          highlights={{ lastMove: ['g1', 'f3'] }}
          onSquareClick={vi.fn()}
        />,
      )
      expect(container.querySelector('[data-testid="last-move-arrow"]')?.getAttribute('data-to')).toBe('f3')

      rerender(
        <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
      )
      expect(container.querySelector('[data-testid="last-move-arrow"]')).toBeNull()
    })

    test('flips with the board', () => {
      const { container } = render(
        <Board
          position={new Position()}
          orientation="black"
          highlights={{ lastMove: ['e2', 'e4'] }}
          onSquareClick={vi.fn()}
        />,
      )
      const line = container.querySelector('.last-move-arrow-line')
      // e2->e4 is a vertical push; from black's view the y coordinates
      // invert relative to white's (see annotations.test.ts arrowLine).
      expect(Number(line?.getAttribute('y1'))).toBeCloseTo(1.5)
    })

    test('never claims a square and never blocks pointer events', () => {
      const { container } = render(
        <Board
          position={new Position()}
          orientation="white"
          highlights={{ lastMove: ['e2', 'e4'] }}
          onSquareClick={vi.fn()}
        />,
      )
      expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
      const svg = container.querySelector('[data-testid="last-move-arrow"]') as SVGElement
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    })
  })

  // Task 1: the board's edge length derives from --board-size (set on
  // .layout in app.css) instead of a hard 640px, so a short viewport
  // shrinks the board instead of pushing the page taller. jsdom has no real
  // layout engine (see useDragMove.unmount.test.tsx's comment on the same
  // limitation), so getBoundingClientRect/offsetWidth can't measure a
  // rendered pixel size here — this instead pins board.css's own rules by
  // source (the same technique durations.test.ts and
  // dragTargetContrast.test.ts use for the same reason) and evaluates its
  // exact width formula, so an edit that quietly reverts the formula to a
  // bare 640px, or drops `aspect-ratio: 1`, fails this test.
  describe('the board edge derives from --board-size (Task 1)', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/Board/board.css'), 'utf8')
    const boardRule = css.match(/\.board\s*\{[^}]*\}/)?.[0]
    const frameRule = css.match(/\.board-frame\s*\{[^}]*\}/)?.[0]

    test('.board is forced square by aspect-ratio: 1, at whatever width its column resolves to', () => {
      expect(boardRule).toMatch(/aspect-ratio:\s*1;/)
      // 100% of the grid column .board-frame hands it — never a fixed px width.
      expect(boardRule).toMatch(/width:\s*100%;/)
    })

    test('.board-frame reads var(--board-size, 640px), not a bare 640px', () => {
      expect(frameRule).toMatch(
        /width:\s*min\(100%,\s*calc\(var\(--board-size,\s*640px\)\s*\+\s*var\(--coord-gutter\)\)\)/,
      )
    })

    test('the board edge is square and scales 1:1 with three injected --board-size values', () => {
      // Mirrors the pinned .board-frame formula above (frame width =
      // board-size + coord-gutter) and .board's own column (the frame's
      // width minus that same coord-gutter — see board.css's grid-template-
      // columns: `var(--coord-gutter) minmax(0, 1fr)`): so the rendered
      // edge is exactly the injected --board-size, for any value.
      const coordGutterPx = 20 // 1.25rem at the (unoverridden) 16px root font-size
      const boardFrameWidth = (boardSize: number) => boardSize + coordGutterPx
      const edgesForInjectedSizes = [360, 500, 640].map((boardSize) => {
        const edge = boardFrameWidth(boardSize) - coordGutterPx
        // Square on both axes: `edge` is the one width value that both
        // .board's width AND (via aspect-ratio: 1, pinned above) its height
        // resolve to — there is no separate height formula to drift from it.
        expect(edge).toBe(boardSize)
        return edge
      })
      // The three injected values actually produce three different edges —
      // proving the derivation is live, not silently clamped to one number.
      expect(new Set(edgesForInjectedSizes).size).toBe(3)
    })
  })
})
