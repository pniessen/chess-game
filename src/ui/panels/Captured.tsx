import type { Color, PieceSymbol, PlayedMove } from '../../game-core/types'
import { Piece } from '../Board/Piece'
import { capturedPieces, materialBalance } from './material'

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
        <span key={i} className="captured-piece">
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
        <span className="material-balance" data-testid="material-balance">
          {balance > 0 ? `White +${balance}` : `Black +${-balance}`}
        </span>
      ) : null}
      <Tray pieces={captured.b} testId="captured-by-black" color="w" pieceSet={pieceSet} />
    </div>
  )
}
