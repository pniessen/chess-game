import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { EvalLine, evalLineSummary } from './EvalLine'
import type { GameReview, ReviewedMove } from '../../review/run'
import type { WhiteEval } from '../../engine/evaluation'

const move = (over: Partial<ReviewedMove> & Pick<ReviewedMove, 'ply' | 'san' | 'mover'>): ReviewedMove => ({
  uci: 'e2e4',
  classification: 'ok',
  loss: 0,
  bestUci: null,
  bestSan: null,
  ...over,
})

// A short (Scholar's mate) review: White wins by checkmate on ply 7.
const SHORT: GameReview = {
  firstMover: 'w',
  evals: [
    { kind: 'cp', cp: 20 },
    { kind: 'cp', cp: 15 },
    { kind: 'cp', cp: 10 },
    { kind: 'cp', cp: 5 },
    { kind: 'cp', cp: 0 },
    { kind: 'cp', cp: -600 },
    { kind: 'cp', cp: -900 },
    { kind: 'result', winner: 'w' },
  ],
  moves: [
    move({ ply: 1, san: 'e4', mover: 'w' }),
    move({ ply: 2, san: 'e5', mover: 'b' }),
    move({ ply: 3, san: 'Bc4', mover: 'w' }),
    move({ ply: 4, san: 'Nc6', mover: 'b' }),
    move({ ply: 5, san: 'Qh5', mover: 'w' }),
    move({ ply: 6, san: 'Nf6', mover: 'b', classification: 'blunder', loss: 60, bestUci: 'g8f6', bestSan: 'Nf6' }),
    move({ ply: 7, san: 'Qxf7#', mover: 'w', classification: 'best' }),
  ],
  accuracy: { w: 95, b: 40 },
}

function longGame(plies: number): GameReview {
  const evals: WhiteEval[] = [{ kind: 'cp', cp: 0 }]
  const moves: ReviewedMove[] = []
  for (let i = 1; i <= plies; i++) {
    evals.push({ kind: 'cp', cp: (i % 7) * 12 - 36 })
    moves.push(move({ ply: i, san: `m${i}`, mover: i % 2 === 1 ? 'w' : 'b' }))
  }
  return { firstMover: 'w', evals, moves, accuracy: { w: 60, b: 55 } }
}

test('renders nothing for a review with no moves (defensive: canReview already requires >=1 move)', () => {
  const empty: GameReview = { firstMover: 'w', evals: [], moves: [], accuracy: { w: null, b: null } }
  const { container } = render(<EvalLine review={empty} />)
  expect(container).toBeEmptyDOMElement()
})

test('a short game plots one point per ply, ending on the mate result', () => {
  render(<EvalLine review={SHORT} />)
  const svg = screen.getByTestId('eval-line').querySelector('svg')!
  expect(svg.querySelector('polyline')!.getAttribute('points')!.trim().split(' ')).toHaveLength(SHORT.evals.length)
  // The accessible table has one row for the start plus one per move.
  const rows = screen.getByTestId('eval-line-table').querySelectorAll('tbody tr')
  expect(rows).toHaveLength(SHORT.moves.length + 1)
  expect(rows[rows.length - 1]!.textContent).toContain('1-0')
})

test('a long game still renders exactly one point per ply — no downsampling, no overflow needed', () => {
  const review = longGame(120)
  render(<EvalLine review={review} />)
  const svg = screen.getByTestId('eval-line').querySelector('svg')!
  expect(svg.querySelector('polyline')!.getAttribute('points')!.trim().split(' ')).toHaveLength(121)
})

test('mate scores plot at the extreme, same as the eval bar', () => {
  const withMate: GameReview = {
    ...SHORT,
    evals: [
      { kind: 'cp', cp: 0 },
      { kind: 'cp', cp: 0 },
      { kind: 'cp', cp: 0 },
      { kind: 'cp', cp: 0 },
      { kind: 'cp', cp: 0 },
      { kind: 'mate', mate: -3 }, // Black to deliver mate in 3
      { kind: 'mate', mate: -2 },
      { kind: 'result', winner: 'w' },
    ],
  }
  render(<EvalLine review={withMate} />)
  const table = screen.getByTestId('eval-line-table')
  expect(table.textContent).toContain('-M3')
  const points = screen
    .getByTestId('eval-line')
    .querySelector('polyline')!
    .getAttribute('points')!
    .trim()
    .split(' ')
    .map((p) => p.split(',').map(Number))
  // Black-mating points (index 5, 6) sit at the bottom of the 0..32 viewBox
  // (White win% collapses to 0), same as a -900cp point would not.
  expect(points[5]![1]).toBeCloseTo(32 - 1.5, 1)
})

test('flagged moves get a marker dot in the review’s own classification colour class', () => {
  render(<EvalLine review={SHORT} />)
  const dot = screen.getByTestId('eval-line').querySelector('circle.mark-blunder')
  expect(dot).not.toBeNull()
})

test('the SVG is decorative; the caption and table carry the real content', () => {
  render(<EvalLine review={SHORT} />)
  const svg = screen.getByTestId('eval-line').querySelector('svg')!
  expect(svg).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByTestId('eval-line-summary').textContent).toMatch(/Ended at 1-0/)
  expect(screen.getByTestId('eval-line-table').tagName).toBe('TABLE')
})

// The checkmate itself (White win% 100, furthest from even a game can get)
// outranks the blunder that set it up (White win% ~96.5 at -900cp), so the
// mating move is correctly the reported peak, not the move before it.
test('evalLineSummary names the largest swing and where it happened', () => {
  expect(evalLineSummary(SHORT)).toBe(
    'Evaluation line for the whole game. Ended at 1-0. Furthest from even was 1-0, at 4. Qxf7#.',
  )
})

test('evalLineSummary says the game never left even when it did not', () => {
  const flat: GameReview = {
    firstMover: 'w',
    evals: [{ kind: 'cp', cp: 0 }, { kind: 'cp', cp: 0 }],
    moves: [move({ ply: 1, san: 'e4', mover: 'w' })],
    accuracy: { w: 100, b: null },
  }
  expect(evalLineSummary(flat)).toBe('Evaluation line for the whole game. Ended at 0.0; the position never left even.')
})
