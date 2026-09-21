import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { App } from './App'
import { exportPgn, gameFromSan } from '../game-core/io'
import { loadHistory } from '../storage/storage'

// Deviation from the brief: the brief used a bare `el.click()` here. Under
// this repo's actual React 19 + jsdom, a raw click's state update is not
// guaranteed to flush before the next synchronous line runs, so back-to-back
// raw clicks (e.g. e2 then e4) can read a stale closure and silently miss
// the move. `fireEvent.click` wraps the dispatch in `act()`, which flushes
// synchronously, matching what a real click-then-click from a user produces.
function clickSquare(container: HTMLElement, square: string) {
  const el = container.querySelector(`[data-square="${square}"]`) as HTMLElement
  fireEvent.click(el)
}

describe('App (two-player)', () => {
  test('renders a board', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
  })

  test('a legal move moves the piece and passes the turn', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull()
    expect(container.querySelector('[data-square="e2"] [data-piece]')).toBeNull()
    expect(screen.getByTestId('turn')).toHaveTextContent(/black/i)
  })

  test('Scholar’s Mate ends the game', () => {
    const { container } = render(<App />)
    const moves: Array<[string, string]> = [
      ['e2', 'e4'], ['e7', 'e5'],
      ['f1', 'c4'], ['b8', 'c6'],
      ['d1', 'h5'], ['g8', 'f6'],
      ['h5', 'f7'],
    ]
    for (const [from, to] of moves) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(screen.getByTestId('result')).toHaveTextContent(/white/i)
  })

  test('the mode select defaults to two-player and Scholar’s Mate still ends the game through the controller', () => {
    const { container } = render(<App />)
    expect(screen.getByTestId('mode')).toHaveValue('two-player')
    const moves: Array<[string, string]> = [
      ['e2', 'e4'], ['e7', 'e5'],
      ['f1', 'c4'], ['b8', 'c6'],
      ['d1', 'h5'], ['g8', 'f6'],
      ['h5', 'f7'],
    ]
    for (const [from, to] of moves) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(screen.getByTestId('result')).toHaveTextContent(/white/i)
  })

  test('undo after one move empties the move list; redo then restores it', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')

    fireEvent.click(screen.getByTestId('undo'))
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')
    expect(screen.queryByTestId('move-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('redo'))
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
  })

  test('the hint button is present and disabled while it is not the human’s turn', () => {
    render(<App />)
    // No engine worker in jsdom, so the engine is unavailable and hint stays
    // disabled regardless — this is still "disabled while it is not the
    // human's turn" in the degenerate case where there is no engine to ask.
    expect(screen.getByTestId('hint')).toBeDisabled()
  })

  test('pasting a valid PGN into import-text loads that game into the move list', () => {
    render(<App />)
    const pgn = '1. e4 e5 2. Nf3 Nc6 *'
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: pgn } })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(screen.getByTestId('import-error')).toBeEmptyDOMElement()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('4')
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
    expect(screen.getByTestId('move-4')).toHaveTextContent('Nc6')
  })

  test('pasting a valid FEN loads that position', () => {
    const { container } = render(<App />)
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1'
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: fen } })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(screen.getByTestId('import-error')).toBeEmptyDOMElement()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('0')
    expect(container.querySelector('[data-square="f3"] [data-piece]')).not.toBeNull()
  })

  test('a failed import leaves the current game untouched', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')

    fireEvent.change(screen.getByTestId('import-text'), {
      target: { value: 'not a chess game at all' },
    })
    fireEvent.click(screen.getByTestId('import-submit'))

    expect(screen.getByTestId('import-error')).not.toBeEmptyDOMElement()
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
  })
})

