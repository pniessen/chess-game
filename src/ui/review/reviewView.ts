import { uciToIntent } from '../../engine/uci'
import type { Square } from '../../game-core/types'
import type { MoveClass } from '../../review/analysis'
import { moveLabel } from '../../review/moveNumber'
import type { GameReview } from '../../review/run'
import { MARK } from '../../review/summary'
import type { Annotation } from '../Board/annotations'

export function reviewMarks(review: GameReview): Map<number, MoveClass> {
  return new Map(review.moves.map((m) => [m.ply, m.classification]))
}

/** On a flagged move: tint where it went, and an arrow for the engine's better move from the position before. */
export function reviewAnnotations(review: GameReview | null, ply: number): Annotation[] {
  const m = review && ply >= 1 ? review.moves[ply - 1] : undefined
  if (!m || (m.classification !== 'inaccuracy' && m.classification !== 'mistake' && m.classification !== 'blunder')) {
    return []
  }
  const out: Annotation[] = [{ kind: 'square', square: m.uci.slice(2, 4) as Square, tone: m.classification }]
  const best = m.bestUci ? uciToIntent(m.bestUci) : null
  if (best) out.push({ kind: 'arrow', from: best.from, to: best.to, tone: 'best' })
  return out
}

const NAME: Record<MoveClass, string> = {
  best: 'best', ok: 'ok', inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder',
}

export function currentMoveText(review: GameReview, ply: number): string {
  const m = ply >= 1 ? review.moves[ply - 1] : undefined
  if (!m) return ''
  const label = moveLabel(m.ply, `${m.san}${MARK[m.classification] ?? ''}`, review.firstMover)
  if (m.classification === 'best') return `${label} was the engine’s choice.`
  if (m.classification === 'ok') return `${label} — fine.${m.bestSan ? ` The engine preferred ${m.bestSan}.` : ''}`
  return `${label} is ${NAME[m.classification]}.${m.bestSan ? ` Better was ${m.bestSan}.` : ''}`
}
