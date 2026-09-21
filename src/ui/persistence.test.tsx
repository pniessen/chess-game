import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { App } from './App'

// Deviation from the brief: the brief used a bare `el.click()` here. As
// App.test.tsx already found, under this repo's React 19 + jsdom, a raw
// click's state update is not guaranteed to flush before the next
// synchronous line runs, so back-to-back raw clicks (e.g. e2 then e4) can
// read a stale closure and silently miss the move. `fireEvent.click` wraps
// the dispatch in `act()`, which flushes synchronously, matching what a
// real click-then-click from a user produces.
function clickSquare(container: HTMLElement, square: string) {
  const el = container.querySelector(`[data-square="${square}"]`) as HTMLElement
  fireEvent.click(el)
}

const SCHOLARS_MATE: Array<[string, string]> = [
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['f1', 'c4'],
  ['b8', 'c6'],
  ['d1', 'h5'],
  ['g8', 'f6'],
  ['h5', 'f7'],
]

beforeEach(() => localStorage.clear())

describe('persistence', () => {
  test('a played move is saved to localStorage', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(localStorage.getItem('chess-game:in-progress')).toContain('e4')
  })

  test('settings survive a remount', () => {
    const { unmount } = render(<App />)
    localStorage.setItem(
      'chess-game:settings',
      JSON.stringify({
        level: 6,
        orientation: 'black',
        timeControlId: 'blitz-5-3',
        soundEnabled: true,
        themeId: 'classic',
      }),
    )
    unmount()
    render(<App />)
    expect((screen.getByTestId('level') as HTMLSelectElement).value).toBe('6')
  })

  test('a finished game updates the score', () => {
    const { container } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    const score = JSON.parse(localStorage.getItem('chess-game:score') ?? '{}')
    expect(score.wins + score.losses + score.draws).toBe(1)
  })

  test('a finished game is counted exactly once', () => {
    const { container, rerender } = render(<App />)
    for (const [from, to] of SCHOLARS_MATE) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    // Force a re-render of the same mounted component (not a remount) —
    // the finished-game score effect must not fire again just because the
    // component re-rendered.
    rerender(<App />)
    rerender(<App />)

    const score = JSON.parse(localStorage.getItem('chess-game:score') ?? '{}')
    expect(score.wins + score.losses + score.draws).toBe(1)
  })
})
