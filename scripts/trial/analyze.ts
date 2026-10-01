/**
 * Stockfish's view of every move of a trial game: the centipawn loss (CPL)
 * against the engine's best move at a fixed depth. Each position is searched
 * once: a move's loss is the score before it (from the mover's side) less the
 * negated score of the position it leads to, floored at 0 and capped at 1000.
 * Cached per game under analysis/, so a second report is cheap.
 */
import { join } from 'node:path'
import type { ClaudeModelKey } from '../../src/claude/models'
import { Position } from '../../src/game-core/position'
import type { Color } from '../../src/game-core/types'
import { readJson, writeJsonAtomic } from './store'
import type { TrialEngine } from './stockfish'
import type { GameRecord, Score } from './types'

export const ANALYSIS_DEPTH = 14
export const CPL_CAP = 1000
/** A forced mate scores this, less the moves to it. */
const MATE_CP = 10_000

/** Thresholds, in centipawns lost by the move. */
export const BLUNDER = 300
export const MISTAKE = 100
export const INACCURACY = 50

/** The first 20 plies are the opening; after that, an endgame once the non-pawn material (both sides, N/B 3, R 5, Q 9) is 26 or less. */
export const OPENING_PLIES = 20
export const ENDGAME_MATERIAL = 26

export type Phase = 'opening' | 'middlegame' | 'endgame'

export interface PlyAnalysis {
  ply: number
  side: Color
  model: ClaudeModelKey
  san: string
  fallback: boolean
  phase: Phase
  /** Stockfish's best move in the position before (UCI). */
  best: string | null
  /** Mover's point of view, centipawns (mates as +-10000 less the distance). */
  before: number
  after: number
  cpl: number
}

export interface GameAnalysis {
  v: 1
  gameId: string
  depth: number
  /** The moves this analysis is of, so a replayed game is analysed again. */
  movesKey: string
  plies: PlyAnalysis[]
}

export function scoreToCp(s: Score): number {
  if ('cp' in s) return s.cp
  if (s.mate > 0) return MATE_CP - s.mate
  return -MATE_CP - s.mate // mate <= 0: being mated in |mate|
}

const VALUE: Record<string, number> = { n: 3, b: 3, r: 5, q: 9 }

/** Non-pawn material of both sides, from a FEN's placement. */
export function nonPawnMaterial(fen: string): number {
  let sum = 0
  for (const ch of fen.split(' ')[0] ?? '') sum += VALUE[ch.toLowerCase()] ?? 0
  return sum
}

export function phaseOf(ply: number, fenBefore: string): Phase {
  if (ply <= OPENING_PLIES) return 'opening'
  return nonPawnMaterial(fenBefore) <= ENDGAME_MATERIAL ? 'endgame' : 'middlegame'
}

export async function analyzeGame(g: GameRecord, engine: TrialEngine, depth = ANALYSIS_DEPTH): Promise<GameAnalysis> {
  // Replay on one Position so repetition and the fifty-move count are known.
  const pos = new Position()
  const fens = [pos.fen()]
  const terminal: Array<null | 'mate' | 'draw'> = [null]
  for (const m of g.moves) {
    const r = pos.trySan(m.san)
    if (!r.ok) throw new Error(`${g.gameId}: move ${m.ply} ${m.san} does not replay`)
    fens.push(pos.fen())
    const st = pos.status()
    terminal.push(st.kind === 'checkmate' ? 'mate' : st.kind === 'draw' ? 'draw' : null)
  }
  const evals: Array<{ cp: number; best: string | null } | null> = []
  for (let i = 0; i < fens.length; i++) {
    if (terminal[i]) {
      evals.push(null)
      continue
    }
    const e = await engine.evaluate(fens[i]!, depth)
    evals.push({ cp: scoreToCp(e.score), best: e.best })
  }
  const plies: PlyAnalysis[] = g.moves.map((m, i) => {
    const before = evals[i]?.cp ?? 0
    const t = terminal[i + 1]
    const after = t === 'mate' ? MATE_CP : t === 'draw' ? 0 : -(evals[i + 1]?.cp ?? 0)
    return {
      ply: m.ply,
      side: m.side,
      model: m.model,
      san: m.san,
      fallback: m.fallback,
      phase: phaseOf(m.ply, fens[i]!),
      best: evals[i]?.best ?? null,
      before,
      after,
      cpl: Math.min(CPL_CAP, Math.max(0, before - after)),
    }
  })
  return { v: 1, gameId: g.gameId, depth, movesKey: g.moves.map((m) => m.san).join(' '), plies }
}

/** Analyse every game, reading and writing the cache in `<dir>/analysis/`. */
export async function analyzeAll(
  dir: string,
  games: readonly GameRecord[],
  engine: () => Promise<TrialEngine>,
  opts: { depth?: number; log?: (line: string) => void } = {},
): Promise<Map<string, GameAnalysis>> {
  const depth = opts.depth ?? ANALYSIS_DEPTH
  const out = new Map<string, GameAnalysis>()
  let fresh = 0
  for (const g of games) {
    const file = join(dir, 'analysis', `${g.gameId}.d${depth}.json`)
    const key = g.moves.map((m) => m.san).join(' ')
    const cached = await readJson<GameAnalysis>(file)
    if (cached && cached.v === 1 && cached.depth === depth && cached.movesKey === key) {
      out.set(g.gameId, cached)
      continue
    }
    const t0 = Date.now()
    const a = await analyzeGame(g, await engine(), depth)
    await writeJsonAtomic(file, a)
    out.set(g.gameId, a)
    fresh++
    opts.log?.(`analysed ${g.gameId} (${g.plies} plies, depth ${depth}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  opts.log?.(`analysis: ${games.length} games, ${games.length - fresh} from the cache, ${fresh} analysed now`)
  return out
}
