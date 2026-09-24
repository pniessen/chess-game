import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { loadHistory, loadScore } from '../../storage/storage'

/**
 * Task 6: the game-end card, through the whole App.
 *
 * A scripted stand-in for EngineClient (the same one App.reviewAccuracy.test
 * uses) makes `engineAvailable` true, so the card's "Review game" button is
 * enabled and the review flow it starts actually runs. The engine never
 * plays here: every game below is two-player.
 */
vi.mock('../../engine/client', () => ({
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

const { App } = await import('../App')

function clickSquare(container: HTMLElement, square: string) {
  fireEvent.click(container.querySelector(`[data-square="${square}"]`) as HTMLElement)
}

const SCHOLARS_MATE: Array<[string, string]> = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['f1', 'c4'], ['b8', 'c6'],
  ['d1', 'h5'], ['g8', 'f6'],
  ['h5', 'f7'],
]

function playMate(container: HTMLElement) {
  for (const [from, to] of SCHOLARS_MATE) {
    clickSquare(container, from)
    clickSquare(container, to)
  }
}

beforeEach(() => localStorage.clear())

describe('the game-end card', () => {
  // Red if the card stops appearing on a live finish, or stops using the
  // status header's own result text.
  test('appears on a live checkmate with the same result text the header shows', () => {
    const { container } = render(<App />)
    playMate(container)

    const card = screen.getByTestId('game-end-card')
    expect(card).toHaveAttribute('role', 'dialog')
    expect(screen.getByTestId('game-end-headline')).toHaveTextContent('Checkmate — White wins')
    expect(screen.getByTestId('game-end-headline')).toHaveTextContent(
      screen.getByTestId('result').textContent ?? '',
    )
    expect(screen.getByTestId('game-end-headline')).toHaveAttribute('aria-live', 'polite')
    expect(card).toHaveAttribute('aria-labelledby', 'game-end-headline')
  })

  // Red if the card ever gets in the way of the existing end-of-game work:
  // one history entry, one score, the card on top of it.
  test('the finish is still recorded exactly once, and scored once, with the card up', () => {
    const { container } = render(<App />)
    playMate(container)

    expect(screen.getByTestId('game-end-card')).toBeInTheDocument()
    expect(loadHistory()).toHaveLength(1)
    expect(loadScore()).toEqual({ wins: 1, losses: 0, draws: 0 })
  })

  // Red if a resignation (whose `status.kind` is still 'in-progress') stops
  // opening the card, or stops using `describeResult`'s wording.
  test('a resignation opens the card with the resignation wording', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    fireEvent.click(screen.getByTestId('resign'))
    expect(screen.getByTestId('game-end-headline')).toHaveTextContent('Black resigns — White wins')
  })

  // Red if the card starts firing for a game that did not end in front of
  // the user — the distinction loadMatch already draws for history.
  test('never appears for a position imported already finished', () => {
    render(<App />)
    fireEvent.change(screen.getByTestId('import-text'), {
      target: { value: '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0' },
    })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    // And importing a finished game still records nothing.
    expect(loadHistory()).toHaveLength(0)
  })

  // Red if replaying from history pops a card (load() + finishAs() in one
  // handler) or adds a second history entry.
  test('never appears when a finished game is replayed from history', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    fireEvent.click(screen.getByTestId('resign'))
    fireEvent.click(screen.getByTestId('game-end-dismiss'))
    expect(loadHistory()).toHaveLength(1)

    fireEvent.click(screen.getByTestId('tab-history'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Replay' })[0]!)

    expect(screen.getByTestId('result')).toHaveTextContent('Black resigns')
    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    expect(loadHistory()).toHaveLength(1)
  })

  // Red if Escape stops closing the card, or focus is left nowhere.
  test('Escape dismisses it and focus lands on a real control', () => {
    const { container } = render(<App />)
    playMate(container)
    expect(screen.getByTestId('game-end-card')).toHaveFocus()

    fireEvent.keyDown(screen.getByTestId('game-end-card'), { key: 'Escape' })
    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('new-game')).toHaveFocus()
  })

  // Red if the opener is captured again on Strict Mode's SECOND effect pass,
  // when the card itself already holds focus: restoring to the card that is
  // about to unmount drops focus onto <body>. (The real app renders inside
  // StrictMode — see main.tsx.)
  test('under StrictMode, dismissing still lands focus on a real control', () => {
    const { container } = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    playMate(container)
    fireEvent.keyDown(screen.getByTestId('game-end-card'), { key: 'Escape' })
    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('new-game')).toHaveFocus()
  })

  // Red if Tab can walk out of the card while it is open.
  test('Tab wraps round inside the card', () => {
    const { container } = render(<App />)
    playMate(container)
    const card = screen.getByTestId('game-end-card')

    // Backwards off the card itself lands on the last button…
    fireEvent.keyDown(card, { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('game-end-dismiss')).toHaveFocus()
    // …and forwards off the last button comes back to the first.
    fireEvent.keyDown(card, { key: 'Tab' })
    expect(screen.getByTestId('game-end-rematch')).toHaveFocus()
  })

  // Red if Rematch stops restarting the same setup, or leaves the card up.
  test('Rematch starts a fresh game with the setup that just finished', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByTestId('time-control'), { target: { value: 'blitz-5-3' } })
    fireEvent.click(screen.getByTestId('new-game'))
    playMate(container)
    // Change the panel's mind after the game: the rematch must ignore it.
    fireEvent.change(screen.getByTestId('time-control'), { target: { value: 'untimed' } })

    fireEvent.click(screen.getByTestId('game-end-rematch'))

    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')
    expect(screen.getByTestId('result')).toBeEmptyDOMElement()
    // Still the Blitz 5+3 clock the finished game was played with, not the
    // "No clock" the panel now says.
    expect(screen.getByTestId('clock-w')).toHaveTextContent(/^(5:00|4:59)$/)
    expect(loadHistory()).toHaveLength(1)
  })

  // Red if "Review game" reimplements the review instead of running the
  // existing flow (which is what fills the history entry's accuracy).
  test('Review game runs the existing review flow and shows the Review tab', async () => {
    const { container } = render(<App />)
    playMate(container)
    expect(loadHistory()[0]?.accuracy).toBeNull()

    fireEvent.click(screen.getByTestId('game-end-review'))

    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('tab-review')).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('accuracy-w')).toBeInTheDocument(), { timeout: 5000 })
    expect(loadHistory()[0]?.accuracy).not.toBeNull()
  })

  // Red if Export PGN stops reusing the panel's export (same blob, same
  // filename), or if exporting closes the card.
  test('Export PGN downloads the game and leaves the card up', () => {
    const { container } = render(<App />)
    playMate(container)

    const createObjectURL = vi.fn(() => 'blob:end-card')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clicked: string[] = []
    const realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    }
    try {
      fireEvent.click(screen.getByTestId('game-end-export'))
    } finally {
      HTMLAnchorElement.prototype.click = realClick
      vi.unstubAllGlobals()
    }

    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatch(/^chess-\d{4}-\d{2}-\d{2}\.pgn$/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:end-card')
    expect(screen.getByTestId('game-end-card')).toBeInTheDocument()
  })

  // Red if an undo leaves the card standing over a position that is live again.
  test('undoing out of the finish takes the card away', () => {
    const { container } = render(<App />)
    playMate(container)
    expect(screen.getByTestId('game-end-card')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('undo'))
    expect(screen.queryByTestId('game-end-card')).not.toBeInTheDocument()
  })
})
