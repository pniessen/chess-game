import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Color } from '../../game-core/types'
import { exportPgn } from '../../game-core/io'
import type { MatchSnapshot } from '../../match/types'
import {
  addHistoryEntry,
  clearInProgress,
  historyStatus,
  loadHistory,
  loadInProgress,
  loadScore,
  resetHistory,
  saveInProgress,
  saveScore,
  type HistoryEntry,
  type HistoryStatus,
  type InProgressGame,
  type MatchScore,
} from '../../storage/storage'
import { setupOf } from '../resume'
import { reviewKeyOf } from '../gameKey'
import { historyEntryFor, newHistoryId } from '../history/record'

export interface MatchRecords {
  /** The saved in-progress game found at startup, if any. */
  pendingResume: InProgressGame | null
  /** 'pending' while the resume banner is unanswered; nothing is saved until 'resolved'. */
  resumeChoice: 'pending' | 'resolved'
  setResumeChoice: Dispatch<SetStateAction<'pending' | 'resolved'>>
  score: MatchScore
  history: HistoryEntry[]
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>
  historyState: HistoryStatus
  handleHistoryReset: () => void
  /** True once the current match's result has been counted on the scoreboard. */
  scoredRef: RefObject<boolean>
  /** True once the current match's finish has been written to history. */
  recordedRef: RefObject<boolean>
  historyRef: RefObject<{ id: string; key: string } | null>
}

/**
 * Everything the match leaves behind in storage: the in-progress save (and
 * the resume offer it produces at startup), the scoreboard, and the game
 * history. The refs are reset by the match lifecycle (useMatchLifecycle)
 * whenever a match starts or is loaded.
 */
