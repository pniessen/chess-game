import { LIMITS, type FlaggedClass, type ReviewRequest } from '../coach/protocol'
import type { Color } from '../game-core/types'
import { moveLabel } from './moveNumber'
import type { GameReview, ReviewedMove } from './run'

export const MARK: Record<string, string> = { best: '!', inaccuracy: '?!', mistake: '?', blunder: '??' }
const FLAGGED: readonly FlaggedClass[] = ['inaccuracy', 'mistake', 'blunder']

const isFlagged = (m: ReviewedMove): m is ReviewedMove & { classification: FlaggedClass } =>
  (FLAGGED as readonly string[]).includes(m.classification)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function counts(review: GameReview, side: Color): string {
  const of = (c: FlaggedClass) => review.moves.filter((m) => m.mover === side && m.classification === c).length
  return `${plural(of('inaccuracy'), 'inaccuracy', 'inaccuracies')}, ${plural(of('mistake'), 'mistake', 'mistakes')}, ${plural(of('blunder'), 'blunder', 'blunders')}`
}

const RESULT_TEXT: Record<string, string> = {
  '1-0': 'White won.',
  '0-1': 'Black won.',
  '1/2-1/2': 'The game was drawn.',
  '*': 'The game was not finished.',
}

/** The no-network summary: only facts the review itself established. */
export function templatedSummary(review: GameReview, opts: { opening: string | null; result: string }): string {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x)}%`)
  const parts = [
    RESULT_TEXT[opts.result] ?? '',
    `Accuracy: White ${pct(review.accuracy.w)}, Black ${pct(review.accuracy.b)}.`,
  ]
  if (opts.opening) parts.push(`Opening: ${opts.opening}.`)
  parts.push(`White: ${counts(review, 'w')}. Black: ${counts(review, 'b')}.`)
  const worst = review.moves.filter(isFlagged).sort((a, b) => b.loss - a.loss)[0]
  if (worst) {
    const label = moveLabel(worst.ply, `${worst.san}${MARK[worst.classification] ?? ''}`, review.firstMover)
    parts.push(`The turning point was ${label}${worst.bestSan ? ` — ${worst.bestSan} was stronger` : ''}.`)
  } else {
    parts.push('No serious mistakes by either side.')
  }
  return parts.filter(Boolean).join(' ')
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function reviewRequestFrom(
  review: GameReview,
  opts: { result: ReviewRequest['result']; opening: string | null; humanSide: Color | null },
): ReviewRequest {
  const flagged = review.moves
    .filter(isFlagged)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, LIMITS.maxFlagged)
    .sort((a, b) => a.ply - b.ply)
    .map((m) => ({ ply: m.ply, san: m.san, classification: m.classification, bestSan: m.bestSan, lossPct: round1(Math.min(100, m.loss)) }))
  return {
    moves: review.moves.slice(0, LIMITS.maxMoves).map((m) => m.san),
    firstMover: review.firstMover,
    result: opts.result,
    opening: opts.opening ? opts.opening.slice(0, LIMITS.maxOpeningName) : null,
    accuracy: {
      w: review.accuracy.w === null ? null : round1(review.accuracy.w),
      b: review.accuracy.b === null ? null : round1(review.accuracy.b),
    },
    flagged: flagged.filter((f) => f.ply <= LIMITS.maxMoves),
    humanSide: opts.humanSide,
  }
}
