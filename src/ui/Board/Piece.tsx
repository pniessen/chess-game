import type { Color, PieceSymbol } from '../../game-core/types'
import { pieceImageSrc } from '../pieceSets'

const LETTER: Record<PieceSymbol, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

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
  const code = `${color === 'w' ? 'w' : 'b'}${LETTER[type]}`
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
