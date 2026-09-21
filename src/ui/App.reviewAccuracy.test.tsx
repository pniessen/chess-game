import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { loadHistory } from '../storage/storage'

/**
 * Task 13 review, round 1, Finding 1: a review must never attach its
 * accuracy to the wrong history entry. This needs a genuinely available
 * engine (App.test.tsx's default jsdom environment has none, so `Review` is
 * always disabled there) — a scripted stand-in for EngineClient, exactly
 * like resume.test.tsx's, makes `engineAvailable` true and every `analyze()`
 * call resolve immediately. The actual evals/accuracy numbers don't matter
 * to these tests, only which history entry (if any) ends up holding them.
 */
vi.mock('../engine/client', () => ({
  createWorkerTransport: () => ({}),
  EngineClient: class {
    waitReady() {
      return Promise.resolve()
    }
    configure() {}
    newGame() {}
    setPosition() {}
    search() {
      return Promise.resolve({ best: '(none)', lines: [] })
    }
    stop() {}
    dispose() {}
    onDead() {
      return () => {}
    }
  },
}))

const { App } = await import('./App')

function clickSquare(container: HTMLElement, square: string) {
  const el = container.querySelector(`[data-square="${square}"]`) as HTMLElement
  fireEvent.click(el)
}

const SCHOLARS_MATE: Array<[string, string]> = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['f1', 'c4'], ['b8', 'c6'],
  ['d1', 'h5'], ['g8', 'f6'],
  ['h5', 'f7'],
]

beforeEach(() => localStorage.clear())

describe('review accuracy is attached to the right history entry (Task 13 review round 1, Finding 1)', () => {
  test('reviewing the recorded game itself still fills its accuracy (positive path)', async () => {
    const { container } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]?.accuracy).toBeNull()

    fireEvent.click(screen.getByTestId('tab-review'))
    fireEvent.click(screen.getByTestId('review-start'))
    await waitFor(() => expect(screen.getByTestId('accuracy-w')).toBeInTheDocument(), { timeout: 5000 })

    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]?.accuracy).not.toBeNull()
  })

  test('undo -> a different line -> finish B (not recorded) -> reviewing B never overwrites A’s accuracy', async () => {
    const { container } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(loadHistory()).toHaveLength(1)
    const aId = loadHistory()[0]?.id
    expect(loadHistory()[0]?.accuracy).toBeNull()

    // Undo the mating move (Qxf7#): the LIVE `Game` object is now back to 6
    // plies (...Nf6), White to move — the SAME `Game` instance A was
    // recorded against (MatchController mutates one Game in place). Finish a
    // DIFFERENT game, B, by resignation instead of replaying Qxf7#. B is
    // never recorded: `recordedRef`, once set by A's finish, is reset only
    // by startMatch/loadMatch, never by undo — exactly the "not recorded,
    // recordedRef still true" premise the review's binding names.
    fireEvent.click(screen.getByTestId('undo'))
    fireEvent.click(screen.getByTestId('resign'))
    expect(screen.getByTestId('result')).toHaveTextContent(/resign/i)
    expect(loadHistory()).toHaveLength(1) // B was not recorded as its own entry

    fireEvent.click(screen.getByTestId('tab-review'))
    fireEvent.click(screen.getByTestId('review-start'))
    await waitFor(() => expect(screen.getByTestId('accuracy-w')).toBeInTheDocument(), { timeout: 5000 })

    // A's stored entry — a DIFFERENT game's PGN — must be untouched by B's review.
    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]?.id).toBe(aId)
    expect(loadHistory()[0]?.accuracy).toBeNull()
  })
})
