import { useCallback, useEffect, useState } from 'react'

/** Elements a keystroke is "typing into" rather than issuing a shortcut to. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** A tab button (or anything inside one) — Tabs.tsx already owns these keys for it. */
function isWithinTab(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('[role="tab"]') !== null
}

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * Task 13: the app-wide keyboard shortcuts.
 *
 * Left/Right/Home/End step or jump through the move list, always through
 * `onJump` — the same path the move-list buttons use (see useMoveInput's
 * `handleJump`), so the board's `cut()` animation semantics stay correct;
 * this hook never touches the controller directly. f/u/r/h/p and `?` are
 * one-key shortcuts; Escape closes the promotion picker (the one overlay
 * with no Escape handling of its own — settings, the game-end card and this
 * hook's own overlay all already close themselves, see below).
 *
 * A single `document`-level listener, gated so it never fires:
 *  - while typing in an input/textarea/select/contenteditable,
 *  - while a modifier key (Ctrl/Cmd/Alt/Meta) is held, so browser/OS
 *    shortcuts sharing these letters (Cmd+R, Ctrl+F, ...) are left alone,
 *  - while focus is on a tab button, for Left/Right/Home/End only — every
 *    other shortcut still works from there,
 *  - while ANY overlay owns the keyboard (`overlayOpen`, computed by the
 *    caller from the settings popover / game-end card, or `promotionOpen`,
 *    or this hook's own shortcuts overlay) — except Escape, which this hook
 *    uses to close its own overlay or (the one gap) the promotion picker,
 *  - while the puzzle screen is showing instead of the game (`active`).
 */
export function useShortcuts({
  active,
  overlayOpen,
  promotionOpen,
  hintDisabled,
  currentPly,
  totalPlies,
  onJump,
  onFlip,
  onUndo,
  onRedo,
  onHint,
  onOpenPuzzles,
  onCancelPromotion,
}: {
  /** False while the puzzle screen is showing instead of the game. */
  active: boolean
  /** True while the settings popover, the game-end card, or this hook's own overlay owns the keyboard. */
  overlayOpen: boolean
  /** True while the promotion picker is up. */
  promotionOpen: boolean
  hintDisabled: boolean
  currentPly: number
  totalPlies: number
  onJump: (ply: number) => void
  onFlip: () => void
  onUndo: () => void
  onRedo: () => void
  onHint: () => void
  onOpenPuzzles: () => void
  onCancelPromotion: () => void
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  const closeHelp = useCallback(() => setHelpOpen(false), [])
  const openHelp = useCallback(() => setHelpOpen(true), [])

  useEffect(() => {
    if (!active) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      if (e.key === 'Escape') {
        if (helpOpen) {
          setHelpOpen(false)
          return
        }
        if (promotionOpen) {
          e.preventDefault()
          onCancelPromotion()
        }
        // Settings and the game-end card handle their own Escape (and stop
        // it from ever reaching here while they're open).
        return
      }

      // A dialog owns the keyboard: every other shortcut is swallowed,
      // whether or not focus actually landed inside it (the promotion
      // picker never moves focus into itself).
      if (overlayOpen || helpOpen || promotionOpen) return

      if (NAV_KEYS.has(e.key) && isWithinTab(e.target)) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          onJump(Math.max(0, currentPly - 1))
          return
        case 'ArrowRight':
          e.preventDefault()
          onJump(Math.min(totalPlies, currentPly + 1))
          return
        case 'Home':
          e.preventDefault()
          onJump(0)
          return
        case 'End':
          e.preventDefault()
          onJump(totalPlies)
          return
        case 'f':
        case 'F':
          onFlip()
          return
        case 'u':
        case 'U':
          onUndo()
          return
        case 'r':
        case 'R':
          onRedo()
          return
        case 'h':
        case 'H':
          if (!hintDisabled) onHint()
          return
        case 'p':
        case 'P':
          onOpenPuzzles()
          return
        case '?':
          openHelp()
          return
        default:
          return
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    active,
    overlayOpen,
    promotionOpen,
    helpOpen,
    hintDisabled,
    currentPly,
    totalPlies,
    onJump,
    onFlip,
    onUndo,
    onRedo,
    onHint,
    onOpenPuzzles,
    onCancelPromotion,
    openHelp,
  ])

  return { helpOpen, openHelp, closeHelp }
}
