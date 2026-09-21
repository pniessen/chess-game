import type { PieceSymbol, PlayedMove } from '../../game-core/types'
import { capturedPieces, materialBalance } from './material'

const GLYPH: Record<PieceSymbol, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
}

function Tray({ pieces, testId }: { pieces: readonly PieceSymbol[]; testId: string }) {
  return (
    <div className="captured-tray" data-testid={testId}>
      {pieces.map((p, i) => (
        <span key={i} className="captured-piece">
          {GLYPH[p]}
        </span>
      ))}
    </div>
  )
}

/** `moves` are the moves captures are computed over (the currently displayed position's history). */
export function Captured({ moves }: { moves: readonly PlayedMove[] }) {
  const captured = capturedPieces(moves)
  const balance = materialBalance(captured)

  return (
    <div className="captured" data-testid="captured">
      {/* Pieces WHITE has captured (i.e. black material taken) sit by white's tray. */}
      <Tray pieces={captured.w} testId="captured-by-white" />
      {balance !== 0 ? (
        <span className="material-balance" data-testid="material-balance">
          {balance > 0 ? `White +${balance}` : `Black +${-balance}`}
        </span>
      ) : null}
      <Tray pieces={captured.b} testId="captured-by-black" />
    </div>
  )
}
