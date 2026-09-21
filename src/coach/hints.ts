import { principalLine, uciToIntent, type EngineInfo } from '../engine/uci'
import type { Position } from '../game-core/position'
import type { PieceSymbol, Square } from '../game-core/types'
import { LIMITS, type HintRequest } from './protocol'

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

/** A UCI score (side-to-move relative) in the protocol's text form. */
export function moverScore(info: EngineInfo): string | null {
  if (info.scoreMate !== undefined) {
    return info.scoreMate >= 0 ? `M${info.scoreMate}` : `-M${Math.abs(info.scoreMate)}`
  }
  if (info.scoreCp !== undefined) {
    return `${info.scoreCp >= 0 ? '+' : '-'}${(Math.abs(info.scoreCp) / 100).toFixed(1)}`
  }
  return null
}

/** The principal variation in SAN, stopping at the first move that does not play. */
export function sanLine(position: Position, pv: readonly string[], max: number): string[] {
  const probe = position.clone()
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    const intent = uciToIntent(uci)
    if (!intent) break
    const r = probe.tryMove(intent)
    if (!r.ok) break
    out.push(r.move.san)
  }
  return out
}

/** Build the server-valid hint request for the coach; null if the suggestion has no usable eval. */
export function hintRequestFrom(s: HintSuggestion, position: Position): HintRequest | null {
  const line = principalLine(s.lines)
  if (!line) return null
  const evaluation = moverScore(line)
  if (!evaluation) return null
  return {
    fen: position.fen(),
    bestMoveSan: s.san,
    line: sanLine(position, line.pv, LIMITS.maxLine),
    evaluation,
  }
}
