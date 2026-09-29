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
  /**
   * Whether a server game is open for the match on the board — false once
   * the mover says the session has gone CLAUDE_SESSION_IDLE_MS without
   * server contact (the server lock lapses at 30 minutes), so Resume/Step
   * end it and begin again rather than send a move the server refuses.
   */
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
  /**
   * The last end() still on its way, if any. The server holds its one-game
   * lock until /api/game/end lands, so a begin() sent before then answers
   * busy: begin waits for this first.
   */
  const endingRef = useRef<Promise<void> | null>(null)

  /** Send an end and remember it until it settles (a mover's end never throws). */
  const sendEnd = useCallback(
    (record: Parameters<ClaudeMover['end']>[0]): Promise<void> => {
      if (!mover) return Promise.resolve()
      const p: Promise<void> = mover.end(record).then(
        () => {
          if (endingRef.current === p) endingRef.current = null
        },
        () => {
          if (endingRef.current === p) endingRef.current = null
        },
      )
      endingRef.current = p
      return p
    },
    [mover],
  )
  const [error, setError] = useState<ClaudeStartError | null>(null)

  const end = useCallback((): Promise<void> => {
    if (!mover || !openRef.current) return Promise.resolve()
    openRef.current = false
    const snap = controller.snapshot()
    const sent = sendEnd(claudeRecordOf(snap))
    // A live Claude game with no session would only fail its next ask:
    // hold it paused instead, so a later Resume can begin again.
    if (isClaudeGame(snap.config)) controller.pause()
    return sent
  }, [controller, mover, sendEnd])

  const begin = useCallback(
    async (white: ClaudeModelKey, black: ClaudeModelKey): Promise<boolean> => {
      if (!mover) {
        setError('unavailable')
        return false
      }
      // One begin at a time: the mover holds a single game.
      if (inFlightRef.current) return false
      // A mover's begin does not clear a previous session: end it first —
      // and let that end (or any other still on its way) reach the server
      // before beginning, or the old game's lock answers busy.
      end()
      const seq = ++seqRef.current
      inFlightRef.current = true
      setError(null)
      let result: BeginResult
      try {
        while (endingRef.current) await endingRef.current
        if (seq !== seqRef.current) return false // replaced while waiting: begin nothing
        result = await mover.begin(white, black)
      } finally {
        inFlightRef.current = false
      }
      if (seq !== seqRef.current) {
        // Overtaken by another start or load: the server game it opened is not wanted.
        if (result.ok) void sendEnd({ pgn: '*', fallbacks: { w: 0, b: 0 } })
        return false
      }
      if (!result.ok) {
        setError(result.kind)
        return false
      }
      openRef.current = true
      // A new server game's spend starts at zero; a re-begin (Resume after
      // the old session lapsed) must not keep showing the old total.
      controller.resetClaudeSpend()
      return true
    },
    [controller, mover, end, sendEnd],
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
    const onPageHide = () => void end()
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [end])

  const isOpen = useCallback(() => openRef.current && (mover?.sessionFresh?.() ?? true), [mover])
  const dismissError = useCallback(() => setError(null), [])

  return useMemo(
    () => ({ begin, replace, isOpen, error, dismissError }),
    [begin, replace, isOpen, error, dismissError],
  )
}
