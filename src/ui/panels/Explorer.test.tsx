import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Explorer } from './Explorer'
import { OpeningBook } from '../../openings/book'
import { buildOpeningsData } from '../../openings/build'
import { FIXTURE_TSV } from '../../../tests/fixtures/openings'

const book = new OpeningBook(buildOpeningsData([FIXTURE_TSV]))

test('search narrows the list; picking shows the line; start hands over the entry', () => {
  const onStart = vi.fn()
  render(<Explorer book={book} unavailable={false} current={null} onStart={onStart} />)
  expect(screen.getByTestId('explorer-results').querySelectorAll('button')).toHaveLength(5)

  fireEvent.change(screen.getByTestId('explorer-search'), { target: { value: 'sicilian' } })
  const results = screen.getByTestId('explorer-results').querySelectorAll('button')
  expect(results).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: 'B27 Sicilian Defense: Hyperaccelerated Fianchetto' }))
  expect(screen.getByTestId('explorer-detail')).toHaveTextContent('1. e4 c5 2. Nf3 g6')
  fireEvent.click(screen.getByTestId('explorer-start'))
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ eco: 'B27', moves: ['e4', 'c5', 'Nf3', 'g6'] }))
})

test('loading and unavailable states', () => {
  const { rerender } = render(<Explorer book={null} unavailable={false} current={null} onStart={vi.fn()} />)
  expect(screen.getByTestId('explorer-status')).toHaveTextContent(/loading/i)
  rerender(<Explorer book={null} unavailable current={null} onStart={vi.fn()} />)
  expect(screen.getByTestId('explorer-status')).toHaveTextContent(/unavailable/i)
})
