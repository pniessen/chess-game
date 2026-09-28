import { useEffect, useLayoutEffect, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../app/useMediaQuery'
import { NewGame } from './NewGame'
import { usePopover } from './usePopover'

/** Below this, New game collapses into a popover. At and above it,
 * `NewGame` renders exactly as Task 3 left it: inline, above the tabs, no
 * popover chrome at all.
 *
 * 1020px, matching `.layout`'s own single-column query (app.css) exactly:
 * the popover is for when New game has no side column to live in, and
 * below 1020px there IS no right column — the layout is stacked, so an
 * inline `NewGame` would span the full width of the centred stack under
 * the board. Task 6 originally set this to 899px, when `.layout` still
 * stacked at 768px; that left 900-1020px rendering a stacked layout with
 * an inline, full-width New game card. The two breakpoints are one
 * decision and are kept in step deliberately: if `.layout`'s query moves,
 * this moves with it. */
const MOBILE_QUERY = '(max-width: 1020px)'

/** Fix round 1: fixed footprint for the position math below — an upper
 * bound `place()` feeds into its own layout, not a value read off any CSS
 * rule (`.new-game-popover`, app.css, sets none of its own: `top`/`bottom`,
 * `left`, `width` and `max-height` are all inline styles computed here).
 * `place()` always shrinks `maxHeight` further to whatever room the
 * viewport actually has in the chosen direction. */
const POPOVER_WIDTH = 320
const POPOVER_MAX_HEIGHT = 560
const MARGIN = 8
const GAP = 8

type Placement = { top: number; left: number; width: number; maxHeight: number }

/**
 * Task 6 (mobile pass): New game gets the same treatment Game file already
 * has (Task 4) — but ONLY below 1020px, where the layout is stacked. At
 * the three-column widths above it `NewGame` is the entry point to every
 * session and stays in the open, unchanged.
 *
 * Reuses `usePopover` (the shell behind Settings and Game file) rather
 * than re-deriving a focus trap — called unconditionally, before the
 * `mobile` branch below, so hook order never changes between a resize
 * that flips `mobile` and the next render (rules of hooks; the popover's
 * own effects are all `if (!open) return` no-ops while desktop never
 * opens it).
 *
 * Deliberately ONE `NewGame` instance, never two: rendering it inline AND
 * inside a CSS-hidden popover shell at the same time would duplicate every
 * `data-testid` in it (`mode`, `level`, `new-game`, …), breaking any
 * `page.getByTestId` call that assumes a single match.
 *
 * Fix round 1, two issues a reviewer caught that the first version missed
 * entirely:
 *
 * 1. **The popover is portaled to `document.body`, `position: fixed`.**
 *    The first version left it `position: absolute` inside
 *    `.new-game-anchor`, itself inside `.right-column` — which Task 5 gave
 *    `overflow-y: auto`. An absolutely-positioned descendant of a
 *    scrolling ancestor is clipped to that ancestor's box; it cannot
 *    escape, and `z-index` does nothing about it. Measured live at 899x800
 *    on an idle game: `.right-column` `clientHeight` 117 against
 *    `scrollHeight` 455, the popover 412px tall with only 73.8px of it
 *    inside the clip — a letterboxed sliver with the Start button
 *    genuinely not hit-testable (`document.elementFromPoint` at its centre
 *    returned the `.layout` div behind it, not the button). Portaling and
 *    positioning from the trigger's own `getBoundingClientRect()` — the
 *    same technique `MovePreview.tsx` already uses for exactly this reason
 *    — removes the clipping ancestor entirely; `place()` below re-runs on
 *    every scroll (capture phase — scroll doesn't bubble) and resize,
 *    same as there.
 * 2. **Anchoring flips to open UPWARD when the trigger sits in the lower
 *    half of the viewport**, and the popover's own `maxHeight` is clamped
 *    to whatever room actually exists in that direction. Fixes the
 *    reviewer's other measurement: at 375x812 opening straight below
 *    (the only thing the first version ever did) left the popover mostly
 *    off-screen — 105.8px of 412px visible, 306px of page scroll still
 *    needed to reach the rest of the form.
 * 3. **The final box is clamped against the viewport using the popover's
 *    OWN footprint, not just the anchor's rect** (`place()` below) — the
 *    same technique `MovePreview.tsx`'s `clampToViewport` uses. Needed
 *    because `place()` re-runs on every scroll, and a scroll can carry the
 *    TRIGGER itself off-screen (below the viewport) before the anchor-
 *    relative math above ever runs again: measured live at 375x812, open
 *    upward at `scrollY` 208, then wheel-scroll to 0 — the trigger's
 *    viewport rect moves to 871.5 (past the 812px viewport), and the
 *    un-clamped math placed the popover's own bottom edge 51.5px past the
 *    viewport bottom (Start still reachable; the Done row was not).
 *
 * `usePopover`'s focus trap, Escape, focus restore and the focusout guard
 * all keep working through the portal unmodified: every one of them
 * operates on `popRef`/`triggerRef` — real DOM nodes, `Node.contains()`
 * and `focus()` calls that don't care where in the React tree (as opposed
 * to the DOM, which is unchanged in shape, just re-parented at the root)
 * the elements were mounted from.
 */
export function NewGameControl(
  props: ComponentProps<typeof NewGame> & {
    /** Task 13: lets the keyboard-shortcuts hook know an overlay owns the
     * keyboard — same contract as `GameFilePopover`/`SettingsPopover`.
     * Never called on desktop: nothing here is ever "open" there. */
    onOpenChange?: (open: boolean) => void
  },
) {
  const { onOpenChange, ...newGameProps } = props
  const mobile = useMediaQuery(MOBILE_QUERY)
  const { open, toggle, close, triggerRef, popRef, handleKeyDown } = usePopover({ onOpenChange })

  // Fix round 1, issue 2: resizing past the breakpoint while the popover
  // is open
  // used to strand it. The `!mobile` branch below drops the popover's
  // MARKUP, but nothing ever told `usePopover` it had closed — `open`
  // (and, through `onOpenChange`, App.tsx's `newGameOpen`) stayed `true`
  // forever, pinning `useShortcuts`' `overlayOpen` true with it. Measured
  // live: open the popover at 500x900, resize to 1280x900 — `mode` is
  // inline, no popover anywhere in the DOM, and `f` still does not flip
  // the board, from a page with nothing left to click to unstick it
  // except by chance. `close(false)`, not `close(true)`: there is no
  // trigger button on this side of the resize for focus to land on (the
  // desktop branch never renders one), and a resize is not a click to
  // hand focus back from.
  useEffect(() => {
    if (!mobile && open) close(false)
  }, [mobile, open, close])

  // Non-null from the start, deliberately — not `null` until the first
  // `place()` below runs. `usePopover`'s own focus-on-open effect
  // (`popRef.current?.focus()`) is a PASSIVE effect keyed on `[open]`; if
  // the popover's DOM node only exists once `placement` is first computed
  // (a `useLayoutEffect`, which commits and re-renders BEFORE that passive
  // effect fires), the two land in the right order in theory — but
  // measured live, the effect ran BEFORE the render carrying a real
  // `popRef.current`, and focus stayed on the trigger, never reaching the
  // popover at all. Rendering the popover as soon as `open` is true —
  // this default is only ever on screen for the same frame it takes
  // `useLayoutEffect` below to overwrite it, before the browser ever
  // paints — keeps `popRef.current` set from the very first render where
  // `open` flips, exactly matching `GameFilePopover`/`SettingsPopover`'s
  // own (non-portaled, unconditionally-rendered-on-`open`) timing.
  const [placement, setPlacement] = useState<Placement>({ top: 0, left: 0, width: POPOVER_WIDTH, maxHeight: POPOVER_MAX_HEIGHT })

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const anchor = trigger.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - MARGIN * 2)
      const left = Math.min(
        Math.max(anchor.left, MARGIN),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      )
      // "Lower half of the viewport" (not the page — this is `position:
      // fixed`, so only the viewport's own geometry matters): open upward
      // there, since there is more likely to be room above the trigger
      // than below it. Expressed as a `top` either way (never `bottom`),
      // so the clamp below has one number to work with, not two shapes.
      let top: number
      let maxHeight: number
      if (anchor.top > window.innerHeight / 2) {
        maxHeight = Math.min(POPOVER_MAX_HEIGHT, window.innerHeight * 0.8, anchor.top - GAP - MARGIN)
        top = anchor.top - GAP - maxHeight
      } else {
        maxHeight = Math.min(
          POPOVER_MAX_HEIGHT,
          window.innerHeight * 0.8,
          window.innerHeight - anchor.bottom - GAP - MARGIN,
        )
        top = anchor.bottom + GAP
      }

      // Additional item A: the anchor-relative math above assumes the
      // trigger's OWN rect is inside the viewport, which is not always
      // true — `place()` re-runs on every scroll (capture phase), and a
      // scroll can move the trigger anywhere, including below the bottom
      // edge, before this handler gets to look at it. Measured live at
      // 375x812: open the popover while scrolled down (trigger in the
      // lower half, so it anchors upward, correctly, at that scroll
      // position), then wheel-scroll the PAGE to the top — the trigger's
      // viewport rect moves down with it, past `window.innerHeight`
      // entirely (871.5 against an 812 viewport), and the un-clamped
      // upward math above places the popover's `top` such that its own
      // bottom edge (`top + maxHeight`) lands 51.5px past the viewport
      // bottom — Start is still reachable, but the Done row below it is
      // not. Clamping the FINAL box against the popover's own footprint
      // (`maxHeight`, already computed above), not merely against the
      // anchor, is the same technique `MovePreview.tsx`'s
      // `clampToViewport` uses for its own fixed-size popover — the only
      // difference here is that this popover's height varies per
      // placement, so the clamp works off `maxHeight` instead of a
      // constant.
      maxHeight = Math.max(maxHeight, MARGIN)
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, window.innerHeight - maxHeight - MARGIN))

      setPlacement({ top, left, width, maxHeight })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, triggerRef])

  if (!mobile) return <NewGame {...newGameProps} />

  return (
    <div>
      <button
        type="button"
        className="new-game-trigger"
        data-testid="new-game-toggle"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="new-game-popover"
        onClick={toggle}
      >
        <span className="new-game-icon" aria-hidden="true" />
        New game
      </button>

      {open
        ? createPortal(
            <div
              id="new-game-popover"
              className="new-game-popover"
              data-testid="new-game-popover"
              role="dialog"
              aria-label="New game"
              tabIndex={-1}
              ref={popRef}
              onKeyDown={handleKeyDown}
              style={{
                top: placement.top,
                left: placement.left,
                width: placement.width,
                maxHeight: placement.maxHeight,
              }}
            >
              {/* Starting a game (or opening Puzzles) is a decision, not a
                  setting — closing behind it matches `GameFilePopover`
                  closing on a successful import. `close(true)`, restoring
                  focus to the trigger, is required here, not merely
                  polite: the click that fires `onStart`/`onPuzzles` lands
                  on a button INSIDE this popover, and the very next render
                  removes that button (and the whole popover) from the
                  DOM. Measured live: with `close(false)` (or no `close`
                  call at all — React unmounts the focused element either
                  way), focus lands on `<body>` — the same hole
                  `GameFilePopover`'s `documentEscape` and `usePopover`'s
                  own focusout guard exist to close elsewhere. Moving focus
                  BEFORE the unmount (which `close(true)` does,
                  synchronously, ahead of `onStart`/`onPuzzles` below)
                  sidesteps it entirely instead of needing another guard
                  for it.

                  `window.scrollTo({ top: 0 })` alongside it: the trigger
                  (and this popover's own submit button, further down the
                  form) can sit well below the fold on mobile, so reaching
                  them scrolls the page down first — and nothing scrolled
                  it back. Fix round 2: this used to also be one trigger
                  for a page/board shift on the very next status-row
                  change (Chromium's own scroll anchoring "compensating"
                  for `.status-row` growing, e.g. the opening name filling
                  in on move one) — that root cause is now fixed directly,
                  in app.css (`html, body { overflow-anchor: none }`; see
                  its own comment there), not merely worked around here.
                  `window.scrollTo({ top: 0 })` stays regardless: a fresh
                  game is simply a good reason to be looking at the top of
                  the page again. */}
              <NewGame
                {...newGameProps}
                onStart={() => {
                  close(true)
                  window.scrollTo({ top: 0 })
                  newGameProps.onStart()
                }}
                onPuzzles={
                  newGameProps.onPuzzles
                    ? () => {
                        close(true)
                        window.scrollTo({ top: 0 })
                        newGameProps.onPuzzles?.()
                      }
                    : undefined
                }
              />
              <div className="new-game-popover-actions">
                <button type="button" data-testid="new-game-popover-done" onClick={() => close(true)}>
                  Done
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
