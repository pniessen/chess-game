import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('MoveList fallback badges', () => {
  test('a ⚙ on each move Stockfish played for Claude, keyed like move-{ply}', () => {
    render(
      <MoveList
        moves={[move('e4', 'w'), move('e5', 'b'), move('Nf3', 'w')]}
        currentPly={3}
        onJump={vi.fn()}
        claudeNotes={{ 0: { why: 'centre', fallback: false }, 1: { why: '', fallback: true } }}
      />,
    )
    expect(screen.queryByTestId('fallback-1')).toBeNull()
    const badge = screen.getByTestId('fallback-2')
    expect(badge).toHaveTextContent('⚙')
    expect(badge).toHaveAttribute('title', 'Stockfish played this move after Claude failed twice')
    expect(screen.getByTestId('move-2')).toContainElement(badge)
    expect(screen.queryByTestId('fallback-3')).toBeNull()
  })

  test('no notes, no badges', () => {
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={vi.fn()} />)
    expect(screen.queryByTestId('fallback-1')).toBeNull()
  })
})
