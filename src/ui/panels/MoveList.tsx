import type { PlayedMove } from '../../game-core/types'
import type { MoveClass } from '../../review/analysis'
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
  /** Post-game review classifications by ply. */
  marks?: ReadonlyMap<number, MoveClass>
}) {
  const pairs = toMovePairs(moves)
  const jump = (ply: number) => {
    if (!disabled) onJump(ply)
  }
  const entry = (e?: { san: string; ply: number }) => {
    if (!e) return <span className="move empty">…</span>
    const mark = marks?.get(e.ply)
    const symbol = mark ? MARK[mark] : undefined
    return (
      <button
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => jump(e.ply)}
        disabled={disabled}
      >
        {e.san}
        {symbol ? (
          <span className={`mark mark-${mark}`} data-testid={`mark-${e.ply}`} title={mark}>
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
