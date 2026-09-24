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
    <div className="shortcuts-backdrop" role="presentation">
      <div
        className="shortcuts-overlay"
        data-testid="shortcuts-overlay"
        role="dialog"
        aria-labelledby="shortcuts-heading"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={handleKeyDown}
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
