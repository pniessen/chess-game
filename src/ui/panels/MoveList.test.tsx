import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('MoveList', () => {
  test('renders numbered pairs', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={2} onJump={vi.fn()} />,
    )
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
    expect(screen.getByTestId('move-2')).toHaveTextContent('e5')
  })

  test('clicking a move jumps to that ply', () => {
    const onJump = vi.fn()
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={onJump} />)
    screen.getByTestId('move-1').click()
    expect(onJump).toHaveBeenCalledWith(1)
  })

  test('marks the current ply', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={1} onJump={vi.fn()} />,
    )
    expect(screen.getByTestId('move-1').className).toContain('current')
    expect(screen.getByTestId('move-2').className).not.toContain('current')
  })

  test('disabled: jumping does not fire onJump', () => {
    const onJump = vi.fn()
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={onJump} disabled />)
    screen.getByTestId('move-1').click()
    expect(onJump).not.toHaveBeenCalled()
  })
})
