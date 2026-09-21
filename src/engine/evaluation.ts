import type { Color } from '../game-core/types'
import { principalLine, type EngineInfo } from './uci'

/** An evaluation from WHITE's point of view. `mate > 0`: White mates in `mate`. */
export type WhiteEval =
  | { kind: 'cp'; cp: number }
  | { kind: 'mate'; mate: number }
  | { kind: 'result'; winner: Color | null }

/** UCI scores are relative to the side to move; flip them for Black. */
export function toWhitePov(info: EngineInfo, sideToMove: Color): WhiteEval | null {
  const sign = sideToMove === 'w' ? 1 : -1
  if (info.scoreMate !== undefined) return { kind: 'mate', mate: sign * info.scoreMate }
  if (info.scoreCp !== undefined) return { kind: 'cp', cp: sign * info.scoreCp }
  return null
}

export function evalFromLines(lines: readonly EngineInfo[], sideToMove: Color): WhiteEval | null {
  const line = principalLine(lines)
  return line ? toWhitePov(line, sideToMove) : null
}

/** Lichess win% (0..100) for White. The centipawn score is clamped to ±1000 first. */
export function winPercentFromCp(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1)
}

export function whiteWinPercent(e: WhiteEval): number {
  switch (e.kind) {
    case 'cp':
      return winPercentFromCp(e.cp)
    case 'mate':
      return e.mate > 0 ? 100 : 0
    case 'result':
      return e.winner === 'w' ? 100 : e.winner === 'b' ? 0 : 50
  }
}

export function formatEval(e: WhiteEval): string {
  switch (e.kind) {
    case 'cp': {
      const pawns = (e.cp / 100).toFixed(1)
      return e.cp > 0 ? `+${pawns}` : e.cp === 0 ? '0.0' : pawns
    }
    case 'mate':
      return e.mate > 0 ? `M${e.mate}` : `-M${Math.abs(e.mate)}`
    case 'result':
      return e.winner === 'w' ? '1-0' : e.winner === 'b' ? '0-1' : '½-½'
  }
}
