import type { ComponentProps } from 'react'
import { useMediaQuery } from '../app/useMediaQuery'
import { NewGame } from './NewGame'
import { usePopover } from './usePopover'

/** Below this, New game collapses into a popover (a prior binding ruling —
 * see task-6-report.md). At and above it, `NewGame` renders exactly as
 * Task 3 left it: inline, above the tabs, no popover chrome at all. */
const MOBILE_QUERY = '(max-width: 899px)'

/**
 * Task 6 (mobile pass): New game gets the same treatment Game file already
 * has (Task 4) — but ONLY below 900px. At desktop widths `NewGame` is the
 * entry point to every session and stays in the open, unchanged.
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

  if (!mobile) return <NewGame {...newGameProps} />

  return (
    <div className="new-game-anchor">
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

      {open ? (
        <div
          id="new-game-popover"
          className="new-game-popover"
          data-testid="new-game-popover"
          role="dialog"
          aria-label="New game"
          tabIndex={-1}
          ref={popRef}
          onKeyDown={handleKeyDown}
        >
          {/* Starting a game (or opening Puzzles) is a decision, not a
              setting — closing behind it matches `GameFilePopover` closing
              on a successful import. `close(true)`, restoring focus to the
              trigger, is required here, not merely polite: the click that
              fires `onStart`/`onPuzzles` lands on a button INSIDE this
              popover, and the very next render removes that button (and
              the whole popover) from the DOM. Measured live: with
              `close(false)` (or no `close` call at all — React unmounts
              the focused element either way), focus lands on `<body>` —
              the same hole `GameFilePopover`'s `documentEscape` and
              `usePopover`'s own focusout guard exist to close elsewhere.
              Moving focus BEFORE the unmount (which `close(true)` does,
              synchronously, ahead of `onStart`/`onPuzzles` below) sidesteps
              it entirely instead of needing another guard for it.

              `window.scrollTo({ top: 0 })` alongside it: the trigger (and
              this popover's own submit button, further down the form) can
              sit well below the fold on mobile, so reaching them scrolls
              the page down first — and nothing scrolled it back. Left
              there, the first status-row change that grows the header
              (the opening name filling in on move one, e.g.) lets
              Chromium's own scroll anchoring "compensate" by advancing
              `window.scrollY` again, to hold whatever was already on
              screen in place. Measured live: 208px -> 281px, no code of
              this task's own in between. A fresh game is also just a good
              reason to look at the top of the page again regardless. */}
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
        </div>
      ) : null}
    </div>
  )
}
