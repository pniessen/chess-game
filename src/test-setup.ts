import '@testing-library/jest-dom/vitest'

/**
 * Task 6 (mobile pass): jsdom implements neither `Element.scrollIntoView`
 * nor `window.matchMedia` nor `ResizeObserver` — real browser APIs this
 * task's new code depends on (MoveList's auto-scroll to the current ply;
 * `useMediaQuery`, which decides whether New game renders inline or as a
 * popover; `useOverflowFade`'s scroll-affordance on `.left-column`). Every
 * component test that mounts `App`, `MoveList` or `NewGameControl` would
 * otherwise throw at render/effect time on a method that simply does not
 * exist in this environment — not a behaviour under test, so a no-op stub
 * (for `scrollIntoView`) and a "never matches, no-op subscription" stub
 * (for `matchMedia`/`ResizeObserver`) are enough: what each does is
 * covered by the real thing in tests/e2e/, in a real browser.
 */
// Some suites (server/, netlify/, scripts/) run under vitest's `node`
// environment (per-file `@vitest-environment` docblocks), where `window`
// itself does not exist — this file's setupFiles entry still runs for
// them, so every stub below has to be reached only under jsdom.
if (typeof window !== 'undefined') {
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }

  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }

  // Fix round 1: `NewGameControl`'s `window.scrollTo({ top: 0 })` (the
  // scroll-anchoring fix — see task-6-report.md) logs a jsdom "not
  // implemented" warning without this; harmless, but noisy the moment a
  // component test actually starts a game from the popover. jsdom DOES
  // define `window.scrollTo` (so it can't be feature-detected by
  // presence) — it just throws its "not implemented" warning when called;
  // a plain no-op replacement is simplest.
  window.scrollTo = () => {}
}
