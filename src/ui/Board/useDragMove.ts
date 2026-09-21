import { useRef, useState } from 'react'
import type { Position } from '../../game-core/position'
import type { Square } from '../../game-core/types'

/** Pixels the pointer must travel before we treat the gesture as a drag. */
const DRAG_THRESHOLD_PX = 6

export interface DragState {
  from: Square
  /** Viewport coordinates of the dragged piece's centre. */
  x: number
  y: number
}

export function exceedsDragThreshold(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD_PX
}

/** Walk up from the event target to the square that owns it. */
export function squareFromElement(el: Element | null): Square | null {
  const found = el?.closest('[data-square]')
  const name = found?.getAttribute('data-square')
  return (name as Square | undefined) ?? null
}

export function useDragMove({
  position,
  enabled,
  onDrop,
}: {
  position: Position
  enabled: boolean
  onDrop: (intent: { from: Square; to: Square }) => void
}): {
  drag: DragState | null
  /** True immediately after a drag, so Board can swallow the trailing click. */
  consumeSuppressedClick: () => boolean
  onPointerDown: (e: React.PointerEvent) => void
} {
  const [drag, setDrag] = useState<DragState | null>(null)
  const suppressClick = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return
    const from = squareFromElement(e.target as Element)
    if (!from) return
    // Only start a drag from a square that can actually move.
    if (position.legalMovesFrom(from).length === 0) return

    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      if (!dragging && exceedsDragThreshold(start, { x: ev.clientX, y: ev.clientY })) {
        dragging = true
      }
      if (dragging) setDrag({ from, x: ev.clientX, y: ev.clientY })
    }

    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      setDrag(null)
      if (!dragging) return // a plain click: leave it to the selection reducer

      suppressClick.current = true
      const to = squareFromElement(
        document.elementFromPoint(ev.clientX, ev.clientY),
      )
      if (to && to !== from) onDrop({ from, to })
    }

    target.addEventListener('pointermove', move as EventListener)
    target.addEventListener('pointerup', up as EventListener)
  }

  const consumeSuppressedClick = () => {
    const was = suppressClick.current
    suppressClick.current = false
    return was
  }

  return { drag, consumeSuppressedClick, onPointerDown }
}
