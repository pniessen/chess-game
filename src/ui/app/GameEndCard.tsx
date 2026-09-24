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

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      restoreFocus()
      onDismiss()
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
      aria-modal="true"
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
