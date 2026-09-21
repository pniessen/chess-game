import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ReviewPanel } from './ReviewPanel'
import type { GameReview } from '../../review/run'

const review: GameReview = { firstMover: 'w', evals: [], moves: [], accuracy: { w: 91.26, b: null } }

test('Claude’s summary is untrusted text: markup in it is shown, never parsed', () => {
  const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>'
  const { container } = render(
    <ReviewPanel
      state={{ kind: 'done', review, summary: evil, summarySource: 'claude' }}
      canReview
      currentText=""
      onStart={vi.fn()}
      onCancel={vi.fn()}
    />,
  )
  expect(screen.getByTestId('review-summary').textContent).toBe(evil)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('b')).toBeNull()
  expect(screen.getByTestId('review-summary-source')).toHaveTextContent('Summary by Claude')
  expect(screen.getByTestId('accuracy-w')).toHaveTextContent(/^91\.3$/)
  expect(screen.getByTestId('accuracy-b')).toHaveTextContent('—')
})

test('the start button is disabled until the game is finished', () => {
  render(<ReviewPanel state={{ kind: 'idle' }} canReview={false} currentText="" onStart={vi.fn()} onCancel={vi.fn()} />)
  expect(screen.getByTestId('review-start')).toBeDisabled()
})
