import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LastMoveArrow } from './LastMoveArrow'
import { arrowLine } from './annotations'

describe('LastMoveArrow', () => {
  test('draws one arrow, geometrically identical to annotations.arrowLine, tagged with from/to', () => {
    const { container } = render(<LastMoveArrow from="e2" to="e4" orientation="white" />)
    const svg = container.querySelector('[data-testid="last-move-arrow"]')
    expect(svg?.getAttribute('data-from')).toBe('e2')
    expect(svg?.getAttribute('data-to')).toBe('e4')

    const l = arrowLine('e2', 'e4', 'white')
    const line = container.querySelector('.last-move-arrow-line')
    expect(line?.getAttribute('x1')).toBe(String(l.x1))
    expect(line?.getAttribute('y1')).toBe(String(l.y1))
    expect(line?.getAttribute('x2')).toBe(String(l.x2))
    expect(line?.getAttribute('y2')).toBe(String(l.y2))
  })

  test('flips with the board, exactly as annotation arrows do', () => {
    const { container } = render(<LastMoveArrow from="e2" to="e4" orientation="black" />)
    const l = arrowLine('e2', 'e4', 'black')
    const line = container.querySelector('.last-move-arrow-line')
    expect(line?.getAttribute('y1')).toBe(String(l.y1))
    expect(line?.getAttribute('y2')).toBe(String(l.y2))
  })

  test('is distinct from a hint annotation: its own class, its own marker id, no data-annotation/data-tone', () => {
    const { container } = render(<LastMoveArrow from="g1" to="f3" orientation="white" />)
    expect(container.querySelector('[data-annotation]')).toBeNull()
    expect(container.querySelector('[data-tone]')).toBeNull()
    expect(container.querySelector('.last-move-arrow-line')?.getAttribute('marker-end')).toBe(
      'url(#last-move-arrowhead)',
    )
    // A darker edge line underneath the brass shaft (see board.css) — the
    // contrast fix, not a visible duplicate arrow.
    expect(container.querySelectorAll('line')).toHaveLength(2)
  })
})
