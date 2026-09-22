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
  return {
    ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
    legal:
      selection.kind === 'selected'
        ? position.legalMovesFrom(selection.square).map((m) => m.to)
        : [],
    ...(lastMove ? { lastMove: [lastMove.from, lastMove.to] as [Square, Square] } : {}),
    ...(displayedStatus.kind === 'in-progress' && displayedStatus.inCheck
      ? { check: position.kingSquare(position.turn()) ?? undefined }
      : {}),
  }
}
