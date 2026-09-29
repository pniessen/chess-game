import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MatchConfig, MatchPhase } from '../../match/types'
import { ClaudeStatus, ClaudeWhy } from './ClaudePanel'

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
    render(<ClaudeStatus phase={thinking('w', 1)} config={CLAUDE} spentUsd={0} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('Opus 5.5 is thinking… 0s')
    act(() => vi.advanceTimersByTime(7_000))
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent(/^Opus 5\.5 is thinking… 7s$/)
  })

  test('the count restarts for the next turn, with that side’s model', () => {
    const { rerender } = render(<ClaudeStatus phase={thinking('w', 1)} config={CLAUDE} spentUsd={0} />)
    act(() => vi.advanceTimersByTime(5_000))
    rerender(<ClaudeStatus phase={thinking('b', 2)} config={CLAUDE} spentUsd={0} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('Haiku 4.5 is thinking… 0s')
  })

  test('not thinking while paused; the line keeps its place (empty)', () => {
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={CLAUDE} spentUsd={0} />)
    expect(screen.getByTestId('claude-thinking')).toHaveTextContent('')
  })

  test('the cost meter, to the cent', () => {
    render(<ClaudeStatus phase={{ kind: 'paused' }} config={CLAUDE} spentUsd={0.8412} />)
    expect(screen.getByTestId('claude-cost')).toHaveTextContent('This game: $0.84')
  })

  test('an engine seat thinking is not Claude thinking', () => {
    const mixed: MatchConfig = { ...CLAUDE, black: { kind: 'engine', level: 3 } }
    render(<ClaudeStatus phase={thinking('b', 1)} config={mixed} spentUsd={0} />)
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
