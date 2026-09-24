import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useEngineLoading, type ReadySource } from './useEngineLoading'

function deferred(): { source: ReadySource; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { source: { waitReady: () => promise }, resolve, reject }
}

describe('useEngineLoading', () => {
  test('no engine at all: never loading', () => {
    const { result } = renderHook(() => useEngineLoading(null))
    expect(result.current).toBe(false)
  })

  // Breaks if the hook stops claiming "loading" for the handshake window.
  test('loading until the engine\'s first handshake resolves', async () => {
    const { source, resolve } = deferred()
    const { result } = renderHook(() => useEngineLoading(source))
    expect(result.current).toBe(true)

    await act(async () => {
      resolve()
    })
    expect(result.current).toBe(false)
  })

  // A worker that dies before ever finishing its handshake stops "loading"
  // too — useEngineHealth's 'restarting'/'dead' takes over from there.
  test('a rejection (the first worker dying) also clears loading', async () => {
    const { source, reject } = deferred()
    const { result } = renderHook(() => useEngineLoading(source))
    expect(result.current).toBe(true)

    await act(async () => {
      reject(new Error('worker crashed'))
    })
    expect(result.current).toBe(false)
  })

  test('never sets state after unmount', async () => {
    const { source, resolve } = deferred()
    const { unmount } = renderHook(() => useEngineLoading(source))
    unmount()
    // No React "update on an unmounted component" warning is the assertion
    // here — resolving after unmount must be a silent no-op.
    await act(async () => {
      resolve()
    })
  })
})
