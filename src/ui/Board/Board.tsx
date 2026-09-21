import type { Position } from '../../game-core/position'
import type { Color, PieceSymbol, Square as SquareName } from '../../game-core/types'
import { Piece } from './Piece'
import { Square } from './Square'
import { squaresInOrder } from './squares'
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
}: {
  position: Position
  orientation: 'white' | 'black'
  highlights: Highlights
  onSquareClick: (square: SquareName) => void
}) {
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
    <div className={`board ${orientation}`} role="grid" aria-label="Chess board">
      {squaresInOrder(orientation).map((name) => {
        const classes: string[] = []
        if (highlights.selected === name) classes.push('selected')
        if (legal.has(name)) classes.push('legal')
        if (captures.has(name)) classes.push('capture')
        if (highlights.lastMove?.includes(name)) classes.push('last-move')
        if (highlights.check === name) classes.push('check')
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
            onClick={onSquareClick}
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