export function useMatchRecords(snapshot: MatchSnapshot, finalOpeningName: string | null): MatchRecords {
  const game = snapshot.game
  const [pendingResume] = useState(() => loadInProgress())
  const [score, setScore] = useState<MatchScore>(loadScore)
  const [resumeChoice, setResumeChoice] = useState<'pending' | 'resolved'>(
    pendingResume ? 'pending' : 'resolved',
  )

  const scoredRef = useRef(false)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  /** Whether `chess-game:history` is currently readable; drives the History tab's notice. */
  const [historyState, setHistoryState] = useState<HistoryStatus>(() => historyStatus())
  const handleHistoryReset = useCallback(() => {
    resetHistory()
    setHistory(loadHistory())
    setHistoryState(historyStatus())
  }, [])
  /** True once the current match's finish has been written to history. */
  const recordedRef = useRef(false)
  /**
   * The history entry the current match corresponds to, paired with the
   * `reviewKeyOf` of the exact move list it was recorded/reattached for.
   *
   * Required fix (Task 13 review, round 1, Finding 1): pairing the id with
   * the `Game` OBJECT (identity) is not enough, because `MatchController`
   * mutates ONE `Game` in place across undo/redo/new moves (see
   * controller.ts) — the object reference stays the same across an entirely
   * different line of play. Concretely: finish game A (recorded) -> undo ->
   * play a different line -> finish game B live, but `recordedRef` was
   * (wrongly) already true so B is never recorded -> review B. With a
   * `rec.game === game` check, that review's accuracy would land on A's
   * entry even though A's PGN is a different game, because `game` is still
   * the same object. Keying on `reviewKeyOf` (gameId + the move list, the
   * same identity `useReview`'s own `gameKey` uses) instead of raw object
   * identity distinguishes A's moves from B's even on the same `Game`
   * instance. `useReview` already refuses to invoke `onComplete` at all once
   * its `gameKey` has changed (see useReview.ts's `activeKeyRef`/cancel), so
   * this is a second, independent check at the write site.
   */
  const historyRef = useRef<{ id: string; key: string } | null>(null)
  useEffect(() => {
    if (resumeChoice !== 'resolved') return
    if (snapshot.phase.kind === 'idle') return
    // A finished game is never "in progress". Without this, Undo -> Redo
    // back onto a checkmate re-saved the finished PGN (the scoring effect's
    // clearInProgress() is skipped once the game is scored), and resuming it
    // on reload scored the same game a second time.
    if (snapshot.phase.kind === 'finished' || game.moves.length === 0) {
      clearInProgress()
      return
    }
    // The seats and time control go with the PGN, so a resume restores the
    // ORIGINAL mode; `scored` stops a game that was finished, scored, then
    // taken back and continued from being counted again after a reload, and
    // `recorded` does the same for its history entry.
    saveInProgress({
      pgn: exportPgn(game),
      setup: setupOf(snapshot.config),
      scored: scoredRef.current,
      recorded: recordedRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, game.moves.length, snapshot.phase.kind, resumeChoice])

  useEffect(() => {
    if (snapshot.phase.kind !== 'finished') return
    if (scoredRef.current) return
    // Guards against double-counting: set before anything else runs, so a
    // re-render with the same finished `phase`, or a redo that lands back
    // on this same finished position (neither of which calls startMatch,
    // the only place this ref is reset), can't score the game twice.
    scoredRef.current = true

    // Scoreboard semantics, derived from `phase.winner` (never `status.kind`
    // — see describeResult in matchText.ts) and the seat kinds, are mode-dependent:
    //  - one-player (exactly one human seat): win/loss/draw is from that
    //    human's point of view — a win for the engine is a loss for them.
    //  - two-player (both seats human, e.g. hotseat): there's no single
    //    human perspective to score from, so per this feature's ruling any
    //    decisive result (someone won) counts as a "win" and a draw counts
    //    as a "draw" — the scoreboard becomes a games-played/draws tally.
    //  - zero-player (both seats engine): no human played, so the game is
    //    not scored at all — counting it would make the scoreboard
    //    meaningless.
    const whiteHuman = snapshot.config.white.kind === 'human'
    const blackHuman = snapshot.config.black.kind === 'human'
    if (!whiteHuman && !blackHuman) return
    const next = { ...score }
    if (whiteHuman && blackHuman) {
      if (snapshot.phase.winner === null) next.draws++
      else next.wins++
    } else {
      const humanSide: Color = whiteHuman ? 'w' : 'b'
      if (snapshot.phase.winner === null) next.draws++
      else if (snapshot.phase.winner === humanSide) next.wins++
      else next.losses++
    }
    setScore(next)
    saveScore(next)
    // Scoring/history recording above are about the CURRENT match, whatever
    // it is, and must not wait on an unrelated, still-unanswered resume
    // offer — but clearInProgress() targets the SAME storage key that
    // offer reads (`chess-game:in-progress`), so while it is unresolved,
    // that key still belongs to it. Gated the same way the sibling
    // autosave effect above already gates `saveInProgress` on the same
    // key. Required fix (review round 1, Task 14, Important finding): this
    // call used to run unconditionally, silently overwriting an untouched
    // offer the moment ANY match finished — a shared link accepted
    // alongside one, or simply a "New game" started while ignoring the
    // banner — even though the banner promises the saved game "is kept
    // either way". The loss only showed up on reload, since the banner's
    // own `pendingResume` was already captured at mount.
    if (resumeChoice === 'resolved') clearInProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase, resumeChoice])

  // A game is recorded once, the moment its finish is OBSERVED LIVE — never
  // for an already-finished game that was imported, resumed or replayed
  // (loadMatch sets recordedRef accordingly), and never twice for the same
  // finish (recordedRef, like scoredRef above, guards a re-render or a
  // redo landing back on the same finished `phase`).
  useEffect(() => {
    if (snapshot.phase.kind !== 'finished' || recordedRef.current) return
    recordedRef.current = true
    const entry = historyEntryFor({
      phase: snapshot.phase,
      game,
      config: snapshot.config,
      opening: finalOpeningName,
      now: new Date(),
      id: newHistoryId(),
    })
    if (!entry) return
    setHistory(addHistoryEntry(entry))
    historyRef.current = { id: entry.id, key: reviewKeyOf(game) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase])

  return {
    pendingResume,
    resumeChoice,
    setResumeChoice,
    score,
    history,
    setHistory,
    historyState,
    handleHistoryReset,
    scoredRef,
    recordedRef,
    historyRef,
  }
}
