import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { NewGame } from './NewGame'
import { LEVELS } from '../../engine/strength'
import { TIME_CONTROLS } from '../../clock/types'

/**
 * Task 3: NewGame moved out of .board-column into the 280px .right-column,
 * re-laid out as a single-column stack of labelled selects (see
 * task-3-report.md for the stack-vs-2x2-grid measurement that decided
 * this). Nothing about which option is present, its text, or the
 * engine-unavailable degradation changed — this file exists (there was
 * none before) to make that executable.
 */

const noop = () => {}
const baseHandlers = {
  onModeChange: noop,
  onLevelChange: noop,
  onTimeControlChange: noop,
  onColorChange: noop,
  onStart: noop,
}

function renderNewGame(overrides: { engineAvailable: boolean; onPuzzles?: () => void }) {
  render(
    <NewGame
      mode="two-player"
      level={1}
      timeControlId="untimed"
      color="white"
      engineAvailable={overrides.engineAvailable}
      onPuzzles={overrides.onPuzzles}
      {...baseHandlers}
    />,
  )
}

describe('NewGame — every select renders its full, unchanged option set', () => {
  test('mode: exactly the three documented options, with their exact text', () => {
    renderNewGame({ engineAvailable: true })
    const mode = screen.getByTestId('mode')
    const options = [...mode.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['Two players', 'One player', 'Engine vs engine'])
  })

  test('level: one option per LEVELS entry, in order, with its exact label', () => {
    renderNewGame({ engineAvailable: true })
    const level = screen.getByTestId('level')
    const options = [...level.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(LEVELS.map((p) => p.label))
    expect(options).toContain('Strong club (~1800)')
  })

  test('color: White and Black, nothing else', () => {
    renderNewGame({ engineAvailable: true })
    const color = screen.getByTestId('color')
    const options = [...color.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(['White', 'Black'])
  })

  test('time-control: one option per TIME_CONTROLS entry, in order, with its exact label', () => {
    renderNewGame({ engineAvailable: true })
    const timeControl = screen.getByTestId('time-control')
    const options = [...timeControl.querySelectorAll('option')].map((o) => o.textContent)
    expect(options).toEqual(TIME_CONTROLS.map((t) => t.label))
    expect(options).toContain('Classical 30+0')
  })

  test('new-game and open-puzzles render with their visible labels', () => {
    renderNewGame({ engineAvailable: true, onPuzzles: noop })
    expect(screen.getByTestId('new-game')).toHaveTextContent('New game')
    expect(screen.getByTestId('open-puzzles')).toHaveTextContent('Puzzles')
  })
})

describe('NewGame — engineAvailable degradation, unchanged', () => {
  test('engine unavailable: One player and Engine vs engine are disabled, not removed', () => {
    renderNewGame({ engineAvailable: false })
    const mode = screen.getByTestId('mode')
    const options = [...mode.querySelectorAll('option')] as HTMLOptionElement[]
    const byText = Object.fromEntries(options.map((o) => [o.textContent, o]))

    expect(Object.keys(byText)).toEqual(['Two players', 'One player', 'Engine vs engine'])
    expect(byText['Two players']!.disabled).toBe(false)
    expect(byText['One player']!.disabled).toBe(true)
    expect(byText['Engine vs engine']!.disabled).toBe(true)
  })

  test('engine available: no mode option is disabled', () => {
    renderNewGame({ engineAvailable: true })
    const mode = screen.getByTestId('mode')
    const options = [...mode.querySelectorAll('option')] as HTMLOptionElement[]
    expect(options.every((o) => !o.disabled)).toBe(true)
  })

  test('onPuzzles omitted: the Puzzles button does not render (New game still does)', () => {
    renderNewGame({ engineAvailable: true })
    expect(screen.getByTestId('new-game')).toBeInTheDocument()
    expect(screen.queryByTestId('open-puzzles')).not.toBeInTheDocument()
  })
})
