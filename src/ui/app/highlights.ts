import type { Position } from '../../game-core/position'
import type { GameStatus, PlayedMove, Square } from '../../game-core/types'
import type { Highlights } from '../Board/Board'
import type { SelectionState } from '../Board/selection'

/** The board's square highlights for the DISPLAYED position. */
export function highlightsFor({
  selection,
  position,
  lastMove,
  displayedStatus,
}: {
  selection: SelectionState
  position: Position
  lastMove: PlayedMove | undefined
  /** `position.status()`, passed in so it is computed once per render. */
  displayedStatus: GameStatus
}): Highlights {
  // Checkmate leaves the mated king in check (it's the position a losing
  // move produces), so the highlight must cover BOTH cases — otherwise the
  // check glow would vanish on the very move that matters most. `checkmate`
  // lets Board hold that glow steady and play the one-off board shake
  // instead of letting it keep pulsing.
  const inCheck = (displayedStatus.kind === 'in-progress' && displayedStatus.inCheck) ||
    displayedStatus.kind === 'checkmate'
  return {
    ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
    legal:
      selection.kind === 'selected'
        ? position.legalMovesFrom(selection.square).map((m) => m.to)
        : [],
    ...(lastMove ? { lastMove: [lastMove.from, lastMove.to] as [Square, Square] } : {}),
    ...(inCheck ? { check: position.kingSquare(position.turn()) ?? undefined } : {}),
    ...(displayedStatus.kind === 'checkmate' ? { checkmate: true } : {}),
  }
}
