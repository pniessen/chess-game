import type { PieceSymbol, PlayedMove } from '../../game-core/types'

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function capturedPieces(moves: readonly PlayedMove[]): {
  w: PieceSymbol[]
  b: PieceSymbol[]
} {
  const out: { w: PieceSymbol[]; b: PieceSymbol[] } = { w: [], b: [] }
  for (const m of moves) {
    if (m.captured) out[m.color].push(m.captured)
  }
  return out
}

/** Positive favours White. */
export function materialBalance(captured: {
  w: PieceSymbol[]
  b: PieceSymbol[]
}): number {
  const sum = (ps: PieceSymbol[]) => ps.reduce((t, p) => t + VALUE[p], 0)
  return sum(captured.w) - sum(captured.b)
}
