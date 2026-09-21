import { useEffect, useReducer } from 'react'
import { evalFromLines, type WhiteEval } from '../engine/evaluation'
import type { AnalysisRequest, SearchOutcome } from '../engine/lane'
import type { GameStatus } from '../game-core/types'

export const EVAL_BUDGET = { depth: 14, moveTimeMs: 300, multiPv: 1 } as const

export type EvalAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>
export type EvalCache = Map<string, WhiteEval>

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
