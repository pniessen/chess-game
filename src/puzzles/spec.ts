import { Position } from '../game-core/position'
import { uciToIntent } from '../engine/uci'
import type { BlunderPuzzle, PuzzleSpec, RatedPuzzle } from './types'

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function isUci(s: string): boolean {
  return UCI.test(s)
}

export function specOfRated(p: RatedPuzzle): PuzzleSpec {
  return { fen: p.fen, setup: p.moves[0] ?? null, solution: p.moves.slice(1) }
}

export function specOfBlunder(p: BlunderPuzzle): PuzzleSpec {
  return { fen: p.fen, setup: null, solution: [p.solution] }
}

/** The position after `ucis` from `fen`, through game-core; null if the FEN or any move is not legal. */
export function positionAfter(fen: string, ucis: readonly string[]): Position | null {
  const loaded = Position.fromFen(fen)
  if (!loaded.ok) return null
  for (const uci of ucis) {
    const intent = isUci(uci) ? uciToIntent(uci) : null
    if (!intent || !loaded.position.tryMove(intent).ok) return null
  }
  return loaded.position
}

/** Null when the whole line (setup, then solution) plays legally; otherwise why not. Never throws. */
export function validateSpec(spec: PuzzleSpec): string | null {
  const n = spec.solution.length
  if (n === 0 || n % 2 === 0) return `the solution must have an odd number of moves (got ${n})`
  const loaded = Position.fromFen(spec.fen)
  if (!loaded.ok) return `bad FEN: ${loaded.error}`
  const line = spec.setup === null ? [...spec.solution] : [spec.setup, ...spec.solution]
  for (const [i, uci] of line.entries()) {
    const intent = isUci(uci) ? uciToIntent(uci) : null
    if (!intent) return `move ${i + 1} is not UCI: ${uci}`
    const r = loaded.position.tryMove(intent)
    if (!r.ok) return `move ${i + 1} (${uci}) is ${r.reason}`
  }
  return null
}
