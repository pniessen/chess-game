import type { HistoryEntry } from '../../storage/storage'

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtAcc = (x: number | null) => (x === null ? '—' : `${x.toFixed(0)}%`)

export function HistoryPanel({
  entries,
  onReplay,
}: {
  entries: readonly HistoryEntry[]
  onReplay: (entry: HistoryEntry) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="history-empty" data-testid="history-empty">
        No finished games yet.
      </p>
    )
  }
  return (
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
  )
}
