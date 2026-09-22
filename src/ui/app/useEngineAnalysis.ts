import { useMemo, useState } from 'react'
import type { MatchController } from '../../match/controller'
import { BoundedEvalCache, type EvalAnalyze } from '../useEvaluation'

/**
 * UI analysis goes only through `controller.analyze` (its EngineLane never
 * races the engine's own move search), and only while an engine exists.
 * The eval cache is keyed by FEN and shared by the eval bar and the review.
 */
export function useEngineAnalysis(
  controller: Pick<MatchController, 'analyze'>,
  engineAvailable: boolean,
): { evalCache: BoundedEvalCache; analyzeForEval: EvalAnalyze | null } {
  // Evaluations by FEN, shared by the eval bar and the review. Bounded (LRU):
  // both fill it, and it lives for the whole session.
  const [evalCache] = useState(() => new BoundedEvalCache())
  const analyzeForEval = useMemo<EvalAnalyze | null>(
    () => (engineAvailable ? (req, signal) => controller.analyze(req, signal) : null),
    [engineAvailable, controller],
  )
  return { evalCache, analyzeForEval }
}
