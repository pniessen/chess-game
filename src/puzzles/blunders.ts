import { Position } from '../game-core/position'
import type { Color, PlayedMove } from '../game-core/types'
import { uciToIntent } from '../engine/uci'
import { moveLabel } from '../review/moveNumber'
import type { GameReview } from '../review/run'
import type { BlunderPuzzle } from './types'

/** One puzzle per position: placement, side, castling, en passant — no move counters. */
export function blunderIdOf(fen: string): string {
  return `b:${fen.split(' ').slice(0, 4).join(' ')}`
}

export interface BlunderSource {
  gameId: string
  gameDate: string
  opening: string | null
}

/**
 * Every move by a human side that the review classified as a blunder,
 * turned into a one-move puzzle: the position before it, solved by the
 * engine's best move from the review. The best move is replayed through
 * game-core first; anything unusable is skipped.
 */
export function blunderPuzzlesFrom(opts: {
  review: GameReview
  startFen: string
  moves: readonly PlayedMove[]
  humanSides: readonly Color[]
  source: BlunderSource
  now: Date
}): BlunderPuzzle[] {
  const out: BlunderPuzzle[] = []
  for (const m of opts.review.moves) {
    if (m.classification !== 'blunder' || !opts.humanSides.includes(m.mover)) continue
    if (m.bestUci === null || m.bestUci === m.uci) continue
    const fen = m.ply === 1 ? opts.startFen : opts.moves[m.ply - 2]?.fenAfter
    if (!fen) continue
    const loaded = Position.fromFen(fen)
    const intent = uciToIntent(m.bestUci)
    if (!loaded.ok || !intent || loaded.position.turn() !== m.mover) continue
    const best = loaded.position.tryMove(intent)
    if (!best.ok) continue
    out.push({
      id: blunderIdOf(fen),
      fen,
      solution: m.bestUci,
      bestSan: best.move.san,
      blunderLabel: moveLabel(m.ply, m.san, opts.review.firstMover),
      solver: m.mover,
      gameId: opts.source.gameId,
      gameDate: opts.source.gameDate,
      opening: opts.source.opening,
      createdAt: opts.now.toISOString(),
      solved: false,
    })
  }
  return out
}
