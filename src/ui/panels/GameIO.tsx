import { useEffect, useState } from 'react'
import type { Game } from '../../game-core/game'
import { importFen, importPgn, type PgnHeaders } from '../../game-core/io'
import { downloadPgn } from '../pgnFile'
import { buildShareUrl } from '../share'

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
  // Task 14: 'idle' before the first click; 'copied' once the clipboard
  // write succeeds; 'manual' when there is no Clipboard API, or it refused
  // (no permission, insecure context, ...) — the URL is shown to copy by
  // hand rather than the button silently doing nothing.
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [shareUrl, setShareUrl] = useState('')

  // Review round 1 (Task 14) polish: the URL and "copied" confirmation are
  // a snapshot of the position at the moment Share was clicked — a move
  // (or a new game, an undo, a jump) afterwards must invalidate both,
  // rather than leave the button silently offering a stale link. `game`
  // catches a brand-new Game object (new game/import/load); `game.ply`
  // catches a move/undo/redo/jump within the SAME object, since
  // MatchController mutates one Game in place rather than replacing it.
  useEffect(() => {
    setShareStatus('idle')
    setShareUrl('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, game.ply])

  const handleExport = () => downloadPgn(game, headers)

  const handleShare = () => {
    const url = buildShareUrl(game)
    setShareUrl(url)
    if (!navigator.clipboard?.writeText) {
      setShareStatus('manual')
      return
    }
    navigator.clipboard.writeText(url).then(
      () => setShareStatus('copied'),
      () => setShareStatus('manual'),
    )
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
      <div className="share-game">
        <button data-testid="share-link" onClick={handleShare}>
          Share position
        </button>
        {shareStatus === 'copied' ? (
          <span className="share-status" data-testid="share-status" role="status">
            Link copied to clipboard
          </span>
        ) : null}
        {shareStatus === 'manual' ? (
          <div className="share-manual" data-testid="share-manual">
            <label htmlFor="share-url-input">Copy this link:</label>
            <input
              id="share-url-input"
              type="text"
              readOnly
              data-testid="share-url"
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : null}
      </div>
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
