import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useOverflowFade } from './useOverflowFade'

/**
 * Fix round 1, item 4: zero unit coverage before this — the global
 * `ResizeObserver` stub in `test-setup.ts` is a bare no-op, so nothing
 * under vitest exercised this hook's own logic (only e2e did). A fake
 * `ResizeObserver` that records what it was asked to observe, plus
 * `Object.defineProperty` overrides for `scrollTop`/`clientHeight`/
 * `scrollHeight` (jsdom never lays anything out, so these are always 0
 * otherwise), stand in for a real scrolling column.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(_callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
}

function setMetrics(el: HTMLElement, metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { value, configurable: true })
  }
}

function makeColumn(childCount: number): HTMLDivElement {
  const el = document.createElement('div')
  for (let i = 0; i < childCount; i++) el.appendChild(document.createElement('div'))
  document.body.appendChild(el)
  return el
}

describe('useOverflowFade', () => {
  const originalResizeObserver = window.ResizeObserver

  beforeEach(() => {
    FakeResizeObserver.instances = []
    window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver
  })

  test('sets data-fade-bottom when there is more content below the current scroll position', () => {
    const el = makeColumn(2)
    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })

    renderHook(() => useOverflowFade({ current: el }))
    expect(el.hasAttribute('data-fade-bottom')).toBe(true)
  })

  // The column that never overflows must never carry the attribute — it
  // would misreport "there is more below" on a card that is simply sitting
  // there whole (this is the case the desktop e2e spec pins too).
  test('does not set it when the content already fits', () => {
    const el = makeColumn(2)
    setMetrics(el, { scrollTop: 0, clientHeight: 300, scrollHeight: 300 })

    renderHook(() => useOverflowFade({ current: el }))
    expect(el.hasAttribute('data-fade-bottom')).toBe(false)
  })

  test('clears it once scrolled all the way to the end, and it returns on scrolling back up', () => {
    const el = makeColumn(2)
    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })
    renderHook(() => useOverflowFade({ current: el }))
    expect(el.hasAttribute('data-fade-bottom')).toBe(true)

    setMetrics(el, { scrollTop: 200, clientHeight: 100, scrollHeight: 300 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(el.hasAttribute('data-fade-bottom')).toBe(false)

    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    expect(el.hasAttribute('data-fade-bottom')).toBe(true)
  })

  test('recomputes on a window resize', () => {
    const el = makeColumn(2)
    setMetrics(el, { scrollTop: 0, clientHeight: 300, scrollHeight: 300 })
    renderHook(() => useOverflowFade({ current: el }))
    expect(el.hasAttribute('data-fade-bottom')).toBe(false)

    // The column shrank (e.g. the viewport got shorter) without a scroll
    // event of its own — only `resize` tells this hook to re-check.
    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(el.hasAttribute('data-fade-bottom')).toBe(true)
  })

  // ResizeObserver targets the column's CHILDREN, not the column itself —
  // see the hook's own doc comment for why (the column's box is capped, so
  // it never resizes when a child grows; only scrollHeight does).
  test('observes every child of the column with ResizeObserver', () => {
    const el = makeColumn(4)
    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })
    renderHook(() => useOverflowFade({ current: el }))

    const ro = FakeResizeObserver.instances[0]
    if (!ro) throw new Error('no ResizeObserver was constructed')
    expect(ro.observed).toHaveLength(4)
    expect(ro.observed).toEqual([...el.children])
  })

  // Red if the effect's cleanup is dropped: a leaked scroll/resize
  // listener or a live ResizeObserver on an element the component has
  // moved on from.
  test('tears down its scroll listener, its resize listener, and disconnects the ResizeObserver on unmount', () => {
    const el = makeColumn(2)
    setMetrics(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 })
    const removeElementListener = vi.spyOn(el, 'removeEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useOverflowFade({ current: el }))
    const ro = FakeResizeObserver.instances[0]
    if (!ro) throw new Error('no ResizeObserver was constructed')

    unmount()

    expect(removeElementListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(ro.disconnect).toHaveBeenCalledTimes(1)

    removeElementListener.mockRestore()
    removeWindowListener.mockRestore()
  })

  test('does nothing when the ref has no element yet', () => {
    expect(() => renderHook(() => useOverflowFade({ current: null }))).not.toThrow()
    expect(FakeResizeObserver.instances).toHaveLength(0)
  })
})
