import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NewGameControl } from './NewGameControl'

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

/**
 * Fix round 1, item 4: zero unit coverage before this — the global
 * `window.matchMedia` stub in `test-setup.ts` always reports
 * `matches: false`, so `NewGameControl`'s mobile branch (the trigger +
 * popover shell) never ran under vitest at all. That gap is exactly how
 * item 2's resize-strands-the-popover regression shipped in the first
 * place: nothing here exercised the branch it lived in. A controllable
 * fake `MediaQueryList`, forced mobile-or-not per test and flippable
 * mid-test via its own `change` event, stands in for a real resize.
 */
function fakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: '',
    addEventListener: vi.fn((_type: 'change', cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: 'change', cb: () => void) => listeners.delete(cb)),
  }
  return {
    mql: mql as unknown as MediaQueryList,
    set: (next: boolean) => {
      matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

/** The real click sequence (`usePopover`'s outside-click dismissal listens
 * for `pointerdown`, not `click` alone) — same helper as
 * `GameFilePopover.test.tsx`. */
function press(el: HTMLElement) {
  fireEvent.pointerDown(el)
  fireEvent.click(el)
}

const noop = () => {}
const baseHandlers = {
  onModeChange: noop,
  onLevelChange: noop,
  onTimeControlChange: noop,
  onColorChange: noop,
  onStart: vi.fn(),
}

function renderControl(onOpenChange = vi.fn()) {
  render(
    <NewGameControl
      mode="two-player"
      level={1}
      timeControlId="untimed"
      color="white"
      engineAvailable={false}
      onOpenChange={onOpenChange}
      {...baseHandlers}
    />,
  )
  return { onOpenChange }
}

describe('desktop (matchMedia reports not-mobile)', () => {
  test('renders NewGame inline, with no popover trigger anywhere', () => {
    // The default test-setup.ts stub already reports `matches: false` —
    // exercised here explicitly rather than relied on implicitly.
    window.matchMedia = vi.fn(() => fakeMatchMedia(false).mql)
    renderControl()

    expect(screen.getByTestId('mode')).toBeInTheDocument()
    expect(screen.queryByTestId('new-game-toggle')).toBeNull()
    expect(screen.queryByTestId('new-game-popover')).toBeNull()
  })
})

describe('mobile (matchMedia reports max-width: 899px)', () => {
  test('renders a trigger; opening it reveals exactly one `mode` control, never two', () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(true).mql)
    renderControl()

    const trigger = screen.getByTestId('new-game-toggle')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('mode')).toBeNull()

    press(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // Exactly one instance of `NewGame` ever mounts — rendering it inline
    // AND inside the popover at once would duplicate every data-testid
    // inside it, which is exactly what this asserts against.
    expect(screen.getAllByTestId('mode')).toHaveLength(1)
    expect(screen.getByTestId('new-game-popover')).toBeInTheDocument()
  })

  test('Escape closes it and returns focus to the trigger', () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(true).mql)
    renderControl()

    const trigger = screen.getByTestId('new-game-toggle')
    press(trigger)
    const pop = screen.getByTestId('new-game-popover')
    expect(pop).toHaveFocus()

    fireEvent.keyDown(pop, { key: 'Escape' })
    expect(screen.queryByTestId('new-game-popover')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  test('starting a game from inside the popover closes it and returns focus to the trigger', () => {
    window.matchMedia = vi.fn(() => fakeMatchMedia(true).mql)
    const onStart = vi.fn()
    render(
      <NewGameControl
        mode="two-player"
        level={1}
        timeControlId="untimed"
        color="white"
        engineAvailable={false}
        {...baseHandlers}
        onStart={onStart}
      />,
    )
    const trigger = screen.getByTestId('new-game-toggle')
    press(trigger)
    fireEvent.click(screen.getByTestId('new-game'))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('new-game-popover')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})

describe('resizing across the breakpoint (fix round 1, item 2)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Red before the `useEffect(() => { if (!mobile && open) close(false) },
  // ...)` guard in NewGameControl.tsx: the `!mobile` branch drops the
  // popover's MARKUP but never told `usePopover` it had closed, so `open`
  // (and `onOpenChange`) stayed stuck `true` — which is exactly what
  // pinned `useShortcuts`' `overlayOpen` true in the live-browser bug this
  // reproduces at the unit level.
  test('resizing past 900px while open unmounts the popover and reports onOpenChange(false)', () => {
    const { mql, set } = fakeMatchMedia(true)
    window.matchMedia = vi.fn(() => mql)
    const { onOpenChange } = renderControl()

    const trigger = screen.getByTestId('new-game-toggle')
    press(trigger)
    expect(screen.getByTestId('new-game-popover')).toBeInTheDocument()
    onOpenChange.mockClear()

    // The resize itself: the query's own `change` event flips `matches`
    // to `false`, exactly as `window.matchMedia` reports a real one.
    act(() => set(false))

    expect(screen.queryByTestId('new-game-popover')).toBeNull()
    expect(screen.queryByTestId('new-game-toggle')).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // The ordinary case — never opened — must not call onOpenChange at all
  // on a resize; the guard is specifically for "open, then no longer
  // mobile", not every mobile/desktop flip.
  test('resizing past 900px while CLOSED reports nothing', () => {
    const { mql, set } = fakeMatchMedia(true)
    window.matchMedia = vi.fn(() => mql)
    const { onOpenChange } = renderControl()

    act(() => set(false))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('mode')).toBeInTheDocument()
  })
})
