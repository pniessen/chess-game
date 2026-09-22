import { StrictMode, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EngineTransport } from '../../engine/client'

/** Hand-driven transports standing in for Stockfish workers, so liveness can be counted. */
const workers: Array<{ alive: boolean }> = []
let peakAlive = 0
const aliveCount = () => workers.filter((w) => w.alive).length

vi.mock('../../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/client')>()
  return {
    ...actual,
    createWorkerTransport: (): EngineTransport => {
      const w = { alive: true }
      workers.push(w)
      peakAlive = Math.max(peakAlive, aliveCount())
      return {
        post: () => {},
        onMessage: () => {},
        onError: () => {},
        terminate: () => {
          w.alive = false
        },
      }
    },
  }
})

const { useControllerBundle } = await import('./useControllerBundle')

beforeEach(() => {
  localStorage.clear()
  workers.length = 0
  peakAlive = 0
})

describe('useControllerBundle', () => {
  // Breaks if the bundle is built in a useState initializer (StrictMode
  // double-render orphans a worker) or its cleanup stops disposing.
  test('under StrictMode at most one worker is ever alive, and unmount terminates it', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result, unmount } = renderHook(() => useControllerBundle(), { wrapper })
    expect(result.current).not.toBeNull()
    expect(result.current?.engineAvailable).toBe(true)
    expect(peakAlive).toBe(1)
    expect(aliveCount()).toBe(1)
    unmount()
    expect(aliveCount()).toBe(0)
  })

  test('the match is already started (two humans), so the board is playable at once', () => {
    const { result } = renderHook(() => useControllerBundle())
    const phase = result.current?.controller.snapshot().phase
    expect(phase?.kind).toBe('awaiting-human')
  })
})
