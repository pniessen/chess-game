import type { Square } from '../../game-core/types'
import { arrowLine } from './annotations'

/**
 * The arrow for the move that produced the displayed position (the same
 * move `.square.last-move` tints) — brass, semi-transparent, drawn UNDER
 * the pieces. That is the opposite of the hint/review overlay
 * (BoardOverlay), which is deliberately drawn OVER pieces; see board.css's
 * "Stacking order (Task 3)" comment for why both exist and how they stay
 * consistent with the flight and drag layers.
 *
 * Reuses BoardOverlay's own geometry (`arrowLine`) so the two arrow kinds
 * agree pixel-for-pixel on where an arrow between two squares sits, and are
 * distinguished only by colour, weight and z-order — never by shape.
 */
export function LastMoveArrow({
  from,
  to,
  orientation,
}: {
  from: Square
  to: Square
  orientation: 'white' | 'black'
}) {
  const l = arrowLine(from, to, orientation)
  return (
    <svg
      className="last-move-layer"
      viewBox="0 0 8 8"
      aria-hidden="true"
      data-testid="last-move-arrow"
      data-from={from}
      data-to={to}
    >
      <defs>
        <marker
          id="last-move-arrowhead"
          viewBox="0 0 4 4"
          refX="2"
          refY="2"
          markerWidth="3.2"
          markerHeight="3.2"
          orient="auto"
        >
          <path d="M0,0 L4,2 L0,4 z" className="last-move-arrowhead" />
        </marker>
      </defs>
      {/* A dark edge underneath the brass shaft: brass alone falls under
          WCAG's 3:1 non-text contrast minimum against every board theme's
          square colours (the same problem `.square.drag-target::before`
          solves the same way — see dragTargetContrast.test.ts).
          lastMoveArrowContrast.test.ts computes this pair's contrast from
          board.css's own rule rather than trusting a hand-checked number. */}
      <line className="last-move-arrow-edge" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      <line
        className="last-move-arrow-line"
        x1={l.x1}
        y1={l.y1}
        x2={l.x2}
        y2={l.y2}
        markerEnd="url(#last-move-arrowhead)"
      />
    </svg>
  )
}
