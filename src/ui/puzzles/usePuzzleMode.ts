import { useCallback, useRef, useState } from 'react'
import type { MatchPhase } from '../../match/types'

/** The part of MatchController puzzle mode is allowed to touch. */
export interface PausableMatch {
  snapshot(): { phase: MatchPhase }
  pause(): void
  resume(): void
}

export type Screen = 'game' | 'puzzles'

/** Only a live game is paused; finished, idle or user-paused games are left exactly as they are. */
export function shouldPauseForPuzzles(phase: MatchPhase): boolean {
  return phase.kind === 'awaiting-human' || phase.kind === 'engine-thinking'
}

/**
 * Game <-> puzzles. While puzzles are open the match is paused through the
 * controller (no engine moves, no clocks); on the way back it is resumed —
 * but only if entering paused it.
 */
export function usePuzzleMode(match: PausableMatch) {
  const [screen, setScreen] = useState<Screen>('game')
  const activeRef = useRef(false)
  const pausedRef = useRef(false)

  const enter = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    pausedRef.current = shouldPauseForPuzzles(match.snapshot().phase)
    if (pausedRef.current) match.pause()
    setScreen('puzzles')
  }, [match])

  const exit = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    if (pausedRef.current) {
      pausedRef.current = false
      match.resume()
    }
    setScreen('game')
  }, [match])

  return { screen, enter, exit }
}
