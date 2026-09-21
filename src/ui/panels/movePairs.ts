import type { PlayedMove } from '../../game-core/types'

export interface MovePair {
  number: number
  white?: { san: string; ply: number }
  black?: { san: string; ply: number }
}

/**
 * Group the move list into numbered pairs for display.
 *
 * A game loaded from a FEN with Black to move produces a first pair with an
 * empty white slot, which renders as "1... e5". No `startTurn` argument is
 * needed: the first move's own colour already carries that information.
 */
export function toMovePairs(moves: readonly PlayedMove[]): MovePair[] {
  const pairs: MovePair[] = []
  let current: MovePair | null = null
  let number = 1

  moves.forEach((m, index) => {
    const ply = index + 1
    const entry = { san: m.san, ply }
    if (m.color === 'w') {
      current = { number, white: entry }
      pairs.push(current)
      return
    }
    if (current && current.black === undefined) {
      current.black = entry
      number++
      current = null
      return
    }
    // A black move with no white move before it: the game opened with Black.
    current = { number, black: entry }
    pairs.push(current)
    number++
    current = null
  })

  return pairs
}
