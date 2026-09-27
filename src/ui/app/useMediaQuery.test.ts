import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

/**
 * Fix round 1, item 4: this hook (added in the mobile pass, to decide
 * whether `NewGameControl` renders `NewGame` inline or as a popover) had
 * zero unit coverage — the global `window.matchMedia` stub in
 * `test-setup.ts` always reports `matches: false`, so nothing under
 * vitest ever exercised its `change`-listener path at all. These use a
 * controllable fake `MediaQueryList` instead of that stub, restored after
 * every test.
 */
function fakeMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const addEventListener = vi.fn((_type: 'change', cb: () => void) => listeners.add(cb))
  const removeEventListener = vi.fn((_type: 'change', cb: () => void) => listeners.delete(cb))
  const mql = { get matches() { return matches }, media: '', addEventListener, removeEventListener }
  return {
    mql: mql as unknown as MediaQueryList,
    addEventListener,
    removeEventListener,
    /** Fires every registered `change` listener, the way a real browser would. */
    set: (next: boolean) => {
      matches = next
      listeners.forEach((cb) => cb())
    },
    listenerCount: () => listeners.size,
  }
}

describe('useMediaQuery', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  test('reflects matchMedia(query).matches from the very first render', () => {
    const { mql } = fakeMatchMedia(true)
    window.matchMedia = vi.fn(() => mql)

    const { result } = renderHook(() => useMediaQuery('(max-width: 899px)'))
    expect(result.current).toBe(true)
  })

  test('updates when the query\'s own change event fires', () => {
    const { mql, set } = fakeMatchMedia(false)
    window.matchMedia = vi.fn(() => mql)

    const { result } = renderHook(() => useMediaQuery('(max-width: 899px)'))
    expect(result.current).toBe(false)

    act(() => set(true))
    expect(result.current).toBe(true)

    act(() => set(false))
    expect(result.current).toBe(false)
  })

  // Red if the hook's cleanup is dropped: a leaked listener would keep
  // firing `setState` on an unmounted component (a React warning under
  // strict/dev mode) and would leave a live subscription for as long as
  // the fake `MediaQueryList` itself lives.
  test('unsubscribes its change listener on unmount', () => {
    const { mql, addEventListener, removeEventListener, listenerCount } = fakeMatchMedia(false)
    window.matchMedia = vi.fn(() => mql)

    const { unmount } = renderHook(() => useMediaQuery('(max-width: 899px)'))
    expect(listenerCount()).toBe(1)

    unmount()
    expect(listenerCount()).toBe(0)
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith('change', addEventListener.mock.calls[0]?.[1])
  })

  test('re-subscribes against the new query when the query string changes', () => {
    const a = fakeMatchMedia(false)
    const b = fakeMatchMedia(true)
    window.matchMedia = vi.fn((query: string) => (query === 'a' ? a.mql : b.mql))

    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: 'a' },
    })
    expect(result.current).toBe(false)
    expect(a.listenerCount()).toBe(1)

    rerender({ query: 'b' })
    expect(result.current).toBe(true)
    expect(a.listenerCount()).toBe(0)
    expect(b.listenerCount()).toBe(1)
  })
})
