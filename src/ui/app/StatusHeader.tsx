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
  turn,
  result,
  engineStatus,
  opening,
  coachState,
  onDismissNotice,
}: {
  engineAvailable: boolean
  resumePending: boolean
  onResumeAccept: () => void
  onResumeDecline: () => void
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
