import { useRef, useState } from 'react'
import type { PlayedMove } from '../../game-core/types'
import { moveQualityTitle, type MoveQuality } from '../review/reviewView'
import { MARK } from '../../review/summary'
import { toMovePairs } from './movePairs'
import { MovePreviewPopover } from './MovePreview'

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
  orientation = 'white',
  theme = 'classic',
  pieceSet = 'rhosgfx',
}: {
  moves: readonly PlayedMove[]
  currentPly: number
  onJump: (ply: number) => void
  /** True while jumping to history would corrupt an in-flight engine turn. */
  disabled?: boolean
  /** Post-game review classifications by ply (Task 8: quality chips). */
  marks?: ReadonlyMap<number, MoveQuality>
  /** Task 9: board orientation/theme/piece set for the hover preview — kept in step with the main board. */
  orientation?: 'white' | 'black'
  theme?: string
  pieceSet?: string
}) {
  const pairs = toMovePairs(moves)
  const jump = (ply: number) => {
    if (!disabled) onJump(ply)
  }

  // Task 9: hovering or focusing a move shows a small popover of that
  // position, without touching the displayed board — this component's own
  // state, nothing App/Board-level, so scrubbing the list never re-renders
  // the main board. `fenAfter` is already recorded on every played move
  // (see PlayedMove), so showing a preview is a single FEN parse, not a
  // replay from the start of the game.
  const [previewPly, setPreviewPly] = useState<number | null>(null)
  const anchorsRef = useRef(new Map<number, HTMLButtonElement>())

  const showPreview = (ply: number) => setPreviewPly(ply)
  const hidePreview = (ply: number) =>
    setPreviewPly((current) => (current === ply ? null : current))

  const entry = (e?: { san: string; ply: number }) => {
    if (!e) return <span className="move empty">…</span>
    const quality = marks?.get(e.ply)
    const symbol = quality ? MARK[quality.classification] : undefined
    return (
      <button
        ref={(el) => {
          if (el) anchorsRef.current.set(e.ply, el)
          else anchorsRef.current.delete(e.ply)
        }}
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => jump(e.ply)}
        disabled={disabled}
        onMouseEnter={() => showPreview(e.ply)}
        onMouseLeave={() => hidePreview(e.ply)}
        onFocus={() => showPreview(e.ply)}
        onBlur={() => hidePreview(e.ply)}
        onKeyDown={(ev) => {
          // Dismiss the preview without moving focus off the move — a real
          // Escape-to-close, not a blur (which would also hide it, but by
          // side effect, and would kick focus off the move entirely).
          if (ev.key === 'Escape' && previewPly === e.ply) setPreviewPly(null)
        }}
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

  const previewMove = previewPly != null ? moves[previewPly - 1] : undefined

  return (
    <>
      <ol className="move-list" data-testid="move-list">
        {pairs.map((p) => (
          <li key={p.number}>
            <span className="number">{p.number}.</span>
            {entry(p.white)}
            {entry(p.black)}
          </li>
        ))}
      </ol>
      {previewPly != null && previewMove ? (
        <MovePreviewPopover
          anchorEl={anchorsRef.current.get(previewPly) ?? null}
          fen={previewMove.fenAfter}
          san={previewMove.san}
          orientation={orientation}
          theme={theme}
          pieceSet={pieceSet}
        />
      ) : null}
    </>
  )
}
