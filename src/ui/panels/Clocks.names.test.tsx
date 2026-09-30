import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Clocks } from './Clocks'

const clock = { whiteMs: 0, blackMs: 0, running: null, flagged: null }

describe('Clocks player names', () => {
  test('White and Black by default', () => {
    const { container } = render(<Clocks clock={clock} orientation="white" />)
    expect([...container.querySelectorAll('.clock-label')].map((e) => e.textContent)).toEqual(['Black', 'White'])
  })

  test('the model labels when given, each on its own side', () => {
    const { container } = render(
      <Clocks clock={clock} orientation="white" names={{ w: 'Claude Opus 5.5', b: 'Claude Haiku 4.5' }} />,
    )
    expect([...container.querySelectorAll('.clock-label')].map((e) => e.textContent)).toEqual([
      'Claude Haiku 4.5',
      'Claude Opus 5.5',
    ])
    expect(screen.getByTestId('clock-w')).toBeInTheDocument()
  })
})

describe('Clocks model time (a game with a Claude seat)', () => {
  const TITLE = "Model time: Anthropic API time for this side's moves"

  test("a Claude side shows its total model time, titled; another side's clock is unchanged", () => {
    render(<Clocks clock={clock} orientation="white" modelTime={{ w: 12_340 }} />)
    const w = screen.getByTestId('clock-w')
    expect(w).toHaveTextContent('0:12.3')
    expect(w).toHaveAttribute('title', TITLE)
    // Model time is not time left: never styled as low on time.
    expect(w.closest('.clock')).not.toHaveClass('low')
    const b = screen.getByTestId('clock-b')
    expect(b).toHaveTextContent('0:00.0')
    expect(b).not.toHaveAttribute('title')
  })

  test('the thinking Claude side is marked running; the other is not', () => {
    render(<Clocks clock={clock} orientation="white" modelTime={{ w: 1_000, b: 2_000 }} thinking="b" />)
    expect(screen.getByTestId('clock-b').closest('.clock')).toHaveClass('running')
    expect(screen.getByTestId('clock-w').closest('.clock')).not.toHaveClass('running')
  })

  test('without modelTime, a timed clock renders exactly as before (low time, running)', () => {
    const timed = { whiteMs: 15_000, blackMs: 180_000, running: 'w' as const, flagged: null }
    render(<Clocks clock={timed} orientation="white" thinking="b" />)
    const w = screen.getByTestId('clock-w')
    expect(w).toHaveTextContent('0:15')
    expect(w).not.toHaveAttribute('title')
    expect(w.closest('.clock')).toHaveClass('running')
    expect(w.closest('.clock')).toHaveClass('low')
    expect(screen.getByTestId('clock-b').closest('.clock')).not.toHaveClass('running')
    expect(screen.getByTestId('clock-b')).toHaveTextContent('3:00')
  })
})
