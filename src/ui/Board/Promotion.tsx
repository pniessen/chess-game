import type { Color, PieceSymbol } from '../../game-core/types'
import { pieceImageSrc } from '../pieceSets'

const CHOICES: Array<{ piece: PieceSymbol; label: string; letter: string }> = [
  { piece: 'q', label: 'Queen', letter: 'Q' },
  { piece: 'r', label: 'Rook', letter: 'R' },
  { piece: 'b', label: 'Bishop', letter: 'B' },
  { piece: 'n', label: 'Knight', letter: 'N' },
]

export function Promotion({
  color,
  onChoose,
  onCancel,
  pieceSet = 'rhosgfx',
}: {
  color: Color
  onChoose: (piece: PieceSymbol) => void
  onCancel: () => void
  /** Piece set id (see pieceSets.ts); unknown ids fall back to Rhosgfx. */
  pieceSet?: string
}) {
  return (
    <div className="promotion-backdrop" onClick={onCancel} role="presentation">
      <div
        className="promotion"
        role="dialog"
        aria-label="Choose a promotion piece"
        onClick={(e) => e.stopPropagation()}
      >
        {CHOICES.map(({ piece, label, letter }) => (
          <button key={piece} aria-label={label} onClick={() => onChoose(piece)}>
            <img src={pieceImageSrc(pieceSet, `${color}${letter}`)} alt="" />
          </button>
        ))}
      </div>
    </div>
  )
}
