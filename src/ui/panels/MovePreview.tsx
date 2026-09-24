import { useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { Position } from '../../game-core/position'
import type { Color, PieceSymbol } from '../../game-core/types'
import { Piece } from '../Board/Piece'
import { isLightSquare, squaresInOrder } from '../Board/squares'
import { boardTheme } from '../themes'
// Reuses the main board's chrome (.board/.square: border, radius, checker
// colours, shadow) — see the CSS comment on .move-preview in app.css.
import '../Board/board.css'

/**
 * Fixed popover size, in px — the FULL rendered footprint (border box), not
 * just the content box. It's used two places that both have to agree on
 * what it means: the inline `width` below, and clampToViewport's "does this
 * fit" math. `.move-preview` (app.css) is deliberately `box-sizing:
 * border-box` (this codebase has no global border-box reset to lean on) so
 * that inline width really is the element's whole footprint, padding and
 * border included — without that, the clamp would be checking a number
 * smaller than what's actually on screen, and the real box could sit past
 * the viewport edge by exactly the padding+border it forgot to account for.
 */
export const MOVE_PREVIEW_SIZE = 168
const MARGIN = 8

/** Referenced by both the popover (as its `id`) and the triggering move
 * button (as `aria-describedby`), so a screen reader announces the preview
 * on focus instead of silently doing nothing with an unreferenced tooltip. */
export const MOVE_PREVIEW_ID = 'move-preview-popover'

/**
 * A small, non-interactive board for one FEN. Reuses `.board`/`.square`
 * (board.css) for the chrome (border, radius, checker colours, shadow) and
 * `Piece` for the artwork, so it matches the main board's look without
 * duplicating it — but skips Board.tsx's drag/flight/highlight machinery
 * entirely, since a preview never needs any of that.
 */
function MovePreviewBoard({
  fen,
  orientation,
  theme,
  pieceSet,
}: {
  fen: string
  orientation: 'white' | 'black'
  theme: string
  pieceSet: string
}) {
  // Cheap already (fenAfter is stored on every played move, so this is a
  // single FEN parse, not a replay from the start) — memoised anyway so
  // re-renders while the popover stays open on the same move (e.g. a
  // parent re-render from unrelated state) don't reparse it.
  const pieces = useMemo(() => {
    const position = new Position(fen)
    const out = new Map<string, { color: Color; type: PieceSymbol }>()
    for (const row of position.board()) {
      for (const cell of row) {
        if (cell) out.set(cell.square, { color: cell.color, type: cell.type })
      }
    }
    return out
  }, [fen])

  const t = boardTheme(theme)

  return (
    <div
      className="board move-preview-board"
      style={{ '--sq-light': t.light, '--sq-dark': t.dark } as CSSProperties}
    >
      {squaresInOrder(orientation).map((name) => {
        const piece = pieces.get(name)
        return (
          <div key={name} className={`square ${isLightSquare(name) ? 'light' : 'dark'}`}>
            {piece ? <Piece color={piece.color} type={piece.type} pieceSet={pieceSet} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function clampToViewport(anchor: DOMRect): { top: number; left: number } {
  let left = anchor.right + MARGIN
  if (left + MOVE_PREVIEW_SIZE > window.innerWidth - MARGIN) {
    left = anchor.left - MARGIN - MOVE_PREVIEW_SIZE
  }
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, window.innerWidth - MOVE_PREVIEW_SIZE - MARGIN))

  let top = anchor.top
  top = Math.min(top, Math.max(MARGIN, window.innerHeight - MOVE_PREVIEW_SIZE - MARGIN))
  top = Math.max(top, MARGIN)

  return { top, left }
}

/**
 * Positions a MovePreviewBoard next to `anchorEl` (the hovered/focused move
 * button), clamped so it never leaves the viewport — flips to the anchor's
 * left when there isn't room on the right, then clamps top/left directly as
 * a last resort on very small viewports. `position: fixed` + a viewport
 * scroll-container escape means the move list's own `overflow-y: auto`
 * never clips it.
 */
export function MovePreviewPopover({
  anchorEl,
  fen,
  san,
  orientation,
  theme,
  pieceSet,
}: {
  anchorEl: HTMLElement | null
  fen: string
  san: string
  orientation: 'white' | 'black'
  theme: string
  pieceSet: string
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null)
      return
    }
    setPos(clampToViewport(anchorEl.getBoundingClientRect()))
  }, [anchorEl, fen])

  if (!pos) return null

  return (
    <div
      id={MOVE_PREVIEW_ID}
      className="move-preview"
      data-testid="move-preview"
      role="tooltip"
      style={{ top: pos.top, left: pos.left, width: MOVE_PREVIEW_SIZE }}
    >
      {/* Visually the board speaks for itself; this is the only text a
          screen reader gets for it. */}
      <span className="sr-only">Position after {san}</span>
      <MovePreviewBoard fen={fen} orientation={orientation} theme={theme} pieceSet={pieceSet} />
    </div>
  )
}
