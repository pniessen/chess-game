import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

/**
 * Task 4 (above the fold): the shell behind BOTH header popovers — Settings
 * (Task 12) and Game file.
 *
 * This is an EXTRACTION, not a rewrite. Every line below came out of
 * `SettingsPopover` unchanged, including the two review fixes it carries
 * (the radio-group-aware `tabbables`, and "restore focus on an outside
 * click only when focus was actually inside"). The one addition is the
 * opt-in `documentEscape` flag; with it off — which is how `SettingsPopover`
 * calls this — the behaviour is identical to the code it replaces.
 */

/**
 * Everything inside the popover that the Tab key can reach. A radio group
 * is ONE tab stop (the checked button, or the first when none is checked),
 * which is what `tabbables` below reproduces — querying the DOM naively
 * would make the trap hand focus to an unchecked radio and let an arrow
 * key silently change the setting.
 */
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])'

export function tabbables(root: HTMLElement): HTMLElement[] {
  const seen = new Set<string>()
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return true
    if (el.checked) return true
    const group = [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.name}"]`)]
    if (group.some((r) => r.checked) || seen.has(el.name)) return false
    seen.add(el.name)
    return true
  })
}

export type Popover = {
  open: boolean
  /** What the trigger's `onClick` calls: closes-with-focus-restore, or opens. */
  toggle: () => void
  close: (restoreFocus: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  popRef: RefObject<HTMLDivElement | null>
  /** Goes on the popover element: Escape closes, Tab cycles inside. */
  handleKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
}

export function usePopover({
  onOpenChange,
  documentEscape = false,
}: {
  /** Task 13: lets the keyboard-shortcuts hook know an overlay owns the keyboard. */
  onOpenChange?: (open: boolean) => void
  /**
   * Also listen for Escape at `document` level while open, so it still
   * closes when focus has drifted out of the popover without closing it
   * (see `GameFilePopover`'s doc comment for the case that reaches this).
   * Off by default, so `SettingsPopover` keeps exactly the behaviour it
   * shipped with in Task 12.
   */
  documentEscape?: boolean
} = {}): Popover {
  const [open, setOpenState] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const close = useCallback(
    (restoreFocus: boolean) => {
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
    },
    [setOpen],
  )

  const toggle = useCallback(() => (open ? close(true) : setOpen(true)), [open, close, setOpen])

  // Focus the popover itself (not its first control) so a screen reader
  // announces its label before reading the contents.
  useEffect(() => {
    if (open) popRef.current?.focus({ preventScroll: true })
  }, [open])

  // A click anywhere else dismisses it, WITHOUT swallowing that click: the
  // board underneath is still a live game, and a move there should land.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      // Restore focus to the trigger only when it was actually inside the
      // popover (Task 12 review fix, round 1, finding 2): otherwise focus
      // was already somewhere else on the page (e.g. the board), and
      // yanking it to the trigger on every outside click would be a
      // surprise, not a courtesy.
      close(popRef.current?.contains(document.activeElement) ?? false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  // The GameEndCard fallback: an in-component `onKeyDown` never sees the
  // keystroke once focus has left the popover for `<body>`, so Escape has
  // to be caught at `document` level too. Added only while open. When focus
  // IS inside, `handleKeyDown`'s own `stopPropagation` fires first and this
  // listener never sees the event at all.
  useEffect(() => {
    if (!open || !documentEscape) return
    const onDocumentKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [open, documentEscape, close])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'Tab') return
    const pop = popRef.current
    if (!pop) return
    const nodes = tabbables(pop)
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === pop)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return { open, toggle, close, triggerRef, popRef, handleKeyDown }
}
