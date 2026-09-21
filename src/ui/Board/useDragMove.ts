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

/**
 * Whether a drag ending here should suppress the trailing synthesized
 * `click`. `setPointerCapture` redirects pointer events but not `click`,
 * which is hit-tested at the release point — so a click only ever follows
 * when the release actually landed on a square. Releasing off the board
 * (a natural "cancel this drag" gesture) produces no click, and so must not
 * set the suppression flag, or it strands `true` and eats the next real
 * click-to-move.
 */
export function shouldSuppressClick(landedOn: Square | null): boolean {
  return landedOn !== null
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
    // A flag stranded true by a previous gesture (e.g. a drag released off
    // the board, which never produces a click to consume it) must never
    // survive into a new gesture and eat an unrelated click.
    suppressClick.current = false

    if (!enabled || e.button !== 0) return
    const from = squareFromElement(e.target as Element)
    if (!from) return
    // Only start a drag from a square that can actually move.
    if (position.legalMovesFrom(from).length === 0) return

    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const pointerId = e.pointerId
    const target = e.currentTarget as Element

    // Shared by the pointerup and pointercancel paths so they cannot drift
    // apart — both must release capture, tear down every listener (this one
    // included), and clear drag state. Only pointerup goes on to decide
    // whether a drop happened; pointercancel never calls onDrop and never
    // touches the suppression flag, since no move occurred.
    const cleanup = () => {
      try {
        // Per spec this should already no-op for an already-released (or
        // never-captured) pointer, but guard defensively so a throw here
        // can never abort the rest of cleanup.
        target.releasePointerCapture(pointerId)
      } catch {
        // already released, or never captured — nothing to do.
      }
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      target.removeEventListener('pointercancel', cancel as EventListener)
      setDrag(null)
    }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return // a second, uncaptured pointer
      if (!dragging && exceedsDragThreshold(start, { x: ev.clientX, y: ev.clientY })) {
        dragging = true
        // Only take capture once the gesture is confirmed to be a drag. A
        // plain click never reaches this branch, so it never triggers
        // capture — and so the synthesized `click` that follows a plain
        // click is never retargeted away from the square that was clicked.
        try {
          target.setPointerCapture(pointerId)
        } catch {
          // Pointer may already be gone (e.g. released mid-gesture) —
          // cleanup's releasePointerCapture is similarly defensive.
        }
      }
      if (dragging) setDrag({ from, x: ev.clientX, y: ev.clientY })
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return // a second, uncaptured pointer
      cleanup()
      if (!dragging) return // a plain click: leave it to the selection reducer

      const to = squareFromElement(
        document.elementFromPoint(ev.clientX, ev.clientY),
      )
      if (shouldSuppressClick(to)) suppressClick.current = true
      if (to && to !== from) onDrop({ from, to })
    }

    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return // a second, uncaptured pointer
      // A system gesture interrupted the touch: clean up exactly like a
      // pointerup would, but no drop happened and no click will follow.
      cleanup()
    }

    target.addEventListener('pointermove', move as EventListener)
    target.addEventListener('pointerup', up as EventListener)
    target.addEventListener('pointercancel', cancel as EventListener)
  }

  const consumeSuppressedClick = () => {
    const was = suppressClick.current
    suppressClick.current = false
    return was
  }

  return { drag, consumeSuppressedClick, onPointerDown }
}
