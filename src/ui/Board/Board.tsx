import type { Position } from '../../game-core/position'
import type { Color, PieceSymbol, Square as SquareName } from '../../game-core/types'
import { Piece } from './Piece'
import { Square } from './Square'
import { squaresInOrder } from './squares'
import { useDragMove } from './useDragMove'
import './board.css'

export interface Highlights {
  selected?: SquareName
  legal?: SquareName[]
  captures?: SquareName[]
  lastMove?: [SquareName, SquareName]
  check?: SquareName
}

export function Board({
  position,
  orientation,
  highlights,
  onSquareClick,
  onPointerDown,
  dragging,
}: {
  position: Position
  orientation: 'white' | 'black'
  highlights: Highlights
  onSquareClick: (square: SquareName) => void
  /** Extra pointer-down observer, called alongside Board's own drag handling. */
  onPointerDown?: (e: React.PointerEvent) => void
  /** Overrides which square shows the "dragging" fade; defaults to the hook's own drag state. */
  dragging?: SquareName | null
}) {
  // Board owns drag-and-drop itself so click-to-move and drag-to-move share
  // one entry point: onSquareClick. A drop is routed as square-clicked(from)
  // then square-clicked(to) — the exact two events a click sequence would
  // produce — so whatever onSquareClick does (including raising the
  // promotion picker via reduceSelection) runs unchanged for a drag.
  const { drag, consumeSuppressedClick, onPointerDown: dragPointerDown } = useDragMove({
    position,
    enabled: true,
    onDrop: ({ from, to }) => {
      onSquareClick(from)
      onSquareClick(to)
    },
  })

  const handlePointerDown = (e: React.PointerEvent) => {
    dragPointerDown(e)
    onPointerDown?.(e)
  }

  // The click that ends a completed drag must not also reach the selection
  // reducer — otherwise the drop lands the move and the trailing click
  // immediately re-selects or deselects the destination square.
  const handleSquareClick = (square: SquareName) => {
    if (consumeSuppressedClick()) return
    onSquareClick(square)
  }

  const draggingSquare = dragging ?? drag?.from ?? null

  // board() is rank-8-first; flatten it into a square -> piece lookup.
  const pieces = new Map<SquareName, { color: Color; type: PieceSymbol }>()
  for (const row of position.board()) {
    for (const cell of row) {
      if (cell) pieces.set(cell.square, { color: cell.color, type: cell.type })
    }
  }

  const legal = new Set(highlights.legal ?? [])
  const captures = new Set(highlights.captures ?? [])

  return (
    <div
      className={`board ${orientation}`}
      role="grid"
      aria-label="Chess board"
      onPointerDown={handlePointerDown}
    >
      {squaresInOrder(orientation).map((name) => {
        const classes: string[] = []
        if (highlights.selected === name) classes.push('selected')
        if (legal.has(name)) classes.push('legal')
        if (captures.has(name)) classes.push('capture')
        if (highlights.lastMove?.includes(name)) classes.push('last-move')
        if (highlights.check === name) classes.push('check')
        if (draggingSquare === name) classes.push('dragging')
        const piece = pieces.get(name)
        // Coordinates sit on the two edges nearest the viewer, so they flip
        // with the board: files along the bottom rank, ranks up the left file.
        const file = name[0]
        const rank = name[1]
        const bottomRank = orientation === 'white' ? '1' : '8'
        const leftFile = orientation === 'white' ? 'a' : 'h'
        return (
          <Square
            key={name}
            name={name}
            classes={classes}
            onClick={handleSquareClick}
            {...(rank === bottomRank ? { fileLabel: file } : {})}
            {...(file === leftFile ? { rankLabel: rank } : {})}
          >
            {piece ? <Piece color={piece.color} type={piece.type} /> : null}
          </Square>
        )
      })}
    </div>
  )
}
