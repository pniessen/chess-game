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
   *
   * Belt and braces since the focus guard above: with focus never allowed
   * to rest on `<body>`, the React `onKeyDown` should always see the
   * keystroke. It stays on for the popover whose contents unmount under
   * it, because that is the one with something to be wrong about.
   *
   * Off by default. `SettingsPopover` leaves it off and is safe doing so
   * for a concrete reason, not merely for continuity — see its own note.
   */
  documentEscape?: boolean
} = {}): Popover {
  const [open, setOpenState] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  // Set the instant `close` is called, cleared when the popover next
  // opens. The focus guard below reads it so that it never fights a
  // popover on its way out: `close` may move focus to the trigger, or
  // deliberately leave it where it is, and either way React has not
  // unmounted the popover yet.
  const closingRef = useRef(false)

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const close = useCallback(
    (restoreFocus: boolean) => {
      closingRef.current = true
      setOpen(false)
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
    },
    [setOpen],
  )

  const toggle = useCallback(() => (open ? close(true) : setOpen(true)), [open, close, setOpen])

  // Focus the popover itself (not its first control) so a screen reader
  // announces its label before reading the contents.
  useEffect(() => {
    if (!open) return
    closingRef.current = false
    popRef.current?.focus({ preventScroll: true })
  }, [open])

  /**
   * Fix round 1: keep focus from ever resting on `<body>` while the
   * popover is open.
   *
   * The Tab trap is a React `onKeyDown` on the popover element, so it is
   * completely inert the moment focus is not inside the popover — and
   * focus CAN leave without the popover closing, because the contents
   * unmount underneath it (GameIO's `share-manual` box, torn down by an
   * engine move). In that state Tab walks the page behind and can reach
   * the OTHER popover's trigger, which opens a second popover with a
   * second live focus trap. Chromium and Firefox both happen to resume
   * tab navigation adjacent to the removed node and land back inside, but
   * that is their focus-navigation policy, not a guarantee this code
   * makes, and it is not something to rely on.
   *
   * Pulling focus back to the popover whenever it lands on `<body>` shuts
   * that down at the root: there is no inert state left for Tab (or
   * Escape) to slip through. `documentEscape` is then belt and braces
   * rather than the only line of defence, and it stays.
   *
   * `focusout` bubbles, so one listener on the popover covers everything
   * inside it. Two conditions have to hold before it acts, and both
   * matter:
   *
   *  - `relatedTarget === null`. On an ordinary move — a Tab, a click on
   *    the next control — `relatedTarget` is the element about to receive
   *    focus, and there is nothing to fix. Only a `focusout` going
   *    NOWHERE is the case this guard is for. Checking
   *    `document.activeElement` instead is not enough: the browser
   *    dispatches `focusout` before `focusin`, and it runs a microtask
   *    checkpoint between the two, so a microtask queued here sees
   *    `document.activeElement === document.body` in the middle of a
   *    perfectly normal Tab and would drag focus straight back.
   *  - and then, in that microtask, `<body>` really does still hold
   *    focus — `blur()` and a removed node both land there, but a
   *    `relatedTarget`-less `focusout` can still be followed by the
   *    browser placing focus itself.
   */
  useEffect(() => {
    if (!open) return
    const pop = popRef.current
    if (!pop) return
    const onFocusOut = (e: FocusEvent) => {
      // Focus is on its way to a real element: let it go.
      if (e.relatedTarget !== null) return
      queueMicrotask(() => {
        // Never yank focus back into a popover that is closing or gone:
        // `close` has its own opinion about where focus belongs.
        if (closingRef.current || !pop.isConnected) return
        if (document.activeElement === document.body) pop.focus({ preventScroll: true })
      })
    }
    pop.addEventListener('focusout', onFocusOut)
    return () => pop.removeEventListener('focusout', onFocusOut)
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
