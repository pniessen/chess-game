import { uciToIntent } from '../../engine/uci'
import type { Square } from '../../game-core/types'
import type { MoveClass } from '../../review/analysis'
import { moveLabel } from '../../review/moveNumber'
import type { GameReview } from '../../review/run'
import { MARK } from '../../review/summary'
import type { Annotation } from '../Board/annotations'

/** A move's quality mark (Task 8): the classification MoveList's chip
 *  colours and glyphs, plus the eval swing (mover's win-% points lost) its
 *  tooltip reads out. Both come straight from the review — nothing here
 *  recomputes or re-derives anything the engine wasn't already asked. */
export interface MoveQuality {
  classification: MoveClass
  loss: number
}

export function reviewMarks(review: GameReview): Map<number, MoveQuality> {
  return new Map(review.moves.map((m) => [m.ply, { classification: m.classification, loss: m.loss }]))
}

// Keyed by the full MoveClass — including 'ok', which MoveList never
// actually renders a chip for (MARK in review/summary.ts has no glyph for
// it, so `symbol` there is falsy and moveQualityTitle is never called with
// it) — rather than a partial map, so this stays a compiler-checked total
// mapping: adding a new MoveClass anywhere would force a decision here too.
// There is deliberately no separate "good" tier (see the Task 8 ruling):
// this label would only ever surface if some future caller chose to show a
// chip for an unflagged, non-best move.
const QUALITY_LABEL: Record<MoveClass, string> = {
  best: 'Best move',
  ok: 'Good move',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
}

/** The chip's hover tooltip: the classification plus the eval swing it was scored on. */
export function moveQualityTitle(q: MoveQuality): string {
  const pts = Math.round(q.loss)
  return pts > 0 ? `${QUALITY_LABEL[q.classification]} (−${pts}% win)` : QUALITY_LABEL[q.classification]
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
