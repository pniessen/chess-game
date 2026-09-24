import { useEffect, useRef, useState } from 'react'
import type { Position } from '../../game-core/position'
import type { Square } from '../../game-core/types'

/** Pixels the pointer must travel before we treat the gesture as a drag. */
const DRAG_THRESHOLD_PX = 6

/**
 * How long an illegal drop's ghost takes to slide back to its origin square
 * before disappearing. Kept in step with `--drag-snap-ms` in board.css (see
 * durations.test.ts) — the CSS plays the transition, this clears the state
 * that carries it once it has arrived.
 */
export const SNAP_BACK_MS = 160

export interface DragState {
  from: Square
  /** Viewport coordinates the ghost is drawn at — the pointer while
   *  dragging, or the origin square's centre while returning. */
  x: number
  y: number
  /** Side length of the dragged piece's square, in px (measured once at
   *  drag start — the board does not resize mid-gesture). */
  size: number
  /** The square under the pointer right now, for the target ring. Null off
   *  the board, and always null while returning (the ring is drag-only). */
  over: Square | null
  /** 'dragging' while the pointer is down and moving; 'returning' while an
   *  illegal drop's ghost is sliding back to `from` before it disappears. */
  phase: 'dragging' | 'returning'
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

/**
 * Whether `to` is a legal destination for the piece on `from` — used only
 * to decide the drag GHOST's fate (an instant handoff to the move
 * animation vs. a snap-back). The move itself is still decided by
 * `reduceSelection`, via the two synthesized clicks `onDrop` replays, so
 * this must never gate `onDrop` — it only predicts what that reducer is
 * about to do, so the right ghost animation can start in the same frame.
 */
export function isLegalDrop(position: Position, from: Square, to: Square | null): boolean {
  return to !== null && to !== from && position.legalMovesFrom(from).some((m) => m.to === to)
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
  const returnTimer = useRef<number | null>(null)

  // If the component unmounts while a snap-back is in flight, nothing must
  // be left running — the same contract useMoveFlight's timer keeps.
  useEffect(
    () => () => {
      if (returnTimer.current !== null) window.clearTimeout(returnTimer.current)
    },
    [],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    // A flag stranded true by a previous gesture (e.g. a drag released off
    // the board, which never produces a click to consume it) must never
    // survive into a new gesture and eat an unrelated click.
    suppressClick.current = false
    // Likewise, a snap-back still in flight from a previous gesture must
    // never reach into THIS one and clear its drag state early.
    if (returnTimer.current !== null) {
      window.clearTimeout(returnTimer.current)
      returnTimer.current = null
    }

    if (!enabled || e.button !== 0) return
    const from = squareFromElement(e.target as Element)
    if (!from) return
    // Only start a drag from a square that can actually move.
    if (position.legalMovesFrom(from).length === 0) return

    // Measured once, at the start: the board does not resize mid-gesture,
    // and this doubles as both the ghost's fixed size and the point a
    // snap-back returns to.
    const squareEl = (e.target as Element).closest('[data-square]')
    const rect = squareEl?.getBoundingClientRect()
    const size = rect?.width ?? 0
    const originX = rect ? rect.left + rect.width / 2 : e.clientX
    const originY = rect ? rect.top + rect.height / 2 : e.clientY

    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const pointerId = e.pointerId
    const target = e.currentTarget as Element

    // The gesture-scoped teardown (capture + listeners) shared by every
    // exit path. Clearing the drag STATE is a separate step (see cleanup
    // below) so an illegal drop can detach the gesture immediately while
    // still keeping the ghost mounted for its snap-back.
    const detach = () => {
      try {
        // Per spec this should already no-op for an already-released (or
        // never-captured) pointer, but guard defensively so a throw here
        // can never abort the rest of teardown.
        target.releasePointerCapture(pointerId)
      } catch {
        // already released, or never captured — nothing to do.
      }
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      target.removeEventListener('pointercancel', cancel as EventListener)
    }

    // Shared by the pointerup and pointercancel paths so they cannot drift
    // apart — both must release capture, tear down every listener (this one
    // included), and clear drag state. Only pointerup goes on to decide
    // whether a drop happened; pointercancel never calls onDrop and never
    // touches the suppression flag, since no move occurred.
    const cleanup = () => {
      detach()
      if (returnTimer.current !== null) {
        window.clearTimeout(returnTimer.current)
        returnTimer.current = null
      }
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
      if (dragging) {
        // pointer-events: none on the ghost (board.css) is load-bearing
        // here exactly as it is for useDragMove's other elementFromPoint
        // call in `up`: this must see straight through the ghost to the
        // square underneath, or a drag would perpetually target itself.
        const over = squareFromElement(document.elementFromPoint(ev.clientX, ev.clientY))
        setDrag({ from, x: ev.clientX, y: ev.clientY, size, over, phase: 'dragging' })
      }
    }

    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return // a second, uncaptured pointer
      if (!dragging) {
        cleanup()
        return // a plain click: leave it to the selection reducer
      }

      const to = squareFromElement(document.elementFromPoint(ev.clientX, ev.clientY))
      if (shouldSuppressClick(to)) suppressClick.current = true

      const droppedOnSquare = to !== null && to !== from
      if (droppedOnSquare && !isLegalDrop(position, from, to)) {
        // The gesture is over — release capture and listeners now — but
        // keep the ghost mounted a little longer so an illegal drop is seen
        // sliding back to its origin instead of vanishing.
        detach()
        setDrag({ from, x: originX, y: originY, size, over: null, phase: 'returning' })
        returnTimer.current = window.setTimeout(() => {
          returnTimer.current = null
          setDrag(null)
        }, SNAP_BACK_MS)
      } else {
        // A legal drop (the move animation takes over from here), a drop
        // back on the origin square, or a release off the board — none of
        // these need the ghost to animate; it simply disappears.
        cleanup()
      }

      if (droppedOnSquare) onDrop({ from, to })
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
