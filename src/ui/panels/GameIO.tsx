import { useState } from 'react'
import type { Game } from '../../game-core/game'
import { exportPgn, importFen, importPgn, type PgnHeaders } from '../../game-core/io'

function todayFileDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function GameIO({
  game,
  headers,
  onImport,
}: {
  game: Game
  headers?: PgnHeaders
  /** Called only once a pasted PGN/FEN has parsed successfully. */
  onImport: (game: Game) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleExport = () => {
    const pgn = exportPgn(game, headers)
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chess-${todayFileDate()}.pgn`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoke once the click has been dispatched, or the blob leaks for the
    // page's lifetime.
    URL.revokeObjectURL(url)
  }

  const handleFile = (file: File) => {
    file
      .text()
      .then((content) => setText(content))
      .catch(() => setError('Could not read that file.'))
  }

  const handleSubmit = () => {
    const pgnResult = importPgn(text)
    if (pgnResult.ok) {
      setError(null)
      setText('')
      onImport(pgnResult.game)
      return
    }

    const trimmed = text.trim()
    const isSingleLine = trimmed.length > 0 && !trimmed.includes('\n')
    if (isSingleLine) {
      const fenResult = importFen(text)
      if (fenResult.ok) {
        setError(null)
        setText('')
        onImport(fenResult.game)
        return
      }
      // Both were attempted; the FEN attempt is the more specific one for a
      // single line, so surface its error.
      setError(fenResult.error)
      return
    }

    setError(pgnResult.error)
  }

  return (
    <div className="game-io">
      <button data-testid="export-pgn" onClick={handleExport}>
        Export PGN
      </button>
      <div className="import">
        <textarea
          data-testid="import-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a PGN or a single-line FEN"
        />
        <input
          type="file"
          accept=".pgn,.fen,text/plain"
          data-testid="import-file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        <button data-testid="import-submit" onClick={handleSubmit}>
          Import
        </button>
        <div className="import-error" data-testid="import-error">
          {error ?? ''}
        </div>
      </div>
    </div>
  )
}
