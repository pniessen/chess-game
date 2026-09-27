import '@testing-library/jest-dom/vitest'

/**
 * Task 6 (mobile pass): jsdom implements neither `window.matchMedia` nor
 * `ResizeObserver` — real browser APIs this task's new code depends on
 * (`useMediaQuery`, which decides whether New game renders inline or as a
 * popover; `useOverflowFade`'s scroll-affordance on `.left-column`). Every
 * component test that mounts `App` or `NewGameControl` would otherwise
 * throw at render/effect time on a method that simply does not exist in
 * this environment — not a behaviour under test, so a "never matches,
 * no-op subscription" stub for each is enough: what each does is covered
 * by the real thing in tests/e2e/, in a real browser.
 *
 * Task 7: the same reasoning used to cover a third stub,
 * `Element.scrollIntoView` — MoveList's first version of the auto-scroll
 * used it, but fix round 1 (see MoveList.tsx's own comment) replaced it
 * with a direct `list.scrollTop` write specifically to stop walking
 * ancestor scroll containers, and nothing under src/ calls
 * `scrollIntoView` any more (confirmed with a repo-wide grep before
 * removing this). Left in place, it would be actively misleading: a
 * future regression that reintroduced `scrollIntoView` would render fine
 * under vitest/jsdom (silently no-op'd here) and only fail in a real
 * browser, in tests/e2e/ — exactly backwards from what a unit-test stub
 * is for.
 */
// Some suites (server/, netlify/, scripts/) run under vitest's `node`
// environment (per-file `@vitest-environment` docblocks), where `window`
// itself does not exist — this file's setupFiles entry still runs for
// them, so every stub below has to be reached only under jsdom.
if (typeof window !== 'undefined') {
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
