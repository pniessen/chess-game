import { principalLine, uciToIntent, type EngineInfo } from '../engine/uci'
import type { Position } from '../game-core/position'
import type { PieceSymbol, Square } from '../game-core/types'

/** Budget for the hint's analysis: full strength, bounded wait. */
export const HINT_BUDGET = { depth: 12, moveTimeMs: 500, multiPv: 1 } as const

export type HintStage = 0 | 1 | 2 | 3

export interface HintSuggestion {
  /** The position the suggestion is for. */
  fen: string
  from: Square
  to: Square
  san: string
  piece: PieceSymbol
  lines: readonly EngineInfo[]
}

/** The one piece-name table: shared by the hint nudge and the templated coach text. */
export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/** The engine's best move as a checked, displayable suggestion; null if it is unusable. */
export function suggestionFrom(lines: readonly EngineInfo[], position: Position): HintSuggestion | null {
  const uci = principalLine(lines)?.pv[0]
  const intent = uci ? uciToIntent(uci) : null
  if (!intent) return null
  const probe = position.clone()
  const played = probe.tryMove(intent)
  if (!played.ok) return null
  return {
    fen: position.fen(),
    from: played.move.from,
    to: played.move.to,
    san: played.move.san,
    piece: played.move.piece,
    lines,
  }
}

export function nudgeText(piece: PieceSymbol): string {
  return `Look at your ${PIECE_NAME[piece]}.`
}
