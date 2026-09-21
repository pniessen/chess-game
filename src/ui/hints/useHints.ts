import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineInfo } from '../../engine/uci'
import type { Position } from '../../game-core/position'
import { suggestionFrom, type HintStage, type HintSuggestion } from '../../coach/hints'
import { hintAnnotations, hintButtonLabel, hintText } from './hintView'

export type HintAnalyze = (
  fen: string,
  signal: AbortSignal,
) => Promise<{ best: string; lines: readonly EngineInfo[] }>

export type HintReasoner = (s: HintSuggestion, position: Position, signal: AbortSignal) => Promise<string>

interface State {
  stage: HintStage
  suggestion: HintSuggestion | null
  reasoning: string | null
  pending: boolean
  message: string | null
}

const INITIAL: State = { stage: 0, suggestion: null, reasoning: null, pending: false, message: null }

/**
 * Graded hints: nudge -> move -> reasoning. `resetKey` must change on any
 * move, undo/redo, navigation or new game; that clears the hint and aborts
 * whatever it was still waiting for (a stale reply is dropped by the
 * aborted-signal check, whether or not the producer honours the signal).
 */
export function useHints({
  resetKey,
  analyze,
  reason,
}: {
  resetKey: string
  analyze: HintAnalyze
  reason: HintReasoner
}) {
  const [state, setState] = useState<State>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(INITIAL)
  }, [resetKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const advance = useCallback(
    (position: Position) => {
      if (state.pending || state.stage === 3) return
      if (state.stage === 1) {
        setState((s) => ({ ...s, stage: 2 }))
        return
      }
      const ctrl = new AbortController()
      abortRef.current?.abort()
      abortRef.current = ctrl

      if (state.stage === 0) {
        setState((s) => ({ ...s, pending: true, message: null }))
        analyze(position.fen(), ctrl.signal)
          .then((out) => {
            if (ctrl.signal.aborted) return
            const suggestion = suggestionFrom(out.lines, position)
            setState(
              suggestion
                ? { ...INITIAL, stage: 1, suggestion }
                : { ...INITIAL, message: 'No hint available.' },
            )
          })
          .catch(() => {
            if (!ctrl.signal.aborted) setState({ ...INITIAL, message: 'Hint unavailable.' })
          })
        return
      }

      // stage 2 -> 3: the reasoning.
      const suggestion = state.suggestion
      if (!suggestion) return
      setState((s) => ({ ...s, pending: true }))
      reason(suggestion, position, ctrl.signal)
        .then((text) => {
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, stage: 3, pending: false, reasoning: text }))
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setState((s) => ({ ...s, stage: 3, pending: false, reasoning: 'No explanation available.' }))
          }
        })
    },
    [state, analyze, reason],
  )

  return {
    stage: state.stage,
    pending: state.pending,
    text: state.message ?? hintText(state.stage, state.suggestion, state.reasoning),
    label: hintButtonLabel(state.stage, state.pending),
    annotations: hintAnnotations(state.stage, state.suggestion),
    exhausted: state.stage === 3,
    advance,
  }
}
