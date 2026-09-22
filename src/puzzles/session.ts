import { Position } from '../game-core/position'
import { uciOf } from '../game-core/notation'
import type { Color, MoveIntent, Square } from '../game-core/types'
import { uciToIntent } from '../engine/uci'
import { positionAfter } from './spec'
import type { PuzzleSpec } from './types'

export type SessionPhase =
  | 'setup' //    the opponent's setup move has not been played yet (UI plays it after a delay)
  | 'solver' //   waiting for the solver's move
  | 'reply' //    the solver was right; the opponent's reply is pending (UI plays it after a delay)
  | 'showing' //  Show solution: the line is being played back
  | 'solved'
  | 'failed' //   a wrong move was played; it stays on the board
  | 'revealed' // the whole solution has been shown

export type PuzzleOutcome = 'win' | 'loss'

export interface PuzzleSession {
  readonly spec: PuzzleSpec
  /** UCI moves applied to spec.fen so far (the setup move first, when there is one). */
  readonly played: readonly string[]
  /** Index in spec.solution of the next move to be played. */
  readonly step: number
  readonly phase: SessionPhase
  /** The rejected move, while phase is 'failed'. */
  readonly wrongMove: string | null
  /** Decided once, by the first decisive event; never changes afterwards. */
  readonly outcome: PuzzleOutcome | null
}

export type Verdict = 'correct' | 'solved' | 'wrong' | 'illegal' | 'ignored'

const opening = (spec: PuzzleSpec): string[] => (spec.setup === null ? [] : [spec.setup])
const decide = (s: PuzzleSession, o: PuzzleOutcome): PuzzleOutcome => s.outcome ?? o

export function startSession(spec: PuzzleSpec): PuzzleSession {
  return { spec, played: [], step: 0, phase: spec.setup === null ? 'solver' : 'setup', wrongMove: null, outcome: null }
}

export function playSetup(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'setup' || s.spec.setup === null) return s
  return { ...s, played: [s.spec.setup], phase: 'solver' }
}

/** The displayed position. Validated specs always replay; a corrupt one degrades instead of throwing. */
export function positionOf(s: PuzzleSession): Position {
  return positionAfter(s.spec.fen, s.played) ?? positionAfter(s.spec.fen, []) ?? new Position()
}

/** The side the user plays: whoever is to move once the setup move is on the board. */
export function solverColorOf(spec: PuzzleSpec): Color {
  return positionAfter(spec.fen, opening(spec))?.turn() ?? 'w'
}

export function lastMoveOf(s: PuzzleSession): { from: Square; to: Square } | null {
  const uci = s.played[s.played.length - 1]
  const intent = uci ? uciToIntent(uci) : null
  return intent ? { from: intent.from, to: intent.to } : null
}

/** The listed solution move the solver should play now; null when it is not their turn. */
export function expectedMove(s: PuzzleSession): MoveIntent | null {
  if (s.phase !== 'solver') return null
  const uci = s.spec.solution[s.step]
  return uci ? uciToIntent(uci) : null
}

export function submitMove(s: PuzzleSession, intent: MoveIntent): { session: PuzzleSession; verdict: Verdict } {
  if (s.phase !== 'solver') return { session: s, verdict: 'ignored' }
  const position = positionOf(s)
  const r = position.tryMove(intent)
  if (!r.ok) return { session: s, verdict: 'illegal' }
  const uci = uciOf(r.move)
  const played = [...s.played, uci]
  const mates = position.status().kind === 'checkmate'
  if (uci === s.spec.solution[s.step] || mates) {
    const step = s.step + 1
    if (mates || step >= s.spec.solution.length) {
      return { session: { ...s, played, step, phase: 'solved', outcome: decide(s, 'win') }, verdict: 'solved' }
    }
    return { session: { ...s, played, step, phase: 'reply' }, verdict: 'correct' }
  }
  return { session: { ...s, played, phase: 'failed', wrongMove: uci, outcome: decide(s, 'loss') }, verdict: 'wrong' }
}

export function playReply(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'reply') return s
  const uci = s.spec.solution[s.step]
  if (uci === undefined) return { ...s, phase: 'solved' }
  return { ...s, played: [...s.played, uci], step: s.step + 1, phase: 'solver' }
}

export function retrySession(s: PuzzleSession): PuzzleSession {
  if (s.phase === 'setup' || s.phase === 'showing') return s
  return { ...s, played: opening(s.spec), step: 0, phase: 'solver', wrongMove: null }
}

/** A hint was shown: on a rated puzzle that is a loss (if nothing decided it earlier). */
export function noteHint(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'solver') return s
  return { ...s, outcome: decide(s, 'loss') }
}

export function revealSolution(s: PuzzleSession): PuzzleSession {
  if (s.phase === 'setup' || s.phase === 'showing') return s
  return { ...s, played: opening(s.spec), step: 0, phase: 'showing', wrongMove: null, outcome: decide(s, 'loss') }
}

export function playSolutionStep(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'showing') return s
  const uci = s.spec.solution[s.step]
  if (uci === undefined) return { ...s, phase: 'revealed' }
  const step = s.step + 1
  return { ...s, played: [...s.played, uci], step, phase: step >= s.spec.solution.length ? 'revealed' : 'showing' }
}
