import { useCallback, useEffect, useRef, useState } from 'react'
import type { WhiteEval } from '../../engine/evaluation'
import { runReview, type GameReview, type ReviewAnalyze, type ReviewInput } from '../../review/run'

export type ReviewState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; review: GameReview; summary: string | null; summarySource: 'claude' | 'templated' | null }
  | { kind: 'error'; message: string }

export type Summarize = (review: GameReview, signal: AbortSignal) => Promise<{ text: string; source: 'claude' | 'templated' }>

const IDLE: ReviewState = { kind: 'idle' }

/**
 * The post-game review of ONE exact game: `gameKey` identifies the game and
 * its move list (see App's reviewKey). Whenever the key changes — undo,
 * redo, a different move after undo, load, new game, start-from-opening —
 * the review is invalidated: any running analysis is aborted (freeing the
 * single engine worker) and marks/summary disappear. Browsing (goTo) does
 * not change the key.
 *
 * The state is also masked at render time, so not even one frame shows a
 * review that belongs to a different move list.
 */
export function useReview(deps: {
  gameKey: string
  analyze: ReviewAnalyze | null
  summarize: Summarize
  onEval: (fen: string, e: WhiteEval) => void
  onComplete: (review: GameReview) => void
}) {
  const [inner, setInner] = useState<{ key: string | null; state: ReviewState }>({ key: null, state: IDLE })
  const ctrlRef = useRef<AbortController | null>(null)
  /** The key of the review that is running or shown; null when idle. */
  const activeKeyRef = useRef<string | null>(null)
  // The latest callbacks, without restarting a running review when they change.
  const depsRef = useRef(deps)
  depsRef.current = deps

  const cancel = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    activeKeyRef.current = null
    setInner((prev) => (prev.state.kind === 'idle' ? prev : { key: null, state: IDLE }))
  }, [])

  // Invalidate on any change of the game or its move list.
  const { gameKey } = deps
  useEffect(() => {
    if (activeKeyRef.current !== null && activeKeyRef.current !== gameKey) cancel()
  }, [gameKey, cancel])

  useEffect(() => () => ctrlRef.current?.abort(), [])

  const start = useCallback((input: ReviewInput) => {
    const analyze = depsRef.current.analyze
    if (!analyze) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const key = depsRef.current.gameKey
    activeKeyRef.current = key
    const total = input.moves.length + 1
    const put = (state: ReviewState) => {
      if (!ctrl.signal.aborted) setInner({ key, state })
    }
    put({ kind: 'running', done: 0, total })

    runReview({
      ...input,
      analyze,
      signal: ctrl.signal,
      onProgress: (done) => put({ kind: 'running', done, total }),
      onEval: (fen, e) => depsRef.current.onEval(fen, e),
    }).then(
      async (review) => {
        if (ctrl.signal.aborted) return
        put({ kind: 'done', review, summary: null, summarySource: null })
        depsRef.current.onComplete(review)
        try {
          const s = await depsRef.current.summarize(review, ctrl.signal)
          put({ kind: 'done', review, summary: s.text, summarySource: s.source })
        } catch {
          // Summarize is expected to fall back on its own; never leave "Writing…" up forever.
          put({ kind: 'done', review, summary: 'The summary could not be written.', summarySource: null })
        }
      },
      () => put({ kind: 'error', message: 'The review could not be completed: the engine is unavailable.' }),
    )
  }, [])

  const state = inner.key === deps.gameKey ? inner.state : IDLE
  return { state, start, cancel }
}
