import type { Color } from '../../src/game-core/types'
import type { Adjudication, GameResult, Score } from './types'

/** At the ply cap, a lead of this many centipawns (or a forced mate) wins; anything less is a draw. */
export const ADJUDICATION_CP = 300

/** Stockfish's depth for the final position. */
export const ADJUDICATION_DEPTH = 18

/** The result of a game stopped at the ply cap, from Stockfish's score of its final position. */
export function adjudicate(
  score: Score,
  sideToMove: Color,
): Omit<Adjudication, 'depth'> & { result: GameResult; winner: Color | null } {
  const sign = sideToMove === 'w' ? 1 : -1
  if ('mate' in score) {
    // mate > 0: the side to move mates; mate <= 0: it is being mated.
    const mate = score.mate * sign
    const winner: Color = score.mate > 0 ? sideToMove : sideToMove === 'w' ? 'b' : 'w'
    return { result: winner === 'w' ? '1-0' : '0-1', winner, evalCp: null, mate }
  }
  const evalCp = score.cp * sign
  if (evalCp >= ADJUDICATION_CP) return { result: '1-0', winner: 'w', evalCp, mate: null }
  if (evalCp <= -ADJUDICATION_CP) return { result: '0-1', winner: 'b', evalCp, mate: null }
  return { result: '1/2-1/2', winner: null, evalCp, mate: null }
}
