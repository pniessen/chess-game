import type { HintSuggestion } from '../../coach/hints'
import { uciToIntent } from '../../engine/uci'
import type { Color, PlayedMove } from '../../game-core/types'
import { expectedMove, lastMoveOf, positionOf, type PuzzleSession } from '../../puzzles/session'
import { positionAfter } from '../../puzzles/spec'
import type { BlunderPuzzle } from '../../puzzles/types'
import type { Annotation } from '../Board/annotations'
import { hintAnnotations, hintText } from '../hints/hintView'

/** 1 = highlight the piece to move, 2 = also draw the move. Puzzles have no reasoning stage. */
export type PuzzleHintStage = 0 | 1 | 2

export function sideName(c: Color): 'White' | 'Black' {
  return c === 'w' ? 'White' : 'Black'
}

export function puzzleStatusText(s: PuzzleSession, solver: Color): string {
  switch (s.phase) {
    case 'setup':
      return "Watch your opponent's move…"
    case 'solver':
      return s.step === 0 ? `Find the best move for ${sideName(solver)}.` : 'Correct! Keep going.'
    case 'reply':
      return 'Correct!'
    case 'showing':
      return 'Showing the solution…'
    case 'solved':
      return 'Solved!'
    case 'failed':
      return "That's not it. Retry, or show the solution."
    case 'revealed':
      return 'Solution shown.'
  }
}

/** The listed solution move as a hint — puzzles never ask the engine. */
export function hintSuggestionOf(s: PuzzleSession): HintSuggestion | null {
  const intent = expectedMove(s)
  if (!intent) return null
  const position = positionOf(s)
  const played = position.clone().tryMove(intent)
  if (!played.ok) return null
  return {
    fen: position.fen(),
    from: played.move.from,
    to: played.move.to,
    san: played.move.san,
    piece: played.move.piece,
    lines: [],
  }
}

/**
 * The last move of the line as a full move record, replayed from the spec
 * — `lastMoveOf` only reports its two squares, and the board needs the
 * capture, castle and promotion detail to animate it. Null when there is
 * no move yet or the line does not replay (a corrupt spec is never shown,
 * and degrades to no animation rather than throwing).
 */
export function lastPlayedMoveOf(s: PuzzleSession): PlayedMove | null {
  const uci = s.played[s.played.length - 1]
  if (uci === undefined) return null
  const before = positionAfter(s.spec.fen, s.played.slice(0, -1))
  const intent = uciToIntent(uci)
  if (!before || !intent) return null
  // `before` is this call's own Position, so playing on it mutates nothing.
  const played = before.tryMove(intent)
  return played.ok ? played.move : null
}

export function puzzleAnnotations(s: PuzzleSession, stage: PuzzleHintStage): Annotation[] {
  if (s.phase === 'failed' && s.wrongMove) {
    const wrong = uciToIntent(s.wrongMove)
    return wrong ? [{ kind: 'square', square: wrong.to, tone: 'blunder' }] : []
  }
  if (s.phase === 'solved') {
    const last = lastMoveOf(s)
    return last ? [{ kind: 'square', square: last.to, tone: 'best' }] : []
  }
  return hintAnnotations(stage, hintSuggestionOf(s))
}

export function puzzleHintText(s: PuzzleSession, stage: PuzzleHintStage): string {
  return hintText(stage, hintSuggestionOf(s), null)
}

export function puzzleHintButtonLabel(stage: PuzzleHintStage): string {
  return stage === 1 ? 'Show move' : 'Hint'
}

export function ratingDeltaText(delta: number): string {
  return `${delta >= 0 ? '+' : '-'}${Math.abs(delta)}`
}

export function mistakeOriginText(p: BlunderPuzzle): string {
  const opening = p.opening ? ` (${p.opening})` : ''
  return `From your game on ${p.gameDate.slice(0, 10)}${opening}: you played ${p.blunderLabel}?? — find the better move.`
}

/** The first unsolved mistake after `currentId` (wrapping); if all are solved, simply the next one. */
export function nextMistake(list: readonly BlunderPuzzle[], currentId: string | null): BlunderPuzzle | null {
  if (list.length === 0) return null
  const at = currentId === null ? -1 : list.findIndex((p) => p.id === currentId)
  const ordered = [...list.slice(at + 1), ...list.slice(0, at + 1)]
  return ordered.find((p) => !p.solved && p.id !== currentId) ?? ordered[0] ?? null
}
