import type { Color, PieceSymbol } from '../../game-core/types'

const LETTER: Record<PieceSymbol, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

export function Piece({ color, type }: { color: Color; type: PieceSymbol }) {
  const code = `${color === 'w' ? 'w' : 'b'}${LETTER[type]}`
  return (
    <img
      className="piece"
      data-piece={code}
      src={`/pieces/${code}.svg`}
      alt=""
      draggable={false}
    />
  )
}
