import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'

/** Everything inside the overlay that can hold focus. */
const FOCUSABLE = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

const SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: '←  →', description: 'Step back / forward one move' },
  { keys: 'Home  End', description: 'Jump to the start / the current end of the game' },
  { keys: 'f', description: 'Flip the board' },
  { keys: 'u', description: 'Undo' },
  { keys: 'r', description: 'Redo' },
  { keys: 'h', description: 'Ask for a hint' },
  { keys: 'p', description: 'Open puzzles' },
  { keys: 'Esc', description: 'Close a dialog or the promotion picker' },
  { keys: '?', description: 'Show this list' },
]

/**
 * Task 13: the keyboard-shortcuts overlay opened by `?`.
 *
 * Same focus-trap shape as GameEndCard/SettingsPopover: focus moves to the
 * dialog itself (so a screen reader reads the heading first), Tab cycles
 * inside it, Escape closes it and hands focus back to whatever had it
 * before — not necessarily a button, since `?` is usually pressed with
 * nothing in particular focused.
 *
 * Unlike those two, this one DOES set `aria-modal="true"`: a real backdrop
 * covers the whole board here (see app.css), so — unlike a settings tweak
 * or a finished game — nothing behind it is reachable while it is up, and
 * claiming modality is accurate rather than a lie to assistive tech.
 *
 * Review round 1 (Task 13/14) polish: the trap used to be escapable. A
 * `pointerdown` on the backdrop (a plain, non-focusable `<div>`) blurs
 * focus to `<body>` before any `onClick` ever ran, and nothing was
 * listening for that click at all — so the overlay stayed open, Tab from
 * `<body>` then walked the real page behind it, and Escape (no longer
 * bubbling through the now-unfocused dialog) reached only the app-wide
 * shortcuts listener, which closed `helpOpen` directly without restoring
 * focus. Two independent fixes close both gaps:
 *  - the backdrop now dismisses on click, through the exact same `close()`
 *    the Close button and the in-dialog Escape use, so a stray click can
 *    never leave the overlay open with focus adrift;
 *  - `close()` is ALSO reachable from a document-level Escape listener
 *    scoped to this component, so Escape always restores focus correctly
 *    even in the residual case where focus ends up outside the dialog by
 *    some path the click fix doesn't cover (e.g. the window itself losing
 *    and regaining focus). The app-wide shortcuts listener no longer tries
 *    to close this overlay itself — see useShortcuts.ts.
 */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const active = document.activeElement
    if (openerRef.current === null && active instanceof HTMLElement && !dialog?.contains(active)) {
      openerRef.current = active
    }
    dialog?.focus()
  }, [])

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
      opener.focus({ preventScroll: true })
      return
    }
    document.querySelector<HTMLElement>('[data-testid="shortcuts-toggle"]')?.focus({ preventScroll: true })
  }, [])

  const close = useCallback(() => {
    restoreFocus()
    onClose()
  }, [restoreFocus, onClose])

  // Document-level fallback: catches Escape even when focus has ended up
  // outside the dialog (so the React onKeyDown below never sees it, since
  // the event never bubbles through an unfocused element). When focus IS
  // inside the dialog, the React handler's own `e.stopPropagation()` fires
  // first and this listener never receives the event — see the class
  // comment above.
  useEffect(() => {
    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [close])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const nodes = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="shortcuts-backdrop" data-testid="shortcuts-backdrop" role="presentation" onClick={close}>
      <div
        className="shortcuts-overlay"
        data-testid="shortcuts-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-heading"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
        <dl className="shortcuts-list">
          {SHORTCUTS.map((s) => (
            <div className="shortcut-row" key={s.keys}>
              <dt>
                <kbd>{s.keys}</kbd>
              </dt>
              <dd>{s.description}</dd>
            </div>
          ))}
        </dl>
        <button type="button" data-testid="shortcuts-close" onClick={close}>
          Close
        </button>
      </div>
    </div>
  )
}
