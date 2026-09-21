import { uciToIntent, type EngineInfo } from '../engine/uci'
import type { Position } from '../game-core/position'

const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/**
 * Build a hint from engine output alone.
 *
 * Deliberately limited to what the analysis supports: the move, the
 * evaluation, and material won. No invented positional commentary.
 */
export function templatedHint(lines: EngineInfo[], position: Position): string | null {
  const best = lines.at(-1) ?? lines[0]
  const uci = best?.pv[0]
  if (!best || !uci) return null

  const intent = uciToIntent(uci)
  if (!intent) return null

  // Play it on a copy to get SAN and to confirm it is actually legal.
  const probe = position.clone()
  const played = probe.tryMove(intent)
  if (!played.ok) return null
  const { san, captured } = played.move

  if (best.scoreMate !== undefined && best.scoreMate > 0) {
    return `There is a forced mate in ${best.scoreMate}, starting with ${san}.`
  }
  if (best.scoreMate !== undefined && best.scoreMate < 0) {
    return `The position is lost with best play; ${san} holds out longest.`
  }
  if (captured) {
    return `${san} wins a ${PIECE_NAME[captured] ?? 'piece'}.`
  }
  if (best.scoreCp !== undefined) {
    const pawns = (best.scoreCp / 100).toFixed(1)
    const sign = best.scoreCp > 0 ? '+' : ''
    return `${san} is the engine's choice, evaluated at ${sign}${pawns}.`
  }
  return `${san} is the engine's choice.`
}
