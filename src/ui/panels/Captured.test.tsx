import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Captured } from './Captured'
import type { PlayedMove } from '../../game-core/types'

const move = (
  captured: 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | undefined,
  color: 'w' | 'b',
): PlayedMove => ({
  san: 'test',
  color,
  from: 'e2',
  to: 'e4',
  piece: 'p',
  isCapture: captured !== undefined,
  isCastle: false,
  isEnPassant: false,
  fenAfter: '',
  captured: captured,
})

describe('Captured', () => {
  test('renders empty trays when no pieces captured', () => {
    render(<Captured moves={[]} />)
    expect(screen.getByTestId('captured-by-white')).toBeInTheDocument()
    expect(screen.getByTestId('captured-by-black')).toBeInTheDocument()
    expect(screen.queryByTestId('material-balance')).not.toBeInTheDocument()
  })

  test('white tray shows black pieces white has captured', () => {
    // White captures black knight and pawn
    const moves: PlayedMove[] = [
      move('n', 'w'), // white captured black knight
      move('p', 'w'), // white captured black pawn
    ]
    render(<Captured moves={moves} />)

    const whiteTray = screen.getByTestId('captured-by-white')
    const blackPiecesLabels = whiteTray.querySelectorAll('[aria-label]')
    expect(blackPiecesLabels).toHaveLength(2)
    expect(blackPiecesLabels[0]).toHaveAttribute('aria-label', 'black knight')
    expect(blackPiecesLabels[1]).toHaveAttribute('aria-label', 'black pawn')
  })

  test('black tray shows white pieces black has captured', () => {
    // Black captures white bishop and rook
    const moves: PlayedMove[] = [
      move('b', 'b'), // black captured white bishop
      move('r', 'b'), // black captured white rook
    ]
    render(<Captured moves={moves} />)

    const blackTray = screen.getByTestId('captured-by-black')
    const whitePiecesLabels = blackTray.querySelectorAll('[aria-label]')
    expect(whitePiecesLabels).toHaveLength(2)
    expect(whitePiecesLabels[0]).toHaveAttribute('aria-label', 'white bishop')
    expect(whitePiecesLabels[1]).toHaveAttribute('aria-label', 'white rook')
  })

  test('material balance displays correctly when white is ahead', () => {
    // White captures queen (9) and knight (3), black captures nothing
    const moves: PlayedMove[] = [
      move('q', 'w'), // white captured queen (9 points)
      move('n', 'w'), // white captured knight (3 points)
    ]
    render(<Captured moves={moves} />)

    const balance = screen.getByTestId('material-balance')
    expect(balance).toHaveTextContent('White +12')
  })

  test('material balance displays correctly when black is ahead', () => {
    // Black captures rook (5) and bishop (3), white captures nothing
    const moves: PlayedMove[] = [
      move('r', 'b'), // black captured rook (5 points)
      move('b', 'b'), // black captured bishop (3 points)
    ]
    render(<Captured moves={moves} />)

    const balance = screen.getByTestId('material-balance')
    expect(balance).toHaveTextContent('Black +8')
  })

  test('material balance is zero when both players capture equal material', () => {
    const moves: PlayedMove[] = [
      move('p', 'w'), // white captured pawn (1 point)
      move('p', 'b'), // black captured pawn (1 point)
    ]
    render(<Captured moves={moves} />)

    expect(screen.queryByTestId('material-balance')).not.toBeInTheDocument()
  })

  test('captured pieces have accessible role and label', () => {
    const moves: PlayedMove[] = [move('n', 'w')]
    render(<Captured moves={moves} />)

    const capturedPiece = screen.getByLabelText('black knight')
    expect(capturedPiece).toHaveAttribute('role', 'img')
  })

  test('multiple captures of the same piece type are all shown', () => {
    // White captures three black pawns
    const moves: PlayedMove[] = [
      move('p', 'w'),
      move('p', 'w'),
      move('p', 'w'),
    ]
    render(<Captured moves={moves} />)

    const pawnLabels = screen.getAllByLabelText('black pawn')
    expect(pawnLabels).toHaveLength(3)
  })

  test('captured pieces are displayed in order of capture', () => {
    const moves: PlayedMove[] = [
      move('p', 'w'),
      move('n', 'w'),
      move('b', 'w'),
    ]
    render(<Captured moves={moves} />)

    const whiteTray = screen.getByTestId('captured-by-white')
    const capturedPieces = whiteTray.querySelectorAll('[aria-label]')
    expect(capturedPieces[0]).toHaveAttribute('aria-label', 'black pawn')
    expect(capturedPieces[1]).toHaveAttribute('aria-label', 'black knight')
    expect(capturedPieces[2]).toHaveAttribute('aria-label', 'black bishop')
  })

  test('color mapping: white tray shows ONLY black pieces (regression test)', () => {
    // This test guards the color mapping logic from Captured.tsx:46
    // White captures black pieces: captured.w → color="b" (black pieces)
    const moves: PlayedMove[] = [move('n', 'w')]
    render(<Captured moves={moves} />)

    const whiteTray = screen.getByTestId('captured-by-white')
    // The piece should be labeled as "black knight", NOT "white knight"
    expect(whiteTray.querySelector('[aria-label="black knight"]')).toBeInTheDocument()
    expect(whiteTray.querySelector('[aria-label="white knight"]')).not.toBeInTheDocument()
  })
})
