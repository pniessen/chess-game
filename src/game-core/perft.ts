import type { Position } from './position'

/**
 * Count the leaves of the legal-move tree to `depth`.
 *
 * This validates our own legalMoves(): if it dropped a move, duplicated one,
 * or failed to expand a promotion into four entries, the count diverges from
 * the published value immediately. Very little else would catch those bugs.
 */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1
  let nodes = 0
  for (const intent of pos.legalMoves()) {
    const next = pos.clone()
    const result = next.tryMove(intent)
    if (!result.ok) {
      throw new Error(
        `legalMoves() produced an illegal move: ${intent.from}${intent.to}` +
          `${intent.promotion ?? ''} in ${pos.fen()}`,
      )
    }
    nodes += perft(next, depth - 1)
  }
  return nodes
}
