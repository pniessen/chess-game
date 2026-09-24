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
    // Task 5: this settles useEngineLoading's initial promise (a
    // microtask), which — unlike everything else in this test up to here —
    // a plain sync act() does not wait out.
    await act(async () => {
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

  // Task 5: the very first handshake, before the app has ever seen a crash.
  test('before the first handshake, the status area and the Hint button show loading — and it clears', async () => {
    render(<App />)
    expect(alive()).toHaveLength(1)

    expect(screen.getByTestId('engine-status')).toHaveTextContent('Loading engine…')
    const hint = screen.getByTestId('hint')
    expect(hint).toBeDisabled()
    expect(hint.className).toContain('hint-loading')

    await act(async () => {
      alive()[0]!.emit('readyok')
    })

    expect(screen.queryByTestId('engine-status')).toBeNull()
    expect(hint.className).not.toContain('hint-loading')
    // Two-player, White to move, live: nothing else disables it once ready.
    expect(hint).toBeEnabled()
  })

  // Task 5: a worker that dies before its first handshake ever finishes —
  // "loading" must hand off to "restarting" (via useEngineHealth), not get
  // stuck claiming "loading" forever or show both at once.
  test('a worker dying mid-handshake shows "Engine restarting…", not a stuck "Loading engine…"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<App />)
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Loading engine…')

    await act(async () => {
      alive()[0]!.emitError({ message: 'killed before ready' })
    })
    expect(screen.getByTestId('engine-status')).toHaveTextContent('Engine restarting…')
  })
})
