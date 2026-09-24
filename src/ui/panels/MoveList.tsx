import { useLayoutEffect, useRef, useState } from 'react'
import type { PlayedMove } from '../../game-core/types'
import { moveQualityTitle, type MoveQuality } from '../review/reviewView'
import { MARK } from '../../review/summary'
import { toMovePairs } from './movePairs'
import { MOVE_PREVIEW_ID, MovePreviewPopover } from './MovePreview'

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

  // Task 6 (mobile pass, item A): the current move was never auto-scrolled
  // into view — a genuinely missing feature (Task 5 measured no
  // `scrollIntoView` anywhere in src/ before this), and Task 5 made its
  // absence far more noticeable: this panel went from ~14 visible pairs to
  // ~7-8 with no page scrollbar left to hint "there is more here".
  //
  // `block: 'nearest'` is deliberate: it is a no-op once the move is
  // already visible, so it never fights a reader scrolling the panel by
  // hand — which matters more now the panel is small. It also walks every
  // scrollable ANCESTOR, not just this list: on a short DESKTOP viewport
  // `.right-column` is itself a scroll container (Task 5), and that is
  // usually what you want too.
  //
  // Deliberately instant (no `behavior: 'smooth'`): a native smooth scroll
  // has a duration this codebase cannot bound — on a long jump (Home from
  // move 140, say) it can run well past the 200ms state-change budget —
  // and an animated, multi-frame scroll is exactly what would race
  // tests/e2e/move-preview.spec.ts's own explicit `scrollIntoView` call on
  // the same list. Instant scrolling satisfies "respect
  // prefers-reduced-motion" by construction: there is no motion to gate.
  //
  // Skipped entirely below the 768px single-column breakpoint. There
  // `.right-column` gives up its own cap and scrolling (Task 5's mobile
  // override), so it is no longer a qualifying ancestor for
  // `scrollIntoView` to stop at — the walk continues past it to the
  // document itself, which genuinely DOES have scrollable overflow on
  // mobile ("everything else scrolls" — manually, by design; see
  // task-6-report.md). Measured live: without this guard, playing a move
  // while the Moves tab is merely the active one (default) yanked the
  // whole PAGE down to reveal it — mid-drag, with the board the reader was
  // just touching sliding out from under their finger. Above 768px the
  // page provably cannot scroll at all (Task 5's own guarantee), so the
  // exact same call is always panel-only there — nothing to guard.
  useLayoutEffect(() => {
    if (window.matchMedia('(max-width: 768px)').matches) return
    anchorsRef.current.get(currentPly)?.scrollIntoView({ block: 'nearest' })
  }, [currentPly])

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
        // Only set while THIS move's own preview is showing — an
        // aria-describedby pointing at an id that isn't in the document
        // (every other move, the rest of the time) would be worse than
        // none, and is what lets a screen reader actually announce the
        // preview on focus instead of silently ignoring an unreferenced
        // role="tooltip".
        aria-describedby={previewPly === e.ply ? MOVE_PREVIEW_ID : undefined}
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
