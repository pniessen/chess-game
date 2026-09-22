import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EngineTransport } from '../engine/client'

/**
 * The real EngineClient + EngineSupervisor, over hand-driven transports
 * instead of real Workers, so App's wiring of engine recovery (status text,
 * single worker under StrictMode, unmount mid-restart) is tested end to end
 * without Stockfish.
 */
interface FakeWorker {
  alive: boolean
  emit(line: string): void
  emitError(err: unknown): void
}
const workers: FakeWorker[] = []
let peakAlive = 0
const alive = () => workers.filter((w) => w.alive)

vi.mock('../engine/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/client')>()
  return {
    ...actual,
    createWorkerTransport: (): EngineTransport => {
      let onMsg: ((line: string) => void) | null = null
      let onErr: ((err: unknown) => void) | null = null
      const w: FakeWorker = {
        alive: true,
        emit: (line) => onMsg?.(line),
        emitError: (err) => onErr?.(err),
      }
      workers.push(w)
      peakAlive = Math.max(peakAlive, alive().length)
      return {
        post: () => {},
        onMessage: (cb) => {
          onMsg = cb
        },
        onError: (cb) => {
          onErr = cb
        },
        terminate: () => {
          w.alive = false
        },
      }
    },
  }
})

const { App } = await import('./App')

beforeEach(() => {
  localStorage.clear()
  workers.length = 0
  peakAlive = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('engine recovery in the app', () => {
  test('a dying worker shows "Engine restarting…", is replaced, and the message clears with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    // StrictMode's mount/cleanup/mount leaves exactly one live worker.
    expect(alive()).toHaveLength(1)
    const first = alive()[0]!
    act(() => {
      first.emit('readyok')
    })

    act(() => {
      first.emitError({ message: 'killed' })
    })
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Engine restarting…')
    expect(first.alive).toBe(false)
    expect(alive()).toHaveLength(1)
    expect(screen.queryByText(/engine is unavailable/i)).toBeNull()

    await act(async () => {
      alive()[0]!.emit('readyok')
    })
    expect(screen.queryByTestId('engine-status')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('worker error: killed')

    unmount()
    expect(alive()).toHaveLength(0)
    expect(peakAlive).toBe(1)
  })

  test('unmounting mid-restart leaves no live worker and no late warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    act(() => {
      alive()[0]!.emitError({ message: 'killed' })
    })
    const replacement = alive()[0]!
    unmount()
    expect(alive()).toHaveLength(0)
    replacement.emit('readyok')
    replacement.emitError({ message: 'late' })
    await Promise.resolve()
    expect(workers.filter((w) => w.alive)).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
    expect(peakAlive).toBe(1)
  })

  test('past the restart cap the app falls back to the existing unavailable message', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<App />)
    for (let i = 0; i < 3; i++) {
      act(() => {
        alive()[0]!.emitError({ message: `crash ${i}` })
      })
    }
    expect(alive()).toHaveLength(0)
    expect(screen.getByText('The chess engine is unavailable — playing in two-player mode only.')).toBeTruthy()
    expect(screen.queryByTestId('engine-status')).toBeNull()
  })
})
