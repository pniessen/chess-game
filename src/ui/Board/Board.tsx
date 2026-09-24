import type { CSSProperties } from 'react'
import { useRef } from 'react'
import { flushSync } from 'react-dom'
import type { Position } from '../../game-core/position'
import type { Color, PieceSymbol, PlayedMove, Square as SquareName } from '../../game-core/types'
import type { Annotation } from './annotations'
import { BoardOverlay } from './BoardOverlay'
import { DragLayer } from './DragLayer'
import { FlightLayer } from './FlightLayer'
import { LastMoveArrow } from './LastMoveArrow'
import { Piece } from './Piece'
import { Square } from './Square'
import { filesInOrder, ranksInOrder, squaresInOrder } from './squares'
import { useDragMove } from './useDragMove'
import { useMoveFlight } from './useMoveFlight'
import { boardTheme } from '../themes'
import { pieceCode } from '../pieceSets'
import './board.css'

export interface Highlights {
  selected?: SquareName
  legal?: SquareName[]
  captures?: SquareName[]
  lastMove?: [SquareName, SquareName]
  check?: SquareName
  /** The displayed position is checkmate (the king on `check` is the mated one). */
  checkmate?: boolean
}

export function Board({
  position,
  orientation,
  highlights,
  onSquareClick,
  onPointerDown,
  dragging,
  annotations = [],
  theme = 'classic',
  pieceSet = 'rhosgfx',
  lastPlayed = null,
  cutKey = 0,
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
  /** Board colour theme id (see themes.ts); unknown ids fall back to classic. */
  theme?: string
  /** Piece set id (see pieceSets.ts); unknown ids fall back to Rhosgfx. */
  pieceSet?: string
  /**
   * The move that produced `position`. When the previously rendered
   * position is exactly the one before it, the board slides the pieces into
   * place; anything else is drawn instantly. Purely cosmetic — the position
   * prop alone decides what is on the board.
   */
  lastPlayed?: PlayedMove | null
  /**
   * Bump this to make the next position change cut rather than animate:
   * history browsing, undo and redo all land on a position that can look
   * exactly like "one move later" (see useMoveFlight).
   */
  cutKey?: unknown
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

  const flight = useMoveFlight({ fen: position.fen(), pieces, orientation, lastPlayed, cutKey })
  const arriving = new Set(flight?.arriving ?? [])

  // The piece under the drag ghost — still on `from` in `pieces`, since no
  // move has happened yet (a legal drop clears `drag` in the very same
  // commit the new position arrives in; see useDragMove's `up`).
  const dragPiece = drag ? pieces.get(drag.from) : undefined

  return (
    <div
      className={`board-frame ${orientation}`}
      data-testid="board-frame"
      data-board-theme={boardTheme(theme).id}
      style={{ '--sq-light': boardTheme(theme).light, '--sq-dark': boardTheme(theme).dark } as CSSProperties}
    >
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
        className={`board ${orientation}${highlights.checkmate ? ' checkmate-shake' : ''}`}
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
          if (highlights.check === name && highlights.checkmate) classes.push('mated')
          if (draggingSquare === name) classes.push('dragging')
          if (arriving.has(name)) classes.push('arriving')
          if (drag?.over === name) classes.push('drag-target')
          const piece = pieces.get(name)
          return (
            <Square key={name} name={name} classes={classes} onClick={handleSquareClick}>
              {/* Keyed by piece so a square whose occupant changes (a
                  capture) gets a fresh <img>, and so restarts the
                  "wait, then appear" animation of an arrival. */}
              {piece ? (
                <Piece
                  key={`${piece.color}${piece.type}`}
                  color={piece.color}
                  type={piece.type}
                  pieceSet={pieceSet}
                />
              ) : null}
            </Square>
          )
        })}
        {highlights.lastMove ? (
          <LastMoveArrow from={highlights.lastMove[0]} to={highlights.lastMove[1]} orientation={orientation} />
        ) : null}
        <BoardOverlay annotations={annotations} orientation={orientation} />
        {flight ? <FlightLayer flight={flight} orientation={orientation} pieceSet={pieceSet} /> : null}
        {drag && dragPiece ? (
          <DragLayer
            drag={drag}
            code={pieceCode(dragPiece.color, dragPiece.type)}
            pieceSet={pieceSet}
          />
        ) : null}
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
