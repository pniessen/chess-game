import { useCallback, useEffect, useState } from 'react'
import type { MoveIntent } from '../../game-core/types'
import {
  noteHint,
  playReply,
  playSetup,
  playSolutionStep,
  retrySession,
  revealSolution,
  startSession,
  submitMove,
  type PuzzleSession,
} from '../../puzzles/session'
import type { PuzzleSpec } from '../../puzzles/types'
import type { PuzzleHintStage } from './puzzleView'

export interface PuzzleDelays {
  setup: number
  reply: number
  solutionStep: number
}

export const PUZZLE_DELAYS: PuzzleDelays = { setup: 600, reply: 400, solutionStep: 700 }

interface State {
  key: string | null
  session: PuzzleSession | null
  hint: PuzzleHintStage
}

const fresh = (spec: PuzzleSpec | null, key: string | null): State => ({
  key,
  session: spec ? startSession(spec) : null,
  hint: 0,
})

/**
 * One puzzle attempt. `key` identifies the puzzle being shown (a new key =
 * a new attempt, even of the same puzzle); `spec` is only read when the key
 * changes. All transitions are the pure functions of src/puzzles/session.ts.
 */
export function usePuzzleSession(spec: PuzzleSpec | null, key: string | null, delays: PuzzleDelays = PUZZLE_DELAYS) {
  const [state, setState] = useState<State>(() => fresh(spec, key))

  // A new puzzle restarts during render (React's "adjust state on prop
  // change" pattern): no frame, and no effect, ever sees the old session.
  let current = state
  if (state.key !== key) {
    current = fresh(spec, key)
    setState(current)
  }
  const { session } = current

  useEffect(() => {
    if (!session) return
    const next =
      session.phase === 'setup'
        ? { run: playSetup, ms: delays.setup }
        : session.phase === 'reply'
          ? { run: playReply, ms: delays.reply }
          : session.phase === 'showing'
            ? { run: playSolutionStep, ms: delays.solutionStep }
            : null
    if (!next) return
    // Only ever advance the exact session this timer was scheduled for.
    const timer = setTimeout(
      () => setState((s) => (s.session === session ? { ...s, session: next.run(session) } : s)),
      next.ms,
    )
    return () => clearTimeout(timer)
  }, [session, delays])

  const submit = useCallback((intent: MoveIntent) => {
    setState((s) => {
      if (!s.session) return s
      const out = submitMove(s.session, intent)
      return out.session === s.session ? s : { ...s, session: out.session, hint: 0 }
    })
  }, [])

  const retry = useCallback(() => {
    setState((s) => (s.session ? { ...s, session: retrySession(s.session), hint: 0 } : s))
  }, [])

  const hint = useCallback(() => {
    setState((s) => {
      if (!s.session || s.session.phase !== 'solver' || s.hint >= 2) return s
      return { ...s, session: noteHint(s.session), hint: (s.hint + 1) as PuzzleHintStage }
    })
  }, [])

  const showSolution = useCallback(() => {
    setState((s) => (s.session ? { ...s, session: revealSolution(s.session), hint: 0 } : s))
  }, [])

  return { session, hintStage: current.hint, submit, retry, hint, showSolution }
}
