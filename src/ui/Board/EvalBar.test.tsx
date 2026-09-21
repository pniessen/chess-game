import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { EvalBar } from './EvalBar'

test('shows the label and fills White\'s share of the bar', () => {
  render(<EvalBar evaluation={{ kind: 'cp', cp: 100 }} orientation="white" />)
  expect(screen.getByTestId('eval-label')).toHaveTextContent('+1.0')
  expect(screen.getByTestId('eval-white-share').style.height).toBe('59.1%')
  expect(screen.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'white')
})

test('no evaluation yet: an even bar and a placeholder', () => {
  render(<EvalBar evaluation={null} orientation="black" />)
  expect(screen.getByTestId('eval-label')).toHaveTextContent('…')
  expect(screen.getByTestId('eval-white-share').style.height).toBe('50%')
  expect(screen.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'black')
})
