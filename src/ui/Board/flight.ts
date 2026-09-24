import type { Color, PieceSymbol, PlayedMove, Square } from '../../game-core/types'
import { pieceCode } from '../pieceSets'

/**
 * The geometry of ONE move, worked out from the move record and the two
 * board layouts it sits between. Pure: no React, no DOM, no chess engine.
 *
 * Nothing here decides *whether* to animate a transition (that is
 * useMoveFlight's job) — but `flightFor` does refuse any transition whose
 * two layouts are not exactly "the position before this move" and "the
 * position after it". That refusal is the safety net under the whole
 * feature: a new game, an import, a replay or a jump that is not one ply
 * forward can never be mistaken for a move and mis-animated.
 */

export interface PieceOnSquare {
  color: Color
  type: PieceSymbol
}

/** square -> piece, as Board builds it from `position.board()`. */
export type PieceMap = ReadonlyMap<Square, PieceOnSquare>

export interface Flyer {
  /** Stable for the life of one flight, so React never remounts it mid-air. */
  key: string
  /** A piece code as Piece.tsx renders it (wP, bQ, …). */
  code: string
  /** Where the flyer starts. */
  from: Square
  /** Where it ends; the same square as `from` for a piece being captured. */
  to: Square
  kind: 'mover' | 'captured'
}

export interface Flight {
  flyers: Flyer[]
  /**
   * Squares whose REAL piece must stay invisible until the flight lands —
   * its stand-in is in the air. Always the destination squares only, so
   * nothing that is not moving can ever be hidden by an animation.
   */
  arriving: Square[]
}

/** Where the rook comes from and goes to, keyed by the king's destination. */
const CASTLE_ROOK: Partial<Record<Square, { from: Square; to: Square }>> = {
  g1: { from: 'h1', to: 'f1' },
  c1: { from: 'a1', to: 'd1' },
  g8: { from: 'h8', to: 'f8' },
  c8: { from: 'a8', to: 'd8' },
}

function same(a: PieceOnSquare | undefined, b: PieceOnSquare | undefined): boolean {
  if (!a || !b) return a === b
  return a.color === b.color && a.type === b.type
}

/** Every square whose occupant differs between the two layouts. */
export function changedSquares(before: PieceMap, after: PieceMap): Set<Square> {
  const out = new Set<Square>()
  for (const [square, piece] of before) {
    if (!same(piece, after.get(square))) out.add(square)
  }
  for (const square of after.keys()) {
    if (!before.has(square)) out.add(square)
  }
  return out
}

/** The square the captured piece stands on (not `to` for en passant). */
export function capturedSquare(move: PlayedMove): Square | null {
  if (!move.isCapture) return null
  if (!move.isEnPassant) return move.to
  return `${move.to[0]}${move.from[1]}` as Square
}

/**
 * The flight for `move`, or null when `before`/`after` are not exactly the
 * layouts either side of it — in which case the caller must cut.
 */
export function flightFor(move: PlayedMove, before: PieceMap, after: PieceMap): Flight | null {
  const moved = before.get(move.from)
  if (!moved || moved.color !== move.color || moved.type !== move.piece) return null

  const landed = after.get(move.to)
  if (!landed || landed.color !== move.color || landed.type !== (move.promotion ?? move.piece)) return null

  // Every square this move is allowed to have changed. Anything else that
  // differs means these are not consecutive positions.
  const touched = new Set<Square>([move.from, move.to])

  const captured = capturedSquare(move)
  let capturedPiece: PieceOnSquare | undefined
  if (captured !== null) {
    capturedPiece = before.get(captured)
    if (!capturedPiece || capturedPiece.color === move.color || capturedPiece.type !== move.captured) return null
    touched.add(captured)
  }

  let rook: { from: Square; to: Square } | undefined
  if (move.isCastle) {
    rook = CASTLE_ROOK[move.to]
    if (!rook) return null
    const rookBefore = before.get(rook.from)
    const rookAfter = after.get(rook.to)
    if (!rookBefore || rookBefore.color !== move.color || rookBefore.type !== 'r') return null
    if (!rookAfter || rookAfter.color !== move.color || rookAfter.type !== 'r') return null
    touched.add(rook.from)
    touched.add(rook.to)
  }

  const changed = changedSquares(before, after)
  if (changed.size !== touched.size) return null
  for (const square of changed) {
    if (!touched.has(square)) return null
  }
  // The squares the move empties must actually be empty afterwards.
  if (after.has(move.from)) return null
  if (rook && after.has(rook.from)) return null
  if (captured !== null && captured !== move.to && after.has(captured)) return null

  const flyers: Flyer[] = []
  // The captured piece goes first so it paints UNDER the piece arriving
  // on top of it.
  if (captured !== null && capturedPiece) {
    flyers.push({
      key: `captured-${captured}`,
      code: pieceCode(capturedPiece.color, capturedPiece.type),
      from: captured,
      to: captured,
      kind: 'captured',
    })
  }
  // `move.piece` (not the promotion) — a promotion slides the pawn and
  // swaps to the new piece when it lands.
  flyers.push({
    key: `mover-${move.from}-${move.to}`,
    code: pieceCode(move.color, move.piece),
    from: move.from,
    to: move.to,
    kind: 'mover',
  })
  const arriving: Square[] = [move.to]
  if (rook) {
    flyers.push({
      key: `mover-${rook.from}-${rook.to}`,
      code: pieceCode(move.color, 'r'),
      from: rook.from,
      to: rook.to,
      kind: 'mover',
    })
    arriving.push(rook.to)
  }

  return { flyers, arriving }
}
