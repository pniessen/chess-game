import { EvalLine } from './EvalLine'
import type { ReviewState } from './useReview'

const fmt = (x: number | null) => (x === null ? '—' : x.toFixed(1))

export function ReviewPanel({
  state,
  canReview,
  currentText,
  onStart,
  onCancel,
}: {
  state: ReviewState
  canReview: boolean
  /** Explanation of the displayed move, when reviewed. */
  currentText: string
  onStart: () => void
  onCancel: () => void
}) {
  if (state.kind === 'running') {
    return (
      <div className="review" data-testid="review">
        <progress data-testid="review-progress" value={state.done} max={state.total} />
        <span className="review-count">
          Analysing {state.done}/{state.total}
        </span>
        <button type="button" data-testid="review-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  if (state.kind === 'done') {
    return (
      <div className="review" data-testid="review">
        <p>
          White accuracy: <span data-testid="accuracy-w">{fmt(state.review.accuracy.w)}</span>%
        </p>
        <p>
          Black accuracy: <span data-testid="accuracy-b">{fmt(state.review.accuracy.b)}</span>%
        </p>
        <EvalLine review={state.review} />
        <p className="review-current" data-testid="review-current">
          {currentText}
        </p>
        <p className="review-summary" data-testid="review-summary">
          {state.summary ?? 'Writing the summary…'}
        </p>
        {state.summarySource ? (
          <p className="review-source" data-testid="review-summary-source">
            {state.summarySource === 'claude' ? 'Summary by Claude' : 'Built-in summary'}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="review" data-testid="review">
      {state.kind === 'error' ? <p className="review-error">{state.message}</p> : null}
      <button type="button" data-testid="review-start" onClick={onStart} disabled={!canReview}>
        Review game
      </button>
      {!canReview ? <p className="review-hint">Finish a game to review it.</p> : null}
    </div>
  )
}
