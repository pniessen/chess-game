import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PuzzleScreen } from './PuzzleScreen'
import { loadPuzzleStats } from '../../puzzles/store'
import type { RatedPuzzle } from '../../puzzles/types'
import { BACK_RANK, DEFENCE } from '../../../tests/fixtures/puzzles'

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
  })

  // Breaks if retrying after a wrong move can win the rating back.
  test('a wrong move costs rating at once; retry and solve does not refund it', async () => {
    await mount()
    advance(600)
    click('b6')
    click('c7')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent("That's not it.")
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1193')
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
})
