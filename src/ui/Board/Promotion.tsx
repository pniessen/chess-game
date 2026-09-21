import type { Color, PieceSymbol } from '../../game-core/types'

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
}: {
  color: Color
  onChoose: (piece: PieceSymbol) => void
  onCancel: () => void
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
            <img src={`/pieces/${color}${letter}.svg`} alt="" />
          </button>
        ))}
      </div>
    </div>
  )
}
