import { describe, expect, test } from 'vitest'
import { Position } from '../../game-core/position'
import type { MoveIntent, PieceSymbol, PlayedMove, Square } from '../../game-core/types'
import { capturedSquare, changedSquares, flightFor, type PieceMap } from './flight'

/** The same square -> piece map Board builds from `position.board()`. */
function mapOf(position: Position): PieceMap {
  const pieces = new Map<Square, { color: 'w' | 'b'; type: PieceSymbol }>()
  for (const row of position.board()) {
    for (const cell of row) {
      if (cell) pieces.set(cell.square, { color: cell.color, type: cell.type })
    }
  }
  return pieces
}

/** Play `sans` from `fen`, returning the layouts either side of the last one. */
function transition(
  fen: string | undefined,
  sans: string[],
): { before: PieceMap; after: PieceMap; move: PlayedMove } {
  const position = new Position(fen)
  let move: PlayedMove | null = null
  let before: PieceMap = mapOf(position)
  for (const san of sans) {
    before = mapOf(position)
    const played = position.trySan(san)
    if (!played.ok) throw new Error(`illegal test move ${san}`)
    move = played.move
  }
  if (!move) throw new Error('no moves')
  return { before, after: mapOf(position), move }
}

function play(fen: string, intent: MoveIntent): { before: PieceMap; after: PieceMap; move: PlayedMove } {
  const position = new Position(fen)
  const before = mapOf(position)
  const played = position.tryMove(intent)
  if (!played.ok) throw new Error(`illegal test move: ${played.reason}`)
  return { before, after: mapOf(position), move: played.move }
}

describe('changedSquares', () => {
  test('is empty for identical layouts and names both ends of a move', () => {
    const start = new Position()
    expect(changedSquares(mapOf(start), mapOf(start)).size).toBe(0)
    const { before, after } = transition(undefined, ['e4'])
    expect([...changedSquares(before, after)].sort()).toEqual(['e2', 'e4'])
  })
})

describe('capturedSquare', () => {
  test('is the destination for an ordinary capture and the passed pawn for en passant', () => {
    const plain = transition(undefined, ['e4', 'd5', 'exd5'])
    expect(capturedSquare(plain.move)).toBe('d5')
    const ep = transition(undefined, ['e4', 'a6', 'e5', 'd5', 'exd6'])
    expect(ep.move.isEnPassant).toBe(true)
    expect(capturedSquare(ep.move)).toBe('d5')
  })

  test('is null for a quiet move', () => {
    expect(capturedSquare(transition(undefined, ['e4']).move)).toBeNull()
  })
})

describe('flightFor', () => {
  test('a quiet move sends one piece from its origin to its destination', () => {
    const { before, after, move } = transition(undefined, ['e4'])
    const flight = flightFor(move, before, after)
    expect(flight).not.toBeNull()
    expect(flight?.flyers).toEqual([
      { key: 'mover-e2-e4', code: 'wP', from: 'e2', to: 'e4', kind: 'mover' },
    ])
    expect(flight?.arriving).toEqual(['e4'])
  })

  test('a capture adds the taken piece, before the mover so it fades underneath', () => {
    const { before, after, move } = transition(undefined, ['e4', 'd5', 'exd5'])
    const flight = flightFor(move, before, after)
    expect(flight?.flyers.map((f) => [f.kind, f.code, f.from, f.to])).toEqual([
      ['captured', 'bP', 'd5', 'd5'],
      ['mover', 'wP', 'e4', 'd5'],
    ])
    // Only the arriving piece is ever held back.
    expect(flight?.arriving).toEqual(['d5'])
  })

  test('en passant fades the pawn on its own square, not on the destination', () => {
    const { before, after, move } = transition(undefined, ['e4', 'a6', 'e5', 'd5', 'exd6'])
    const flight = flightFor(move, before, after)
    expect(flight?.flyers.map((f) => [f.kind, f.from, f.to])).toEqual([
      ['captured', 'd5', 'd5'],
      ['mover', 'e5', 'd6'],
    ])
  })

  test('castling moves the king and the rook together', () => {
    const { before, after, move } = transition(undefined, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
    const flight = flightFor(move, before, after)
    expect(flight?.flyers.map((f) => [f.code, f.from, f.to])).toEqual([
      ['wK', 'e1', 'g1'],
      ['wR', 'h1', 'f1'],
    ])
    expect(flight?.arriving).toEqual(['g1', 'f1'])
  })

  test('queenside castling takes the a-file rook to d1', () => {
    const { before, after, move } = play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', { from: 'e1', to: 'c1' })
    const flight = flightFor(move, before, after)
    expect(flight?.flyers.map((f) => [f.code, f.from, f.to])).toEqual([
      ['wK', 'e1', 'c1'],
      ['wR', 'a1', 'd1'],
    ])
  })

  test('a promotion slides the PAWN; the new piece is what waits at the destination', () => {
    const { before, after, move } = play('8/P6k/8/8/8/8/8/7K w - - 0 1', { from: 'a7', to: 'a8', promotion: 'q' })
    const flight = flightFor(move, before, after)
    expect(flight?.flyers).toEqual([
      { key: 'mover-a7-a8', code: 'wP', from: 'a7', to: 'a8', kind: 'mover' },
    ])
    expect(after.get('a8')).toEqual({ color: 'w', type: 'q' })
    expect(flight?.arriving).toEqual(['a8'])
  })

  test('a promotion that also captures fades the taken piece', () => {
    const { before, after, move } = play('1r5k/P7/8/8/8/8/8/7K w - - 0 1', { from: 'a7', to: 'b8', promotion: 'q' })
    const flight = flightFor(move, before, after)
    expect(flight?.flyers.map((f) => [f.kind, f.code, f.from, f.to])).toEqual([
      ['captured', 'bR', 'b8', 'b8'],
      ['mover', 'wP', 'a7', 'b8'],
    ])
  })

  // The safety net: a transition that is not exactly this move must cut, so
  // a new game, an import or a replay can never be animated as a move.
  test('refuses layouts that are not the two sides of this move', () => {
    const { before, after, move } = transition(undefined, ['e4'])

    // The position two moves on, not one.
    const twoOn = new Position()
    twoOn.trySan('e4')
    twoOn.trySan('e5')
    expect(flightFor(move, before, mapOf(twoOn))).toBeNull()

    // A completely unrelated position (a new game from a FEN).
    expect(flightFor(move, mapOf(new Position('8/8/8/4k3/8/8/4K3/8 w - - 0 1')), after)).toBeNull()

    // The move already applied to `before` (nothing left to move).
    expect(flightFor(move, after, after)).toBeNull()
  })

  test('refuses a move whose piece is not on the origin square', () => {
    const { before, after, move } = transition(undefined, ['e4'])
    expect(flightFor({ ...move, piece: 'q' }, before, after)).toBeNull()
    expect(flightFor({ ...move, from: 'd2' as Square }, before, after)).toBeNull()
  })

  test('refuses a castle whose rook is not where the king says it should be', () => {
    const { before, after, move } = transition(undefined, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'])
    // Same two king squares, but claiming a castle to a square with no rook rule.
    expect(flightFor({ ...move, to: 'f1' as Square }, before, after)).toBeNull()
  })
})