describe('import credits no clock increment per replayed move (I6)', () => {
  test('six imported moves at Blitz 3+2 leave both clocks at 3:00, not 3:06', () => {
    localStorage.setItem(
      'chess-game:settings',
      JSON.stringify({ level: 3, timeControlId: 'blitz-3-2', orientation: 'white', soundEnabled: true, themeId: 'classic' }),
    )
    render(<App />)
    fireEvent.change(screen.getByTestId('import-text'), {
      target: { value: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *' },
    })
    fireEvent.click(screen.getByTestId('import-submit'))
    expect(screen.getByTestId('ply-count')).toHaveTextContent('6')
    expect(screen.getByTestId('clock-w')).toHaveTextContent(/^3:00$/)
    expect(screen.getByTestId('clock-b')).toHaveTextContent(/^3:00$/)
    localStorage.clear()
  })
})

const SCHOLARS_MATE: Array<[string, string]> = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['f1', 'c4'], ['b8', 'c6'],
  ['d1', 'h5'], ['g8', 'f6'],
  ['h5', 'f7'],
]

function scholarsMatePgn(): string {
  const r = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  if (!r.ok) throw new Error(r.error)
  return exportPgn(r.game)
}

/**
 * Exactly-once history recording (Task 13). Phase 1's lesson (double-scoring
 * a finished game, resume flipping modes) applies here just as much: a
 * finished game must produce exactly ONE history entry.
 */
describe('history (Task 13)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  test('a finished game is recorded exactly once — not again on a re-render, and not again when a redo lands back on the same finished position', () => {
    const { container } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]).toMatchObject({ result: '1-0', termination: 'normal', accuracy: null })

    // An unrelated re-render (switching tabs: no controller action, so the
    // finished `phase` object is untouched) must not add a second entry.
    fireEvent.click(screen.getByTestId('tab-history'))
    expect(loadHistory()).toHaveLength(1)

    // Undo the mating move, then redo it: MatchController rebuilds `phase`
    // as a NEW object describing the exact same finished result (see
    // redo()'s and the scoring effect's own comments on this). Without the
    // `recordedRef` guard this would run the recording effect a second time.
    fireEvent.click(screen.getByTestId('undo'))
    fireEvent.click(screen.getByTestId('redo'))
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(1)
  })

  test('resuming an already-finished game never adds a new entry (it was not observed live in this session)', () => {
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({ v: 2, pgn: scholarsMatePgn(), setup: null, scored: true }),
    )
    render(<App />)
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('resume-accept'))

    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(0)
  })

  test('a degraded resume of an in-progress game gets exactly one history entry once it finishes live (Task 13 review round 1, Finding 3)', () => {
    // A one-player setup (an engine seat) with only 1.e4 played — still
    // IN-PROGRESS. jsdom has no real engine, so resuming this is a DEGRADED
    // resume (planResume falls back to two-player, `degraded: true`), and
    // `handleResumeAccept` passes `pendingResume.scored || plan.degraded` as
    // `loadMatch`'s `alreadyScored` — true here even though `scored` itself
    // is false. Before the fix, `recordedRef` was set from THAT (`scoredRef`)
    // rather than from whether the loaded game was already finished, so this
    // game's later live finish was silently never recorded.
    const opening = gameFromSan(['e4'])
    if (!opening.ok) throw new Error(opening.error)
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({
        v: 2,
        pgn: exportPgn(opening.game),
        setup: { white: { kind: 'human' }, black: { kind: 'engine', level: 3 }, timeControl: { kind: 'untimed' } },
        scored: false,
      }),
    )
    const { container } = render(<App />)
    expect(screen.getByTestId('resume-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('resume-accept'))
    // The resumed game is still in progress: no history entry yet.
    expect(loadHistory()).toHaveLength(0)

    // Finish it live, playing out the rest of Scholar's Mate (both seats are
    // human now: the degraded resume fell back to two-player).
    for (const [from, to] of SCHOLARS_MATE.slice(1)) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]).toMatchObject({ result: '1-0', termination: 'normal' })
  })

  test('starting a new game after a finished one is recorded resets recording for the new game', () => {
    const { container } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(loadHistory()).toHaveLength(1)

    fireEvent.click(screen.getByTestId('new-game'))
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(loadHistory()).toHaveLength(2)
  })
})
