import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PuzzleScreen } from './PuzzleScreen'
import { loadBlunderPuzzles, loadPuzzleStats } from '../../puzzles/store'
import type { RatedPuzzle } from '../../puzzles/types'
import { BACK_RANK, DEFENCE, ILLEGAL_MOVE } from '../../../tests/fixtures/puzzles'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

const click = (sq: string) => fireEvent.click(document.querySelector(`[data-square="${sq}"]`) as HTMLElement)
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

async function mount(load: () => Promise<RatedPuzzle[] | null> = async () => [DEFENCE, BACK_RANK]) {
  const onExit = vi.fn()
  render(<PuzzleScreen onExit={onExit} themeId="classic" pieceSetId="rhosgfx" loadPuzzles={load} random={() => 0} />)
  await flush()
  return onExit
}

async function solveDefence() {
  advance(600) // setup Qd6
  click('f8')
  click('d8')
  advance(400) // reply Qxd8+
  click('f6')
  click('d8')
}

describe('PuzzleScreen (rated)', () => {
  // Breaks if a failed fetch crashes the screen or strands the user in it.
  test('a set that fails to load shows a clear message; Back to game works', async () => {
    const onExit = await mount(async () => null)
    expect(screen.getByTestId('puzzle-load-error')).toHaveTextContent('could not be loaded')
    fireEvent.click(screen.getByTestId('puzzle-exit'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  test('shows side to move, themes, both ratings; solving raises the rating once', async () => {
    await mount()
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('0000D')
    expect(screen.getByTestId('puzzle-side-to-move')).toHaveTextContent('Black to move')
    expect(screen.getByTestId('puzzle-themes')).toHaveTextContent('Advantage, Endgame, Short')
    expect(screen.getByTestId('puzzle-rating')).toHaveTextContent('1468')
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1200')
    // Solver's side at the bottom: the first square in the grid is h1 when Black plays.
    expect(document.querySelector('[data-square]')?.getAttribute('data-square')).toBe('h1')
    await solveDefence()
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1233')
    expect(screen.getByTestId('puzzle-rating-delta')).toHaveTextContent('(+33)')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1233, games: 1, seen: ['0000D'] })
    // Task 7: the celebration ring class is on solving — presentation only,
    // reading `phase`, never touching the rating maths asserted above.
    expect(document.querySelector('.board')?.className).toContain('celebrate-solved')
  })

  // Breaks if retrying after a wrong move can win the rating back.
  test('a wrong move costs rating at once; retry and solve does not refund it', async () => {
    await mount()
    advance(600)
    click('b6')
    click('c7')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent("That's not it.")
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1193')
    // Task 7: the wrong move's own square shakes; no celebration ring.
    expect(document.querySelector('[data-square="c7"]')?.className).toContain('wrong-move')
    expect(document.querySelector('.board')?.className).not.toContain('celebrate-solved')
    fireEvent.click(screen.getByTestId('puzzle-retry'))
    click('f8')
    click('d8')
    advance(400)
    click('f6')
    click('d8')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1193, games: 1 })
  })

  test('Next skips without a rating change and never repeats; the theme filter narrows the draw', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('puzzle-next'))
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('T0001')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
    fireEvent.change(screen.getByTestId('puzzle-theme'), { target: { value: 'fork' } })
    expect(screen.getByTestId('puzzle-empty')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('puzzle-theme'), { target: { value: 'mateIn1' } })
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('T0001')
  })

  // Breaks if a corrupt puzzle (fails validateSpec) is shown instead of skipped.
  test('a set whose first-selected puzzle has an illegal move shows the next valid one instead', async () => {
    await mount(async () => [ILLEGAL_MOVE, DEFENCE])
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('0000D')
    // The invalid puzzle is marked seen so it is not retried forever.
    expect(loadPuzzleStats().seen).toContain('BAD01')
  })
})

describe('PuzzleScreen (My mistakes)', () => {
  const SEEDED = {
    v: 1,
    puzzles: [
      {
        id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
        fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
        solution: 'd1d8',
        bestSan: 'Qd8#',
        blunderLabel: '25. h3',
        solver: 'w',
        gameId: 'g1',
        gameDate: '2026-09-20T10:00:00.000Z',
        opening: 'C50 Italian Game',
        createdAt: '2026-09-20T10:05:00.000Z',
        solved: false,
      },
    ],
  }

  // Breaks if mistakes change the rating or are not marked solved.
  test('lists saved mistakes with their origin; solving one marks it solved and leaves the rating alone', async () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED))
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    expect(screen.getAllByTestId('mistake-item')).toHaveLength(1)
    expect(screen.getByTestId('puzzle-origin')).toHaveTextContent(
      'From your game on 2026-09-20 (C50 Italian Game): you played 25. h3??',
    )
    expect(screen.getByTestId('puzzle-side-to-move')).toHaveTextContent('White to move')
    expect(screen.getByTestId('puzzle-unrated')).toHaveTextContent('1200')
    expect(screen.getByTestId('puzzle-theme')).toBeDisabled()
    click('d1')
    click('d8')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(screen.getByTestId('mistake-solved')).toBeInTheDocument()
    expect(loadBlunderPuzzles()[0]?.solved).toBe(true)
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
    // Task 7: My-mistakes still celebrates (the ring), but never any rating text.
    expect(document.querySelector('.board')?.className).toContain('celebrate-solved')
    expect(screen.queryByTestId('puzzle-rating-delta')).not.toBeInTheDocument()
  })

  // Regression guard: this screen used to build its own Highlights inline,
  // duplicating (and, on checkmate, losing) the `status.kind ===
  // 'in-progress'` check that src/ui/app/highlights.ts also had — solving a
  // mate-in-1 puzzle used to leave the mated king with no glow at all.
  // SEEDED above is exactly that: White plays Qd1-d8#, mating the king on g8.
  test('solving a mate-in-1 puzzle holds the check glow on the mated king and shakes the board', async () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED))
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    click('d1')
    click('d8')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')

    const king = document.querySelector('[data-square="g8"]')
    expect(king?.className).toContain('check')
    expect(king?.className).toContain('mated')
    expect(document.querySelector('[role="grid"]')?.className).toContain('checkmate-shake')
  })

  test('a wrong move on a mistake is not rated either', async () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED))
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    click('d1')
    click('d7')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent("That's not it.")
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
  })

  test('with no mistakes saved it says where they come from; switching back draws a rated puzzle', async () => {
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    expect(screen.getByTestId('mistakes-empty')).toHaveTextContent('Review a finished game')
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'rated' } })
    expect(screen.getByTestId('puzzle-rating')).toBeInTheDocument()
  })
})
