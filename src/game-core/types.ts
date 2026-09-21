import type { Color, PieceSymbol, Square } from 'chess.js'

export type { Color, PieceSymbol, Square }

/** A plain, cloneable record of a played move. Never a chess.js Move. */
export interface PlayedMove {
  san: string
  from: Square
  to: Square
  piece: PieceSymbol
  color: Color
  captured?: PieceSymbol
  promotion?: PieceSymbol
  /** True for en passant too, unlike chess.js Move.isCapture(). */
  isCapture: boolean
  isCastle: boolean
  isEnPassant: boolean
  fenAfter: string
}

export interface MoveIntent {
  from: Square
  to: Square
  promotion?: PieceSymbol
}

export type MoveResult =
  | { ok: true; move: PlayedMove }
  | { ok: false; reason: 'illegal' | 'game-over' | 'needs-promotion' }

export type DrawReason =
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'

export type GameStatus =
  | { kind: 'in-progress'; inCheck: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason }

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
