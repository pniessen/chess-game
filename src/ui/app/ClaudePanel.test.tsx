import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MatchConfig, MatchPhase } from '../../match/types'
import { ClaudeStatus, ClaudeWhy } from './ClaudePanel'
import { ZERO_USAGE, type Usage } from '../../claude/models'

const NONE = { w: ZERO_USAGE, b: ZERO_USAGE }
const cost = (costUsd: number): Usage => ({ ...ZERO_USAGE, costUsd, calls: 1 })

const CLAUDE: MatchConfig = {
  white: { kind: 'claude', model: 'opus' },
  black: { kind: 'claude', model: 'haiku' },
  timeControl: { kind: 'untimed' },
}
const thinking = (side: 'w' | 'b', requestId: number): MatchPhase => ({ kind: 'engine-thinking', side, requestId })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClaudeStatus', () => {
  test('"{label} is thinking… {n}s", ticking each second', () => {
    render(<ClaudeStatus phase={thinking('w', 1)} config={CLAUDE} spentUsd={0} usage={NONE} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('Opus 5.5 is thinking… 0s')
    act(() => vi.advanceTimersByTime(7_000))
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent(/^Opus 5\.5 is thinking… 7s$/)
  })

  test('the count restarts for the next turn, with that side’s model', () => {
    const { rerender } = render(<ClaudeStatus phase={thinking('w', 1)} config={CLAUDE} spentUsd={0} usage={NONE} />)
    act(() => vi.advanceTimersByTime(5_000))
    rerender(<ClaudeStatus phase={thinking('b', 2)} config={CLAUDE} spentUsd={0} usage={NONE} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('Haiku 4.5 is thinking… 0s')
  })

  test('not thinking while paused; the line keeps its place (empty)', () => {
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={CLAUDE} spentUsd={0} usage={NONE} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('')
  })

  test('the cost meter, to the cent', () => {
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={CLAUDE} spentUsd={0.8412} usage={NONE} />)
    expect(screen.getByTestId('claude-cost')).toHaveTextContent('This game: $0.84')
  })

  test('the cost line splits the game total per model, White first, with short labels', () => {
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={CLAUDE} spentUsd={0.06} usage={{ w: cost(0.012), b: cost(0.048) }} />)
    expect(screen.getByTestId('claude-cost')).toHaveTextContent(/^This game: \$0\.06 · Opus 5\.5 \$0\.01 · Haiku 4\.5 \$0\.05$/)
    expect(screen.getByTestId('claude-cost-w')).toHaveTextContent('Opus 5.5 $0.01')
    expect(screen.getByTestId('claude-cost-b')).toHaveTextContent('Haiku 4.5 $0.05')
  })

  test('only Claude seats get a per-model part', () => {
    const mixed: MatchConfig = { ...CLAUDE, white: { kind: 'human' } }
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={mixed} spentUsd={0.05} usage={{ w: ZERO_USAGE, b: cost(0.05) }} />)
    expect(screen.getByTestId('claude-cost')).toHaveTextContent(/^This game: \$0\.05 · Haiku 4\.5 \$0\.05$/)
    expect(screen.queryByTestId('claude-cost-w')).toBeNull()
  })

  test('an engine seat thinking is not Claude thinking', () => {
    const mixed: MatchConfig = { ...CLAUDE, black: { kind: 'engine', level: 3 } }
    render(<ClaudeStatus phase={thinking('b', 1)} config={mixed} spentUsd={0} usage={NONE} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('')
  })
})

describe('ClaudeWhy', () => {
  const notes = { 0: { why: 'Claim the centre.', fallback: false }, 1: { why: '', fallback: true } }

  test('the rationale of the move that led to the displayed ply', () => {
    render(<ClaudeWhy notes={notes} ply={1} />)
    expect(screen.getByTestId('claude-why')).toHaveTextContent('Claim the centre.')
  })

  test('a fallback move says Stockfish played it', () => {
    render(<ClaudeWhy notes={notes} ply={2} />)
    expect(screen.getByTestId('claude-why')).toHaveTextContent('⚙ Stockfish played this move after Claude failed twice')
  })

  test('empty at the start, and for a move with no note', () => {
    const { rerender } = render(<ClaudeWhy notes={notes} ply={0} />)
    expect(screen.getByTestId('claude-why')).toHaveTextContent('')
    rerender(<ClaudeWhy notes={notes} ply={3} />)
    expect(screen.getByTestId('claude-why')).toHaveTextContent('')
  })
})
