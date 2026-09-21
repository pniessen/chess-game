import { useState } from 'react'
import type { OpeningBook, OpeningEntry } from '../../openings/book'
import { numberedMoves } from '../../review/moveNumber'

export function Explorer({
  book,
  unavailable,
  current,
  onStart,
}: {
  book: OpeningBook | null
  unavailable: boolean
  /** The opening of the displayed position, if any. */
  current: OpeningEntry | null
  onStart: (entry: OpeningEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (!book) {
    return (
      <p className="explorer-status" data-testid="explorer-status">
        {unavailable ? 'Opening data is unavailable.' : 'Loading openings…'}
      </p>
    )
  }

  const results = book.search(query)
  const selected = selectedId === null ? null : (book.all[selectedId] ?? null)

  return (
    <div className="explorer" data-testid="explorer">
      {current ? (
        <p className="explorer-current">
          Now: {current.eco} {current.name}
        </p>
      ) : null}
      <input
        type="search"
        data-testid="explorer-search"
        placeholder="Search by name or ECO code"
        aria-label="Search openings"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="explorer-results" data-testid="explorer-results">
        {results.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className={e.id === selectedId ? 'selected' : ''}
              onClick={() => setSelectedId(e.id)}
            >
              <span className="eco">{e.eco}</span> {e.name}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="explorer-detail" data-testid="explorer-detail">
          <p className="explorer-name">
            {selected.eco} {selected.name}
          </p>
          <p className="explorer-moves">{numberedMoves(selected.moves, 'w')}</p>
          <button type="button" data-testid="explorer-start" onClick={() => onStart(selected)}>
            Start from this opening
          </button>
        </div>
      ) : null}
    </div>
  )
}
