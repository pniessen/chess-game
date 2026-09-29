import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useClaudeBudget } from './useClaudeBudget'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('useClaudeBudget', () => {
  test('fetches nothing while the Claude mode is not selected', () => {
    const fetch = vi.fn()
    const { result } = renderHook(() => useClaudeBudget(false, fetch))
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  test('fetches the budget when the mode is selected', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ budgetLeftUsd: 7.25 }))
    const { result } = renderHook(() => useClaudeBudget(true, fetch))
    await waitFor(() => expect(result.current).toBe(7.25))
    expect(fetch).toHaveBeenCalledWith('/api/game/budget')
  })

  test('null on failure: no key (503) or no local server at all', async () => {
    const noKey = vi.fn().mockResolvedValue(json({ error: { kind: 'no-key' } }, 503))
    const a = renderHook(() => useClaudeBudget(true, noKey))
    await waitFor(() => expect(a.result.current).toBeNull())
    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const b = renderHook(() => useClaudeBudget(true, down))
    await waitFor(() => expect(b.result.current).toBeNull())
  })

  test('re-fetches each time the mode is selected again', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ budgetLeftUsd: 3 }))
    const { result, rerender } = renderHook(({ on }) => useClaudeBudget(on, fetch), { initialProps: { on: true } })
    await waitFor(() => expect(result.current).toBe(3))
    rerender({ on: false })
    rerender({ on: true })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })
})
