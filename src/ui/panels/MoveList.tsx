import type { PlayedMove } from '../../game-core/types'
import { moveQualityTitle, type MoveQuality } from '../review/reviewView'
import { MARK } from '../../review/summary'
import { toMovePairs } from './movePairs'

/**
 * `ply-count` is deliberately NOT rendered here (see App.tsx): a <span> is
 * not valid inside an <ol>, and the brief's original placement inside the
 * list broke that contract. App renders it beside the list instead.
 */
export function MoveList({
  moves,
  currentPly,
  onJump,
  disabled,
  marks,
}: {
  moves: readonly PlayedMove[]
  currentPly: number
  onJump: (ply: number) => void
  /** True while jumping to history would corrupt an in-flight engine turn. */
  disabled?: boolean
  /** Post-game review classifications by ply (Task 8: quality chips). */
  marks?: ReadonlyMap<number, MoveQuality>
}) {
  const pairs = toMovePairs(moves)
  const jump = (ply: number) => {
    if (!disabled) onJump(ply)
  }
  const entry = (e?: { san: string; ply: number }) => {
    if (!e) return <span className="move empty">…</span>
    const quality = marks?.get(e.ply)
    const symbol = quality ? MARK[quality.classification] : undefined
    return (
      <button
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => jump(e.ply)}
        disabled={disabled}
      >
        {e.san}
        {symbol && quality ? (
          <span
            className={`mark mark-${quality.classification}`}
            data-testid={`mark-${e.ply}`}
            title={moveQualityTitle(quality)}
          >
            {symbol}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <ol className="move-list" data-testid="move-list">
      {pairs.map((p) => (
        <li key={p.number}>
          <span className="number">{p.number}.</span>
          {entry(p.white)}
          {entry(p.black)}
        </li>
      ))}
    </ol>
  )
}
