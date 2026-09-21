import { useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Position } from '../../game-core/position'
import type { Color, PieceSymbol, Square as SquareName } from '../../game-core/types'
import type { Annotation } from './annotations'
import { BoardOverlay } from './BoardOverlay'
import { Piece } from './Piece'
import { Square } from './Square'
import { filesInOrder, ranksInOrder, squaresInOrder } from './squares'
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
  annotations = [],
}: {
  position: Position
  orientation: 'white' | 'black'
  highlights: Highlights
  onSquareClick: (square: SquareName) => void
  /** Extra pointer-down observer, called alongside Board's own drag handling. */
  onPointerDown?: (e: React.PointerEvent) => void
  /** Overrides which square shows the "dragging" fade; defaults to the hook's own drag state. */
  dragging?: SquareName | null
  /** Square highlights and arrows drawn above the pieces (hints, review). */
  annotations?: readonly Annotation[]
}) {
  // A real two-click sequence works because each click is its own React
  // event: App's onSquareClick closure re-created with fresh `selection`
  // state between the two. Calling it twice back-to-back in a single
  // synchronous callback (as a drop naturally does) does not get that
  // in-between render for free — both calls would otherwise see the same
  // stale `selection` and the second click-away's "select from, then move to"
  // logic would never see `from` as selected. onSquareClickRef always holds
  // the prop from the latest render, and flushSync forces that render to
  // happen synchronously after the first call, so the second call reads the
  // post-selection closure exactly as a real second click would.
  const onSquareClickRef = useRef(onSquareClick)
  onSquareClickRef.current = onSquareClick

  // Board owns drag-and-drop itself so click-to-move and drag-to-move share
  // one entry point: onSquareClick. A drop is routed as square-clicked(from)
  // then square-clicked(to) — the exact two events a click sequence would
  // produce — so whatever onSquareClick does (including raising the
  // promotion picker via reduceSelection) runs unchanged for a drag.
  const { drag, consumeSuppressedClick, onPointerDown: dragPointerDown } = useDragMove({
    position,
    enabled: true,
    onDrop: ({ from, to }) => {
      flushSync(() => onSquareClickRef.current(from))
      flushSync(() => onSquareClickRef.current(to))
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
    <div className={`board-frame ${orientation}`} data-testid="board-frame">
      {/* Coordinates live OUTSIDE the grid: they are page text, not square
          content, so they stay readable in every theme and never sit under a
          piece. aria-hidden because every square already has aria-label. */}
      <div className="coords coords-ranks" aria-hidden="true">
        {ranksInOrder(orientation).map((r) => (
          <span key={r} className="coord-label" data-testid={`coord-rank-${r}`}>
            {r}
          </span>
        ))}
      </div>
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
          return (
            <Square key={name} name={name} classes={classes} onClick={handleSquareClick}>
              {piece ? <Piece color={piece.color} type={piece.type} /> : null}
            </Square>
          )
        })}
        <BoardOverlay annotations={annotations} orientation={orientation} />
      </div>
      <div className="coords coords-files" aria-hidden="true">
        {filesInOrder(orientation).map((f) => (
          <span key={f} className="coord-label" data-testid={`coord-file-${f}`}>
            {f}
          </span>
        ))}
      </div>
    </div>
  )
}
