import type { BlunderPuzzle } from '../../puzzles/types'

export function MistakesList({
  puzzles,
  currentId,
  onPick,
}: {
  puzzles: readonly BlunderPuzzle[]
  currentId: string | null
  onPick: (p: BlunderPuzzle) => void
}) {
  if (puzzles.length === 0) {
    return (
      <p className="mistakes-empty" data-testid="mistakes-empty">
        No mistakes saved yet. Review a finished game and the blunders you made in it will appear here.
      </p>
    )
  }
  return (
    <ol className="mistake-list" data-testid="mistake-list">
      {puzzles.map((p) => (
        <li
          key={p.id}
          data-testid="mistake-item"
          className={p.id === currentId ? 'mistake-item current' : 'mistake-item'}
          aria-current={p.id === currentId ? 'true' : undefined}
        >
          <button type="button" onClick={() => onPick(p)}>
            {p.blunderLabel}??
          </button>
          <span className="mistake-meta">
            {p.gameDate.slice(0, 10)}
            {p.opening ? ` · ${p.opening}` : ''}
          </span>
          {p.solved ? (
            <span className="mistake-solved" data-testid="mistake-solved">
              Solved
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
