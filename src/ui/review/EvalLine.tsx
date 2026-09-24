import { formatEval, whiteWinPercent } from '../../engine/evaluation'
import { moveLabel } from '../../review/moveNumber'
import type { GameReview, ReviewedMove } from '../../review/run'
import { MARK } from '../../review/summary'

const VIEW_W = 100
const VIEW_H = 32
const PAD = 1.5

const isFlagged = (m: ReviewedMove) =>
  m.classification === 'inaccuracy' || m.classification === 'mistake' || m.classification === 'blunder'

function pointAt(i: number, n: number, share: number): { x: number; y: number } {
  const x = PAD + (i / n) * (VIEW_W - PAD * 2)
  const y = PAD + (1 - share / 100) * (VIEW_H - PAD * 2)
  return { x, y }
}

/**
 * A one-line, plain-language reading of the chart — the figure's visible
 * caption, so a sighted user gets the gist without parsing an SVG, and
 * (via `aria-hidden` on the SVG itself, see below) effectively the
 * chart's accessible name too. Built only from `review.evals`, exactly
 * like the chart itself.
 */
export function evalLineSummary(review: GameReview): string {
  const evals = review.evals
  const shares = evals.map(whiteWinPercent)
  let peak = 0
  for (let i = 1; i < shares.length; i++) {
    if (Math.abs((shares[i] ?? 50) - 50) > Math.abs((shares[peak] ?? 50) - 50)) peak = i
  }
  const end = evals[evals.length - 1]
  const peakEval = evals[peak]
  const peakMove = peak >= 1 ? moveLabel(peak, review.moves[peak - 1]?.san ?? '', review.firstMover) : 'the start'
  const endText = end ? formatEval(end) : '0.0'
  const peakText = peakEval ? formatEval(peakEval) : '0.0'
  return peak === 0
    ? `Evaluation line for the whole game. Ended at ${endText}; the position never left even.`
    : `Evaluation line for the whole game. Ended at ${endText}. Furthest from even was ${peakText}, at ${peakMove}.`
}

/**
 * Task 10: a compact evaluation line for the whole game — one point per
 * ply, plotted from `review.evals` (White's win%, the same measure the
 * eval bar already uses, so a mate score or a terminal result compresses
 * to the same extreme rather than needing its own case). No new engine
 * calls: everything here was already computed by the review that produced
 * `review`.
 *
 * Lives in the Review tab rather than under the board: it is a summary OF
 * a completed review, reads naturally next to the accuracy figures it
 * complements, and — unlike a permanent fixture under the board — only
 * ever needs to handle the "review exists" case, since the caller (see
 * ReviewPanel) mounts it exclusively on `state.kind === 'done'`. That
 * makes "no review yet" simply "this isn't rendered", never an
 * empty-looking placeholder.
 *
 * The SVG is `aria-hidden`: it is decorative once the real content — the
 * caption above and the data table below — is read as ordinary text/table
 * markup, which is both a text equivalent and a table-like description,
 * rather than a screen reader landing on a bare, unlabelled graphic.
 */
export function EvalLine({ review }: { review: GameReview }) {
  const evals = review.evals
  const n = evals.length - 1
  if (n < 1) return null // nothing to chart (defensive: review always has >=1 move in practice)

  const shares = evals.map(whiteWinPercent)
  const points = shares.map((s, i) => pointAt(i, n, s))
  const baseline = pointAt(0, n, 50).y
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(' ')
  const areaPoints = `${points[0]!.x},${baseline} ${linePoints} ${points[n]!.x},${baseline}`
  const marks = review.moves.map((m, idx) => ({ m, point: points[idx + 1] })).filter(({ m }) => isFlagged(m))

  return (
    <figure className="eval-line" data-testid="eval-line">
      <figcaption className="eval-line-summary" data-testid="eval-line-summary">
        {evalLineSummary(review)}
      </figcaption>
      <svg className="eval-line-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={PAD} y1={baseline} x2={VIEW_W - PAD} y2={baseline} className="eval-line-baseline" />
        <polygon points={areaPoints} className="eval-line-area" />
        <polyline points={linePoints} className="eval-line-stroke" />
        {marks.map(({ m, point }) =>
          point ? (
            <circle key={m.ply} cx={point.x} cy={point.y} r={1.6} className={`eval-line-mark mark-${m.classification}`} />
          ) : null,
        )}
      </svg>
      <table className="eval-line-table sr-only" data-testid="eval-line-table">
        <caption>Evaluation after each move, White&rsquo;s point of view</caption>
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Evaluation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Start</td>
            <td>{formatEval(evals[0]!)}</td>
          </tr>
          {review.moves.map((m, idx) => (
            <tr key={m.ply}>
              <td>{moveLabel(m.ply, `${m.san}${MARK[m.classification] ?? ''}`, review.firstMover)}</td>
              <td>{formatEval(evals[idx + 1] ?? evals[idx]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
