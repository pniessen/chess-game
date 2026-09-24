import type { CSSProperties } from 'react'
import { pieceImageSrc } from '../pieceSets'
import type { DragState } from './useDragMove'

/** How much a lifted piece scales up while it is actively being dragged. */
export const DRAG_LIFT_SCALE = 1.12

/**
 * The piece under the pointer during a drag — decoration, exactly like
 * FlightLayer: the real piece stays on its square underneath (faded, via
 * `.square.dragging .piece`), so this layer can disappear at any instant —
 * a completed legal drop (the move animation takes over), an illegal
 * drop's snap-back finishing, or an unmount — and always leave a correct
 * board.
 *
 * Positioned with `position: fixed` in board.css, so `drag.x`/`drag.y`
 * (viewport coordinates, exactly as the pointer events that produced them)
 * can be used directly with no board-relative math. `pointer-events: none`
 * there is load-bearing exactly as it is for FlightLayer and BoardOverlay:
 * useDragMove's own `document.elementFromPoint` calls must see straight
 * through this layer to the squares beneath it, or a drag would
 * perpetually target itself.
 */
export function DragLayer({
  drag,
  code,
  pieceSet,
}: {
  drag: DragState
  /** The piece code (wP, bQ, …) of the piece being dragged. */
  code: string
  pieceSet: string
}) {
  const lifted = drag.phase === 'dragging'
  const scale = lifted ? DRAG_LIFT_SCALE : 1
  return (
    <span
      className={`drag-ghost ${drag.phase}`}
      data-testid="drag-ghost"
      data-drag-phase={drag.phase}
      aria-hidden="true"
      style={
        {
          width: `${drag.size}px`,
          height: `${drag.size}px`,
          // A single inline transform is the one source of truth for the
          // ghost's position AND lift scale — a CSS rule setting transform
          // too would silently lose to (or fight with) this one, so the
          // lift lives here, keyed off `phase`, rather than in board.css.
          transform: `translate(${drag.x - drag.size / 2}px, ${drag.y - drag.size / 2}px) scale(${scale})`,
        } as CSSProperties
      }
    >
      <img className="piece" src={pieceImageSrc(pieceSet, code)} alt="" draggable={false} />
    </span>
  )
}
