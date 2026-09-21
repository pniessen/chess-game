import type { PlayedMove } from '../../game-core/types'
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
}: {
  moves: readonly PlayedMove[]
  currentPly: number
  onJump: (ply: number) => void
  /** True while jumping to history would corrupt an in-flight engine turn. */
  disabled?: boolean
}) {
  const pairs = toMovePairs(moves)
  const jump = (ply: number) => {
    if (!disabled) onJump(ply)
  }
  const entry = (e?: { san: string; ply: number }) =>
    e ? (
      <button
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => jump(e.ply)}
        disabled={disabled}
      >
        {e.san}
      </button>
    ) : (
      <span className="move empty">…</span>
    )

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
