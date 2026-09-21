import { formatEval, whiteWinPercent, type WhiteEval } from '../../engine/evaluation'

export function EvalBar({
  evaluation,
  orientation,
}: {
  evaluation: WhiteEval | null
  orientation: 'white' | 'black'
}) {
  const share = evaluation ? whiteWinPercent(evaluation) : 50
  const label = evaluation ? formatEval(evaluation) : '…'
  const whiteAhead = share >= 50
  // White's end of the bar is nearest White's side of the board.
  const atBottom = (orientation === 'white') === whiteAhead
  return (
    <div
      className={`eval-bar ${orientation}`}
      data-testid="eval-bar"
      data-orientation={orientation}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
      aria-valuetext={label}
    >
      <div
        className="eval-bar-white"
        data-testid="eval-white-share"
        style={{ height: `${Math.round(share * 10) / 10}%` }}
      />
      <span
        className={`eval-label ${atBottom ? 'bottom' : 'top'} ${whiteAhead ? 'on-white' : 'on-black'}`}
        data-testid="eval-label"
      >
        {label}
      </span>
    </div>
  )
}
