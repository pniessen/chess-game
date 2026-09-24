import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { DragLayer, DRAG_LIFT_SCALE } from './DragLayer'
import type { DragState } from './useDragMove'

const dragging: DragState = { from: 'e2', x: 120, y: 80, size: 64, over: 'e4', phase: 'dragging' }
const returning: DragState = { from: 'e2', x: 100, y: 60, size: 64, over: null, phase: 'returning' }

describe('DragLayer', () => {
  test('sizes and positions the ghost from drag.x/y/size, centred on the pointer', () => {
    const { getByTestId } = render(<DragLayer drag={dragging} code="wP" pieceSet="rhosgfx" />)
    const ghost = getByTestId('drag-ghost')
    expect(ghost.style.width).toBe('64px')
    expect(ghost.style.height).toBe('64px')
    // Centred: top-left offset by half the size in each axis.
    expect(ghost.style.transform).toContain('translate(88px, 48px)')
  })

  test('lifts (scales up) while actively dragging', () => {
    const { getByTestId } = render(<DragLayer drag={dragging} code="wP" pieceSet="rhosgfx" />)
    expect(getByTestId('drag-ghost').style.transform).toContain(`scale(${DRAG_LIFT_SCALE})`)
  })

  test('un-lifts (scale 1) while returning', () => {
    const { getByTestId } = render(<DragLayer drag={returning} code="wP" pieceSet="rhosgfx" />)
    expect(getByTestId('drag-ghost').style.transform).toContain('scale(1)')
  })

  test('carries the phase as a class and a data attribute, for CSS and tests alike', () => {
    const { getByTestId, rerender } = render(<DragLayer drag={dragging} code="wP" pieceSet="rhosgfx" />)
    expect(getByTestId('drag-ghost').className).toContain('dragging')
    expect(getByTestId('drag-ghost').getAttribute('data-drag-phase')).toBe('dragging')

    rerender(<DragLayer drag={returning} code="wP" pieceSet="rhosgfx" />)
    expect(getByTestId('drag-ghost').className).toContain('returning')
    expect(getByTestId('drag-ghost').getAttribute('data-drag-phase')).toBe('returning')
  })

  test('renders the given piece code as the ghost image, hidden from the accessibility tree', () => {
    const { getByTestId, container } = render(<DragLayer drag={dragging} code="bN" pieceSet="rhosgfx" />)
    expect(getByTestId('drag-ghost').getAttribute('aria-hidden')).toBe('true')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toContain('bN.svg')
    expect(img?.getAttribute('alt')).toBe('')
  })
})
