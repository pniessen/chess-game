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
