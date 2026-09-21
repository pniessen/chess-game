import type { Position } from '../../game-core/position'
import type { MoveIntent, PieceSymbol, Square } from '../../game-core/types'

export type SelectionState =
  | { kind: 'idle' }
  | { kind: 'selected'; square: Square }
  | { kind: 'awaiting-promotion'; from: Square; to: Square }

export type SelectionEvent =
  | { kind: 'square-clicked'; square: Square }
  | { kind: 'promotion-chosen'; piece: PieceSymbol }
  | { kind: 'cancel' }

export interface SelectionOutcome {
  state: SelectionState
  /** Present only when a complete, legal move has been assembled. */
  move?: MoveIntent
}

const IDLE: SelectionState = { kind: 'idle' }

function holdsOwnPiece(position: Position, square: Square): boolean {
  return position.legalMovesFrom(square).length > 0
}

export function reduceSelection(
  state: SelectionState,
  event: SelectionEvent,
  position: Position,
): SelectionOutcome {
  if (event.kind === 'cancel') return { state: IDLE }

  if (state.kind === 'awaiting-promotion') {
    if (event.kind === 'promotion-chosen') {
      return {
        state: IDLE,
        move: { from: state.from, to: state.to, promotion: event.piece },
      }
    }
    // Any click while the picker is open cancels the whole move.
    return { state: IDLE }
  }

  if (event.kind !== 'square-clicked') return { state }
  const clicked = event.square

  if (state.kind === 'idle') {
    return holdsOwnPiece(position, clicked)
      ? { state: { kind: 'selected', square: clicked } }
      : { state: IDLE }
  }

  // state.kind === 'selected'
  if (clicked === state.square) return { state: IDLE }

  const legal = position.legalMovesFrom(state.square).filter((m) => m.to === clicked)
  if (legal.length === 0) {
    // Re-select if they clicked another of their own pieces; otherwise drop.
    return holdsOwnPiece(position, clicked)
      ? { state: { kind: 'selected', square: clicked } }
      : { state: IDLE }
  }

  if (position.isPromotion(state.square, clicked)) {
    return { state: { kind: 'awaiting-promotion', from: state.square, to: clicked } }
  }

  return { state: IDLE, move: { from: state.square, to: clicked } }
}
