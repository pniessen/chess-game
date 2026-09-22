import type { Color, DrawReason, GameStatus } from '../../game-core/types'
import type { MatchConfig, MatchPhase } from '../../match/types'

const DRAW_TEXT: Record<DrawReason, string> = {
  stalemate: 'Draw — stalemate',
  'insufficient-material': 'Draw — insufficient material',
  'threefold-repetition': 'Draw — threefold repetition',
  'fifty-move-rule': 'Draw — fifty-move rule',
}

/**
 * The result banner. Decision: derive it from `phase.reason` / `phase.winner`
 * — never from `status.kind` alone — because a resignation or a flag leaves
 * `status.kind` at 'in-progress' (the rules didn't end the game). `status`
 * here is only ever `phase.status`, the status captured at the moment the
 * match finished, so browsing history afterwards can never change the banner.
 */
export function describeResult(phase: MatchPhase, displayed: GameStatus): string {
  const name = (c: Color) => (c === 'w' ? 'White' : 'Black')
  if (phase.kind === 'finished') {
    const { status, reason, winner } = phase
    switch (reason) {
      case 'normal':
        if (status.kind === 'checkmate') return `Checkmate — ${name(status.winner)} wins`
        if (status.kind === 'draw') return DRAW_TEXT[status.reason]
        return winner ? `${name(winner)} wins` : 'Game over'
      case 'flag':
        return winner ? `${name(winner)} wins on time` : 'Draw on time'
      case 'resign': {
        if (!winner) return 'Resignation'
        const loser = winner === 'w' ? 'b' : 'w'
        return `${name(loser)} resigns — ${name(winner)} wins`
      }
      case 'engine-error':
        return 'Game halted — engine error'
    }
  }
  return displayed.kind === 'in-progress' && displayed.inCheck ? 'Check' : ''
}

/** Which side, if any, is a human who can actually click "Resign" right now. */
export function resignableSide(config: MatchConfig, phase: MatchPhase): Color | null {
  const whiteHuman = config.white.kind === 'human'
  const blackHuman = config.black.kind === 'human'
  if (whiteHuman && blackHuman) {
    return phase.kind === 'awaiting-human' ? phase.side : null
  }
  if (whiteHuman) return 'w'
  if (blackHuman) return 'b'
  return null
}
