import { useLayoutEffect, useRef, useState } from 'react'
import type { PlayedMove } from '../../game-core/types'
import type { ClaudeNote } from '../../match/types'

export const FALLBACK_TITLE = 'Stockfish played this move after Claude failed twice'
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
  claudeNotes,
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
  /** Claude vs Claude: notes by ply index (0 = first move); a fallback move gets a ⚙. */
  claudeNotes?: Readonly<Record<number, ClaudeNote>>
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
  // Fix round 1: the first version of this used the browser's own
  // `Element.scrollIntoView({ block: 'nearest' })`, which walks every
  // scrollable ANCESTOR, not just this list — and in the single-column
  // layout (≤1020px, where `.right-column` gives up its own scroll
  // container) the walk continued past it to the document itself,
  // which genuinely can scroll there. Measured live: playing a single
  // move while the Moves tab was merely active yanked the whole PAGE down
  // to reveal it, moving the board out from under whatever the reader was
  // doing on it. Guarding it off below 768px only deleted the feature
  // exactly where the panel is smallest and needs it most (measured: at
  // 375x812 with a 70-move game, `.move-list` is its own scroll container
  // — `scrollHeight` 2097 against `clientHeight` 434 — and the current
  // move sat off-panel, unreached, guard or no guard).
  //
  // This version scrolls `listRef` DIRECTLY instead: `el.offsetTop` is
  // relative to `.move-list` itself (app.css makes it `position:
  // relative`, so it is every row's `offsetParent`), and only
  // `list.scrollTop` is ever written — never an ancestor, never the page,
  // identically at every viewport width. No 768px literal to keep in
  // sync with the CSS breakpoint any more, either.
  //
  // Deliberately instant, and a plain `if`/`else`, not an animated
  // easing: a duration this codebase cannot bound (a long jump — Home
  // from move 140 — could run well past the 200ms state-change budget)
  // would race tests/e2e/move-preview.spec.ts's own explicit,
  // synchronous scroll on the same list. Instant scrolling satisfies
  // "respect prefers-reduced-motion" by construction: there is no motion
  // to gate.
  const listRef = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => {
    const el = anchorsRef.current.get(currentPly)
    const list = listRef.current
    if (!el || !list) return
    const top = el.offsetTop
    if (top < list.scrollTop) {
      list.scrollTop = top
    } else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + el.offsetHeight - list.clientHeight
    }
  }, [currentPly])

  const entry = (e?: { san: string; ply: number }) => {
    if (!e) return <span className="move empty">…</span>
    const quality = marks?.get(e.ply)
    const symbol = quality ? MARK[quality.classification] : undefined
    const fallback = claudeNotes?.[e.ply - 1]?.fallback === true
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
        {fallback ? (
          <span className="fallback-mark" data-testid={`fallback-${e.ply}`} title={FALLBACK_TITLE}>
            ⚙
          </span>
        ) : null}
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
      <ol className="move-list" data-testid="move-list" ref={listRef}>
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
