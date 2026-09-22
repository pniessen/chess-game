import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { EngineHealth } from '../../engine/supervisor'
import { useEngineHealth, type HealthSource } from './useEngineHealth'

function fakeSource(initial: EngineHealth): HealthSource & { set(h: EngineHealth): void; listeners: number } {
  let state = initial
  let listeners: Array<(h: EngineHealth) => void> = []
  return {
    health: () => state,
    onHealth(cb) {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    set(h) {
      state = h
      for (const l of listeners) l(h)
    },
    get listeners() {
      return listeners.length
    },
  }
}

describe('useEngineHealth', () => {
  test('no engine at all: ok health, but unavailable when construction failed', () => {
    const { result } = renderHook(() => useEngineHealth(null, false))
    expect(result.current.engineHealth).toEqual({ kind: 'ok' })
    expect(result.current.engineAvailable).toBe(false)
  })

  // Breaks if a restart is folded into "unavailable" (it must only show the status line).
  test('restarting keeps the engine available; dead makes it unavailable', () => {
    const src = fakeSource({ kind: 'ok' })
    const { result } = renderHook(() => useEngineHealth(src, true))
    expect(result.current.engineAvailable).toBe(true)
    act(() => src.set({ kind: 'restarting', reason: 'crash' }))
    expect(result.current.engineHealth.kind).toBe('restarting')
    expect(result.current.engineAvailable).toBe(true)
    act(() => src.set({ kind: 'dead', reason: 'budget spent' }))
    expect(result.current.engineAvailable).toBe(false)
  })

  test('unsubscribes on unmount', () => {
    const src = fakeSource({ kind: 'ok' })
    const { unmount } = renderHook(() => useEngineHealth(src, true))
    expect(src.listeners).toBe(1)
    unmount()
    expect(src.listeners).toBe(0)
  })
})
