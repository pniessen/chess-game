import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'

/** Everything inside the card that can hold focus (disabled buttons cannot). */
const FOCUSABLE = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Task 6: the card that stands over the lower part of the board when a game
 * ends live — the result, the opening, and what to do next.
 *
 * It deliberately has NO backdrop: the final position stays visible and
 * inspectable above it, and the card covers only its own footprint (the CSS
 * caps that at 68% of the board's height — 60% on a phone).
 *
 * Focus moves to the card itself (not its first button) so a screen reader
 * reads the headline before the actions, Tab cycles inside it, Escape
 * dismisses, and every exit puts focus back where it came from.
 *
 * `aria-modal` is deliberately NOT set (review fix round 1). It would claim
 * an inertness this card does not have — there is no backdrop and the board
 * behind stays mouse-interactive — and it would hide the final position
 * from a screen reader until the card was dismissed. The focus trap is what
 * keeps the keyboard inside it.
 *
 * Final-review fix: because there is no backdrop and the board stays
 * mouse-live, one click on a board square (which no longer makes a move —
 * the game is over — but still moves focus) drops focus onto `<body>`.
 * From there the in-card `onKeyDown` below never even sees an Escape
 * keystroke (nothing bubbles through an element that isn't focused), so
 * the card became silently stuck: Escape did nothing, Tab walked the page
 * behind it, and — because `overlayOpen` in App.tsx includes this card's
 * `open` state — every other keyboard shortcut was dead too, with no
 * keyboard way back except finding Dismiss with the mouse.
 * ShortcutsOverlay hit the identical shape (its backdrop click blurs focus
 * the same way) and fixed it the same way: a `document`-level Escape
 * listener, added only while this card is mounted, that calls the exact
 * same `restoreFocus()` + `onDismiss()` the in-card Escape handler uses —
 * so Escape dismisses correctly no matter where focus has drifted.
 */
export function GameEndCard({
  headline,
  opening,
  canReview,
  onRematch,
  onReview,
  onExport,
  onDismiss,
}: {
  /** The result line, from `describeResult` — the same text the status header shows. */
  headline: string
  /** The finished game's opening ("C50 Italian Game"), or null if it left book at once. */
  opening: string | null
  /** False when there is no engine to review with, or no moves to review. */
  canReview: boolean
  /** Play again with the same mode, level, colour and time control. */
  onRematch: () => void
  /** Run the existing post-game review flow. */
  onReview: () => void
  /** The existing PGN export. */
  onExport: () => void
  onDismiss: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    const card = cardRef.current
    const active = document.activeElement
    // Recorded once, and never from inside the card: React Strict Mode runs
    // this effect twice, and on the second pass the card itself already has
    // focus — restoring to an element that is about to be unmounted would
    // drop focus onto <body>.
    if (openerRef.current === null && active instanceof HTMLElement && !card?.contains(active)) {
      openerRef.current = active
    }
    card?.focus()
  }, [])

  /**
   * Back to whatever had focus when the game ended, if that is still a real
   * element on the page; a click on a board square leaves focus on `body`,
   * so the fallback is the New game button — the next thing a finished game
   * invites you to do, and always present.
   *
   * `preventScroll` matters: on a phone the New game panel is a long way
   * below the board, and a scrolling focus would answer "dismiss this card"
   * by yanking the final position off the screen.
   */
  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    if (
      opener instanceof HTMLElement &&
      opener.isConnected &&
      opener !== document.body &&
      !cardRef.current?.contains(opener)
    ) {
      opener.focus({ preventScroll: true })
      return
    }
    document.querySelector<HTMLElement>('[data-testid="new-game"]')?.focus({ preventScroll: true })
  }, [])

  const leave = useCallback(
    (action: () => void) => () => {
      restoreFocus()
      action()
    },
    [restoreFocus],
  )

  const dismiss = useCallback(() => {
    restoreFocus()
    onDismiss()
  }, [restoreFocus, onDismiss])

  // Document-level fallback: catches Escape even when focus has ended up
  // outside the card (a board-square click, see the class comment above),
  // so it never depends on the React `onKeyDown` below actually receiving
  // the event. When focus IS inside the card, that handler's own
  // `e.stopPropagation()` fires first and this listener never sees the
  // keystroke at all.
  useEffect(() => {
    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [dismiss])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      dismiss()
      return
    }
    if (e.key !== 'Tab') return
    const card = cardRef.current
    if (!card) return
    const nodes = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    // Tabbing off either end wraps round, so focus never escapes the card.
    if (e.shiftKey && (active === first || active === card)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="game-end-card"
      data-testid="game-end-card"
      role="dialog"
      aria-labelledby="game-end-headline"
      tabIndex={-1}
      ref={cardRef}
      onKeyDown={handleKeyDown}
    >
      {/* The status header's own result line is not a live region, so this
          announces the result once without doubling it up. */}
      <p className="game-end-headline" id="game-end-headline" data-testid="game-end-headline" aria-live="polite">
        {headline}
      </p>
      <p className="game-end-opening" data-testid="game-end-opening">
        {opening ?? ''}
      </p>
      <div className="game-end-actions">
        <button data-testid="game-end-rematch" onClick={leave(onRematch)}>
          Rematch
        </button>
        <button data-testid="game-end-review" disabled={!canReview} onClick={leave(onReview)}>
          Review game
        </button>
        {/* Exporting does not close the card: the PGN downloads and the
            other actions are still there. */}
        <button data-testid="game-end-export" onClick={onExport}>
          Export PGN
        </button>
        <button data-testid="game-end-dismiss" onClick={leave(onDismiss)}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
