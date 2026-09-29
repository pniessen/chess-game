import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BeginResult, ClaudeMover } from '../../claude/gameClient'
import type { ClaudeModelKey } from '../../claude/models'
import type { MatchController } from '../../match/controller'
import { claudeRecordOf, isClaudeGame } from './claudeRecord'

export type ClaudeStartError = Extract<BeginResult, { ok: false }>['kind']

export interface ClaudeSession {
  /**
   * End any open session (a `ClaudeMover` never clears one by itself), then
   * begin one for these models. True only when it began and nothing else
   * replaced the match meanwhile; on a refusal `error` says why.
   */
  begin: (white: ClaudeModelKey, black: ClaudeModelKey) => Promise<boolean>
  /** A non-Claude start or load is replacing the match: end the session and forget any begin in flight. */
  replace: () => void
  /** Whether a server game is open for the match on the board. */
  isOpen: () => boolean
  error: ClaudeStartError | null
  dismissError: () => void
}

/**
 * The server side of a Claude vs Claude game, as the UI drives it: `begin`
 * before the first move, `end` (with the PGN and fallback counts) when the
 * game finishes, when another game replaces it, and on `pagehide` (the
 * client's end uses `keepalive`, so it outlives the page).
 *
 * The controller never begins or ends anything itself (its doc says the UI
 * owns that); it only asks the mover for moves.
 */
export function useClaudeSession(controller: MatchController, mover: ClaudeMover | null): ClaudeSession {
  const openRef = useRef(false)
  /** Bumped by every begin and every replace: a begin that lands after either is stale. */
  const seqRef = useRef(0)
  const inFlightRef = useRef(false)
  const [error, setError] = useState<ClaudeStartError | null>(null)

  const end = useCallback(() => {
    if (!mover || !openRef.current) return
    openRef.current = false
    const snap = controller.snapshot()
    void mover.end(claudeRecordOf(snap))
    // A live Claude game with no session would only fail its next ask:
    // hold it paused instead, so a later Resume can begin again.
    if (isClaudeGame(snap.config)) controller.pause()
  }, [controller, mover])

  const begin = useCallback(
    async (white: ClaudeModelKey, black: ClaudeModelKey): Promise<boolean> => {
      if (!mover) {
        setError('unavailable')
        return false
      }
      // One begin at a time: the mover holds a single game.
      if (inFlightRef.current) return false
      // A mover's begin does not clear a previous session: end it first.
      end()
      const seq = ++seqRef.current
      inFlightRef.current = true
      setError(null)
      let result: BeginResult
      try {
        result = await mover.begin(white, black)
      } finally {
        inFlightRef.current = false
      }
      if (seq !== seqRef.current) {
        // Overtaken by another start or load: the server game it opened is not wanted.
        if (result.ok) void mover.end({ pgn: '*', fallbacks: { w: 0, b: 0 } })
        return false
      }
      if (!result.ok) {
        setError(result.kind)
        return false
      }
      openRef.current = true
      return true
    },
    [mover, end],
  )

  const replace = useCallback(() => {
    seqRef.current++
    end()
    setError(null)
  }, [end])

  // A finished Claude game is ended at once, so the lock and the unspent
  // reservation go back straight away.
  useEffect(
    () =>
      controller.subscribe((s) => {
        if (s.phase.kind === 'finished' && openRef.current) end()
      }),
    [controller, end],
  )

  useEffect(() => {
    window.addEventListener('pagehide', end)
    return () => window.removeEventListener('pagehide', end)
  }, [end])

  const isOpen = useCallback(() => openRef.current, [])
  const dismissError = useCallback(() => setError(null), [])

  return useMemo(
    () => ({ begin, replace, isOpen, error, dismissError }),
    [begin, replace, isOpen, error, dismissError],
  )
}
