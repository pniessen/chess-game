import { useState } from 'react'
import type { PieceSymbol, Square } from '../../game-core/types'
import type { MatchController } from '../../match/controller'
import type { MatchSnapshot } from '../../match/types'
import { reduceSelection, type SelectionState } from '../Board/selection'
import { resignableSide } from './matchText'

/**
 * The board's click/promotion input and the move-history buttons (undo,
 * redo, jump, resign). Every move goes through `controller.submitHumanMove`.
 */
export function useMoveInput(controller: MatchController, snapshot: MatchSnapshot) {
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const [canRedo, setCanRedo] = useState(false)
  /**
   * Bumped by everything that changes the displayed position WITHOUT a move
   * being played. Undo, redo and a history jump can all land one ply on
   * from the position the board is showing — which is exactly what a played
   * move looks like — so the board is told to cut rather than animate (see
   * Board's `cutKey` and useMoveFlight). Purely cosmetic: nothing here
   * gates, delays or reorders the controller calls below.
   */
  const [cutKey, setCutKey] = useState(0)
  const cut = () => setCutKey((n) => n + 1)
  const game = snapshot.game
  const position = game.current()

  /** After a match starts or loads: nothing to redo, nothing selected. */
  const resetInput = () => {
    setCanRedo(false)
    setSelection({ kind: 'idle' })
    cut()
  }

  const apply = (
    next: SelectionState,
    move?: { from: Square; to: Square; promotion?: PieceSymbol },
  ) => {
    setSelection(next)
    if (move) {
      const result = controller.submitHumanMove(move)
      if (result.ok) setCanRedo(false)
    }
  }

  const onSquareClick = (square: Square) => {
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    apply(out.state, out.move)
  }

  const handleUndo = () => {
    if (game.moves.length === 0) return
    cut()
    controller.undo()
    setCanRedo(true)
    setSelection({ kind: 'idle' })
  }

  const handleRedo = () => {
    if (!canRedo) return
    cut()
    // The controller owns this: it re-derives `phase` from the position
    // redo() lands on (e.g. back onto a checkmate), not just the move data.
    const restored = controller.redo()
    if (restored) setCanRedo(false)
  }

  // Move-list jumps browse history via the controller's goTo(), which only
  // moves the *displayed* ply and never touches the live game. The
  // controller itself also refuses this while the engine is thinking (the
  // live position it's about to reply to must stay put); phase.kind is
  // checked here too so the button reflects the same rule the controller
  // enforces, rather than trusting the click to just no-op silently.
  const handleJump = (ply: number) => {
    if (snapshot.phase.kind === 'engine-thinking') return
    cut()
    controller.goTo(ply)
  }

  const handleResign = () => {
    const side = resignableSide(snapshot.config, snapshot.phase)
    if (side) controller.resign(side)
  }

  const choosePromotion = (piece: PieceSymbol) => {
    const out = reduceSelection(
      selection,
      { kind: 'promotion-chosen', piece },
      position,
    )
    apply(out.state, out.move)
  }

  const cancelPromotion = () => setSelection({ kind: 'idle' })

  return {
    selection,
    canRedo,
    cutKey,
    /** Snap the board to its next position instead of animating into it. */
    cut,
    resetInput,
    onSquareClick,
    choosePromotion,
    cancelPromotion,
    handleUndo,
    handleRedo,
    handleJump,
    handleResign,
  }
}
