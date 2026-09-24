import type { ReactNode } from 'react'
import type { Color } from '../../game-core/types'
import type { CoachSnapshot } from '../../coach/client'
import type { OpeningEntry } from '../../openings/book'

/**
 * Everything between the title and the three-column layout: the engine
 * warning, the resume offer, the status row (turn, result, engine restart,
 * opening, coach badge) and the coach's one-time notice.
 */
export function StatusHeader({
  engineAvailable,
  resumePending,
  onResumeAccept,
  onResumeDecline,
  shareConflict,
  onShareAccept,
  onShareDecline,
  shareError,
  onDismissShareError,
  turn,
  result,
  engineStatus,
  opening,
  coachState,
  onDismissNotice,
  actions,
}: {
  engineAvailable: boolean
  resumePending: boolean
  onResumeAccept: () => void
  onResumeDecline: () => void
  /** Task 14: a shared-position link arrived alongside a saved in-progress game. */
  shareConflict: boolean
  onShareAccept: () => void
  onShareDecline: () => void
  /** Task 14: a shared-position link could not be read; null when there is nothing to report. */
  shareError: string | null
  onDismissShareError: () => void
  /** The side to move in the DISPLAYED position. */
  turn: Color
  /** The result banner text (describeResult). */
  result: string
  /** 'loading': the first handshake hasn't settled. 'restarting': a later one, after a crash. */
  engineStatus: 'ok' | 'loading' | 'restarting'
  /** The opening of the displayed position. */
  opening: OpeningEntry | null
  coachState: CoachSnapshot
  onDismissNotice: () => void
  /** Task 12: the settings popover, anchored at the end of the status row. */
  actions?: ReactNode
}) {
  return (
    <>
      {!engineAvailable ? (
        <p className="engine-warning">
          The chess engine is unavailable — playing in two-player mode only.
        </p>
      ) : null}

      {resumePending ? (
        <p className="resume-banner" data-testid="resume-banner">
          Resume your previous game?
          <button data-testid="resume-accept" onClick={onResumeAccept}>
            Resume
          </button>
          <button data-testid="resume-decline" onClick={onResumeDecline}>
            Discard
          </button>
        </p>
      ) : null}

      {/* Task 14: a shared-position link arrived alongside a saved game —
          the same resume-choice pattern as the banner above, offering the
          shared position instead of (never destructively instead of) it. */}
      {shareConflict ? (
        <p className="resume-banner" data-testid="share-conflict-banner">
          Open the position from your shared link? Your saved game is kept either way.
          <button data-testid="share-accept" onClick={onShareAccept}>
            Open shared position
          </button>
          <button data-testid="share-decline" onClick={onShareDecline}>
            Keep my saved game
          </button>
        </p>
      ) : null}

      {shareError ? (
        <p className="resume-banner" data-testid="share-link-error">
          {shareError}
          <button data-testid="share-link-dismiss" onClick={onDismissShareError}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="status-row">
        <p data-testid="turn">{turn === 'w' ? 'White to move' : 'Black to move'}</p>
        <p className="result" data-testid="result">
          {result}
        </p>
        {engineStatus !== 'ok' ? (
          <p className="engine-status" role="status" data-testid="engine-status">
            <span className="engine-spinner" aria-hidden="true" />
            {engineStatus === 'loading' ? 'Loading engine…' : 'Engine restarting…'}
          </p>
        ) : null}
        <p className="opening" data-testid="opening" title={opening ? `${opening.eco} ${opening.name}` : undefined}>
          {opening ? `${opening.eco} ${opening.name}` : ''}
        </p>
        {coachState.status === 'offline' || coachState.status === 'no-key' ? (
          <span
            className="coach-badge"
            data-testid="coach-badge"
            title={
              coachState.status === 'no-key'
                ? 'The coach server has no ANTHROPIC_API_KEY; using built-in hints.'
                : 'The coach server is not reachable; using built-in hints.'
            }
          >
            coaching offline
          </span>
        ) : null}
        {actions}
      </div>

      {coachState.notice ? (
        <p className="coach-notice" role="status" data-testid="coach-notice">
          {coachState.notice}
          <button data-testid="coach-notice-dismiss" onClick={onDismissNotice}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  )
}
