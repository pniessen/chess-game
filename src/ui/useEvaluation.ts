import { useEffect, useReducer } from 'react'
import { evalFromLines, type WhiteEval } from '../engine/evaluation'
import type { AnalysisRequest, SearchOutcome } from '../engine/lane'
import type { GameStatus } from '../game-core/types'

export const EVAL_BUDGET = { depth: 14, moveTimeMs: 300, multiPv: 1 } as const

export type EvalAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>
export type EvalCache = Map<string, WhiteEval>

/** Default bound for the app's eval cache: a long game's review plus plenty of browsing. */
export const EVAL_CACHE_LIMIT = 500

/**
 * A Map that keeps at most `limit` entries, evicting the least recently used
 * (a `get` hit or a `set` counts as a use). The eval bar and the post-game
 * review both fill the app's cache, so without a bound it grows for the
 * whole session.
 */
export class BoundedEvalCache extends Map<string, WhiteEval> {
  private readonly limit: number

  constructor(limit = EVAL_CACHE_LIMIT) {
    super()
    this.limit = limit
  }

  override get(fen: string): WhiteEval | undefined {
    const e = super.get(fen)
    if (e !== undefined) {
      super.delete(fen)
      super.set(fen, e)
    }
    return e
  }

  override set(fen: string, e: WhiteEval): this {
    super.delete(fen)
    super.set(fen, e)
    while (this.size > this.limit) {
      const oldest = this.keys().next()
      if (oldest.done) break
      super.delete(oldest.value)
    }
    return this
  }
}

/**
 * The evaluation of the DISPLAYED position (so browsing history shows each
 * ply's eval). Terminal positions are scored without the engine. Results
 * are cached by FEN; the post-game review fills the same cache.
 */
export function useEvaluation({
  analyze,
  fen,
  status,
  enabled,
  cache,
}: {
  analyze: EvalAnalyze | null
  fen: string
  status: GameStatus
  enabled: boolean
  cache: EvalCache
}): WhiteEval | null {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const inProgress = status.kind === 'in-progress'

  useEffect(() => {
    if (!enabled || !analyze || !inProgress || cache.has(fen)) return
    const ctrl = new AbortController()
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    analyze({ fen, ...EVAL_BUDGET }, ctrl.signal)
      .then((out) => {
        if (ctrl.signal.aborted) return
        const e = evalFromLines(out.lines, turn)
        if (e) {
          cache.set(fen, e)
          bump()
        }
      })
      .catch(() => {
        // Aborted, pre-empted forever, or the engine died: the bar just stays put.
      })
    return () => ctrl.abort()
  }, [analyze, fen, enabled, inProgress, cache])

  if (status.kind === 'checkmate') return { kind: 'result', winner: status.winner }
  if (status.kind === 'draw') return { kind: 'result', winner: null }
  return cache.get(fen) ?? null
}
