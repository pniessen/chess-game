import type { Color, PieceSymbol, PlayedMove } from '../../game-core/types'
import { Piece } from '../Board/Piece'
import { capturedPieces, materialBalance } from './material'

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

function getPieceLabel(color: Color, type: PieceSymbol): string {
  const colorName = color === 'w' ? 'white' : 'black'
  return `${colorName} ${PIECE_NAME[type]}`
}

/** `color` is the colour of the CAPTURED pieces shown in this tray (not who captured them). */
function Tray({
  pieces,
  testId,
  color,
  pieceSet,
}: {
  pieces: readonly PieceSymbol[]
  testId: string
  color: Color
  pieceSet: string
}) {
  return (
    <div className="captured-tray" data-testid={testId}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="captured-piece"
          aria-label={getPieceLabel(color, p)}
          role="img"
        >
          <Piece color={color} type={p} pieceSet={pieceSet} />
        </span>
      ))}
    </div>
  )
}

/**
 * `moves` are the moves captures are computed over (the currently displayed
 * position's history). `pieceSet` is a piece-set id (see pieceSets.ts);
 * unknown ids fall back to Rhosgfx.
 */
export function Captured({
  moves,
  pieceSet = 'rhosgfx',
}: {
  moves: readonly PlayedMove[]
  pieceSet?: string
}) {
  const captured = capturedPieces(moves)
  const balance = materialBalance(captured)

  return (
    <div className="captured" data-testid="captured">
      {/* Pieces WHITE has captured (i.e. black material taken) sit by white's tray. */}
      <Tray pieces={captured.w} testId="captured-by-white" color="b" pieceSet={pieceSet} />
      {balance !== 0 ? (
        // Keyed by the balance itself (Task 11): when it changes value —
        // a new capture, or scrubbing history to a ply with a different
        // balance — React mounts a fresh node instead of patching the text
        // of the old one, which is what lets the CSS entrance animation
        // (app.css) replay for the new lead. Purely presentational: the
        // number itself still comes straight from materialBalance.
        <span key={balance} className="material-balance" data-testid="material-balance">
          {balance > 0 ? `White +${balance}` : `Black +${-balance}`}
        </span>
      ) : null}
      <Tray pieces={captured.b} testId="captured-by-black" color="w" pieceSet={pieceSet} />
    </div>
  )
}
