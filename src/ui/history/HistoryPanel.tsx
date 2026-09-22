import { useState } from 'react'
import type { HistoryEntry, HistoryStatus } from '../../storage/storage'

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtAcc = (x: number | null) => (x === null ? '—' : `${x.toFixed(0)}%`)

/**
 * Notice shown when `chess-game:history` can't be read (see `historyStatus`
 * in storage.ts): new finished games are silently not being saved, so the
 * user needs to know and needs a way out. Reset is a two-step confirm
 * (button becomes "Confirm reset.../Cancel") rather than `window.confirm`,
 * per the brief — this component owns that step entirely, so callers only
 * ever see the final, deliberate `onReset()` call.
 */
function HistoryNotice({ status, onReset }: { status: HistoryStatus; onReset: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="history-notice" data-testid="history-notice">
      <p>
        Your saved game history can&apos;t be read, so finished games aren&apos;t being saved.
        {status === 'newer-version' ? ' It may have been written by a newer version of this app.' : ''}
      </p>
      {confirming ? (
        <div className="history-notice-actions">
          <button
            type="button"
            className="history-reset-confirm"
            onClick={() => {
              setConfirming(false)
              onReset()
            }}
          >
            Confirm reset — this deletes saved games
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Reset history
        </button>
      )}
    </div>
  )
}

export function HistoryPanel({
  entries,
  status,
  onReplay,
  onReset,
}: {
  entries: readonly HistoryEntry[]
  status: HistoryStatus
  onReplay: (entry: HistoryEntry) => void
  onReset: () => void
}) {
  const notice =
    status === 'unreadable' || status === 'newer-version' ? (
      <HistoryNotice status={status} onReset={onReset} />
    ) : null

  if (entries.length === 0) {
    return (
      <>
        {notice}
        <p className="history-empty" data-testid="history-empty">
          No finished games yet.
        </p>
      </>
    )
  }
  return (
    <>
      {notice}
      <ol className="history-list" data-testid="history-list">
        {entries.map((e) => (
          <li key={e.id} data-testid="history-entry" className="history-entry">
            <div className="history-line">
              <span className="history-result">{e.result}</span>
              <span className="history-players">
                {e.white} – {e.black}
              </span>
            </div>
            <div className="history-line history-meta">
              <span>{fmtDate(e.date)}</span>
              <span>{e.opening ?? 'Unnamed opening'}</span>
            </div>
            <div className="history-line">
              <span className="history-accuracy">
                {e.accuracy ? `Accuracy ${fmtAcc(e.accuracy.w)} / ${fmtAcc(e.accuracy.b)}` : 'not reviewed'}
              </span>
              <button type="button" onClick={() => onReplay(e)}>
                Replay
              </button>
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}
