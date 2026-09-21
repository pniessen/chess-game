import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { App } from './App'

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
})
