import type { Color, PieceSymbol } from '../../game-core/types'
import { pieceCode, pieceImageSrc } from '../pieceSets'

/** `pieceSet` is a piece-set id (see pieceSets.ts); unknown ids fall back to Rhosgfx. */
export function Piece({
  color,
  type,
  pieceSet = 'rhosgfx',
}: {
  color: Color
  type: PieceSymbol
  pieceSet?: string
}) {
  const code = pieceCode(color, type)
  return (
    <img
      className="piece"
      data-piece={code}
      src={pieceImageSrc(pieceSet, code)}
      alt=""
      draggable={false}
    />
  )
}
