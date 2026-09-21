import { useState } from 'react'
import { Game } from '../game-core/game'
import type { GameStatus, PieceSymbol, Square } from '../game-core/types'
import { Board, type Highlights } from './Board/Board'
import { Promotion } from './Board/Promotion'
import { reduceSelection, type SelectionState } from './Board/selection'

function describeStatus(status: GameStatus): string {
  switch (status.kind) {
    case 'checkmate':
      return `Checkmate — ${status.winner === 'w' ? 'White' : 'Black'} wins`
    case 'draw':
      return {
        stalemate: 'Draw — stalemate',
        'insufficient-material': 'Draw — insufficient material',
        'threefold-repetition': 'Draw — threefold repetition',
        'fifty-move-rule': 'Draw — fifty-move rule',
      }[status.reason]
    case 'in-progress':
      return status.inCheck ? 'Check' : ''
  }
}

export function App() {
  const [game] = useState(() => new Game())
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  // Game is a mutable object, not React state, so nothing about it is
  // reactive on its own. This counter is a deliberate, temporary shim to
  // force a re-render after mutating `game` directly. Task 12 replaces it
  // with a proper useSyncExternalStore subscription to MatchController —
  // don't copy this pattern elsewhere.
  const [, forceRender] = useState(0)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')

  const position = game.current()
  const status = game.status()
  const lastMove = game.moves[game.ply - 1]

  const apply = (next: SelectionState, move?: { from: Square; to: Square; promotion?: PieceSymbol }) => {
    setSelection(next)
    if (move) {
      game.play(move)
      forceRender((n) => n + 1)
    }
  }

  const onSquareClick = (square: Square) => {
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    apply(out.state, out.move)
  }

  const highlights: Highlights = {
    ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
    legal:
      selection.kind === 'selected'
        ? position.legalMovesFrom(selection.square).map((m) => m.to)
        : [],
    ...(lastMove ? { lastMove: [lastMove.from, lastMove.to] as [Square, Square] } : {}),
    ...(status.kind === 'in-progress' && status.inCheck
      ? { check: position.kingSquare(position.turn()) ?? undefined }
      : {}),
  }

  return (
    <main className="app">
      <h1>Chess</h1>
      <p data-testid="turn">{position.turn() === 'w' ? 'White to move' : 'Black to move'}</p>
      <p data-testid="result">{describeStatus(status)}</p>
      <Board
        position={position}
        orientation={orientation}
        highlights={highlights}
        onSquareClick={onSquareClick}
      />
      <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
        Flip board
      </button>
      <button
        onClick={() => {
          game.undo()
          setSelection({ kind: 'idle' })
          forceRender((n) => n + 1)
        }}
      >
        Undo
      </button>
      {selection.kind === 'awaiting-promotion' ? (
        <Promotion
          color={position.turn()}
          onChoose={(piece) => {
            const out = reduceSelection(selection, { kind: 'promotion-chosen', piece }, position)
            apply(out.state, out.move)
          }}
          onCancel={() => setSelection({ kind: 'idle' })}
        />
      ) : null}
    </main>
  )
}
