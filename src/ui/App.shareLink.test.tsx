import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Task 14: the shareable position link, through the whole App. A scripted
 * stand-in for EngineClient — the engine is never actually exercised here,
 * every game below is two-player.
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

const TWO_PLAYER_SETUP = {
  white: { kind: 'human' },
  black: { kind: 'human' },
  timeControl: { kind: 'untimed' },
} as const

beforeEach(() => {
  localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('a shared position link with nothing else pending', () => {
  test('loads it automatically and strips the query string', async () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    window.history.pushState({}, '', `/?fen=${encodeURIComponent(fen)}&moves=${encodeURIComponent('e4 e5')}`)
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('ply-count')).toHaveTextContent('2'))
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
    expect(screen.queryByTestId('resume-banner')).toBeNull()
    expect(screen.queryByTestId('share-conflict-banner')).toBeNull()
    expect(window.location.search).toBe('')
  })
})

describe('a shared link alongside a saved in-progress game', () => {
  beforeEach(() => {
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({ v: 2, pgn: '1. d4 d5 *', setup: TWO_PLAYER_SETUP, scored: false }),
    )
    window.history.pushState(
      {},
      '',
      `/?fen=${encodeURIComponent('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')}&moves=${encodeURIComponent('e4 e5')}`,
    )
  })

  test('offers a choice instead of silently loading either one', () => {
    render(<App />)
    expect(screen.getByTestId('share-conflict-banner')).toBeInTheDocument()
    // The ordinary resume banner is suppressed while this is unresolved —
    // never two prompts at once.
    expect(screen.queryByTestId('resume-banner')).toBeNull()
  })

  test('accepting loads the shared position and leaves the saved game in storage untouched', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('share-accept'))

    await waitFor(() => expect(screen.getByTestId('move-1')).toHaveTextContent('e4'))
    expect(screen.queryByTestId('share-conflict-banner')).toBeNull()
    // The saved game is neither destroyed nor silently resumed: the
    // ordinary resume banner reappears, still offering it on top of the
    // shared position now showing.
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('chess-game:in-progress') ?? 'null')
    expect(saved?.pgn).toContain('d4')

    // And it genuinely still resumes correctly from here.
    fireEvent.click(screen.getByTestId('resume-accept'))
    await waitFor(() => expect(screen.getByTestId('move-1')).toHaveTextContent('d4'))
  })

  // Review round 1 (Task 14), Important finding: the resume banner says
  // "Your saved game is kept either way", but the scoring effect in
  // useMatchRecords (a SIBLING of the autosave effect, not gated the same
  // way) called clearInProgress() unconditionally the moment ANY match
  // finished — including the newly-loaded shared game, while the ORIGINAL
  // saved game was still sitting untouched in storage because resumeChoice
  // was deliberately left 'pending'. In-session this was invisible (the
  // resume banner's own `pendingResume` was captured at mount, before the
  // wipe), so the loss only showed up on reload — which this test proves by
  // reading storage directly rather than relying on any in-memory state.
  test('finishing the shared game does not wipe the saved game out of storage', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('share-accept'))
    await waitFor(() => expect(screen.getByTestId('move-1')).toHaveTextContent('e4'))

    // Finish the shared (now live, two-player) game without touching the
    // reappeared resume banner at all.
    fireEvent.click(screen.getByTestId('resign'))
    await waitFor(() => expect(screen.getByTestId('result')).not.toBeEmptyDOMElement())

    const saved = JSON.parse(localStorage.getItem('chess-game:in-progress') ?? 'null')
    expect(saved?.pgn).toContain('d4')
  })

  // Same root cause, older path: Task 14 didn't create this hole, it just
  // made it reachable a second way. Ignoring the resume banner entirely and
  // starting an unrelated new game must not wipe the still-unresolved save.
  test('a "New game" started while the resume offer is unresolved does not wipe it either', async () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('share-decline'))
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument()

    // Ignore the banner; start (and finish) a fresh game instead.
    fireEvent.click(screen.getByTestId('new-game'))
    fireEvent.click(document.querySelector('[data-square="e2"]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-square="e4"]') as HTMLElement)
    fireEvent.click(screen.getByTestId('resign'))
    await waitFor(() => expect(screen.getByTestId('result')).not.toBeEmptyDOMElement())

    const saved = JSON.parse(localStorage.getItem('chess-game:in-progress') ?? 'null')
    expect(saved?.pgn).toContain('d4')
  })

  test('declining falls through to the ordinary resume banner, unmodified', () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('share-decline'))

    expect(screen.queryByTestId('share-conflict-banner')).toBeNull()
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('resume-accept'))
    expect(screen.getByTestId('move-1')).toHaveTextContent('d4')
  })
})

describe('a malformed share link', () => {
  test('never throws, starts a normal game, and surfaces a dismissible message', () => {
    window.history.pushState({}, '', '/?fen=not-a-real-fen')
    expect(() => render(<App />)).not.toThrow()

    expect(screen.getByTestId('share-link-error')).toBeInTheDocument()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')

    fireEvent.click(screen.getByTestId('share-link-dismiss'))
    expect(screen.queryByTestId('share-link-error')).toBeNull()
  })
})
