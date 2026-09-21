import { evalFromLines, whiteWinPercent, type WhiteEval } from '../engine/evaluation'
import type { AnalysisRequest, SearchOutcome } from '../engine/lane'
import { principalLine, uciToIntent } from '../engine/uci'
import { uciOf } from '../game-core/notation'
import { Position } from '../game-core/position'
import type { Color, GameStatus, PlayedMove } from '../game-core/types'
import { classifyMove, gameAccuracy, type MoveClass } from './analysis'

/** Fixed per-position budget; see the Task 12 ruling. */
export const REVIEW_BUDGET = { depth: 12, moveTimeMs: 150, multiPv: 1 } as const

export type ReviewAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>

export interface ReviewedMove {
  ply: number
  san: string
  uci: string
  mover: Color
  classification: MoveClass
  /** Mover's win-percentage points lost. */
  loss: number
  bestUci: string | null
  bestSan: string | null
}

export interface GameReview {
  firstMover: Color
  /** White-POV evaluation of the position after each ply (index 0 = start). */
  evals: WhiteEval[]
  moves: ReviewedMove[]
  accuracy: { w: number | null; b: number | null }
}

export interface ReviewInput {
  startFen: string
  moves: readonly PlayedMove[]
  /** The LIVE game's status: decides whether the last position is terminal. */
  finalStatus: GameStatus
}

function terminalEval(status: GameStatus): WhiteEval | null {
  if (status.kind === 'checkmate') return { kind: 'result', winner: status.winner }
  if (status.kind === 'draw') return { kind: 'result', winner: null }
  return null
}

function sanOf(fen: string, uci: string | null): string | null {
  const intent = uci ? uciToIntent(uci) : null
  if (!intent) return null
  const r = new Position(fen).tryMove(intent)
  return r.ok ? r.move.san : null
}

export async function runReview(
  opts: ReviewInput & {
    analyze: ReviewAnalyze
    signal: AbortSignal
    onProgress?: (done: number, total: number) => void
    onEval?: (fen: string, e: WhiteEval) => void
  },
): Promise<GameReview> {
  // Snapshot the move list up front, synchronously, before any `await` below.
  // `opts.moves` can be the LIVE, mutable `played` array of a `Game` (e.g.
  // App.tsx passes `game.moves`); an undo() landing between two awaited
  // analyses mutates that SAME array in place (Game.undo() pops it). Reading
  // `opts.moves` again after the loop's last await — as this function used
  // to, for `firstMover` and the final `.map()` — would then see a shorter
  // array than the one `fens` was built from, misaligning `evals`/`bests`
  // against `moves` and producing a review that doesn't match the game it
  // was supposedly reviewing. Copying here, before the first `await`, is
  // immune to that: every read below uses this fixed snapshot instead.
  const moves = [...opts.moves]
  const fens = [opts.startFen, ...moves.map((m) => m.fenAfter)]
  const total = fens.length
  const evals: WhiteEval[] = []
  const bests: Array<string | null> = []

  for (let i = 0; i < total; i++) {
    const fen = fens[i] ?? opts.startFen
    const terminal = i === total - 1 ? terminalEval(opts.finalStatus) : null
    if (terminal) {
      evals.push(terminal)
      bests.push(null)
    } else {
      const out = await opts.analyze({ fen, ...REVIEW_BUDGET }, opts.signal)
      const turn: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w'
      const e: WhiteEval = evalFromLines(out.lines, turn) ?? { kind: 'cp', cp: 0 }
      evals.push(e)
      bests.push(principalLine(out.lines)?.pv[0] ?? (out.best && out.best !== '(none)' ? out.best : null))
      opts.onEval?.(fen, e)
    }
    opts.onProgress?.(i + 1, total)
  }

  const firstMover: Color = moves[0]?.color ?? (opts.startFen.split(' ')[1] === 'b' ? 'b' : 'w')
  const reviewedMoves: ReviewedMove[] = moves.map((m, idx) => {
    const ply = idx + 1
    const bestUci = bests[idx] ?? null
    const uci = uciOf(m)
    const before = evals[idx] ?? { kind: 'cp', cp: 0 }
    const after = evals[ply] ?? before
    const { classification, loss } = classifyMove({ before, after, mover: m.color, playedUci: uci, bestUci })
    return { ply, san: m.san, uci, mover: m.color, classification, loss, bestUci, bestSan: sanOf(fens[idx] ?? opts.startFen, bestUci) }
  })

  return { firstMover, evals, moves: reviewedMoves, accuracy: gameAccuracy(evals.map(whiteWinPercent), firstMover) }
}
