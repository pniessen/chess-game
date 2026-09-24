import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchSnapshot } from '../../match/types'
import { gameIdOf, reviewKeyOf } from '../gameKey'

export interface EndCardState {
  /** Whether the game-end card is showing. */
  open: boolean
  /** Close it (Escape, the Dismiss button, "Review game"). */
  dismiss: () => void
  /**
   * Called by the match lifecycle from `startMatch`/`loadMatch`, exactly
   * where `scoredRef`/`recordedRef`/`historyRef` are reset: the card closes
   * and forgets what it had seen, so the phase the load lands in is the
   * FIRST phase this hook observes for the new game (see below).
   */
  reset: () => void
}

/**
 * Task 6: when to show the game-end card.
 *
 * The card celebrates a game that ended LIVE in front of the user — the same
 * distinction `historyRef`/`loadMatch` already draw for history recording
 * (see useMatchRecords.ts): an imported PGN/FEN, a resumed save that was
 * already over, and a replay from history all arrive ALREADY finished and
 * must not pop a card.
 *
 * Rather than duplicating `recordedRef`'s bookkeeping, this reads the same
 * fact off the phase stream: a live finish is a transition INTO 'finished'
 * on a game this hook has already seen unfinished. Two things make that
 * exact:
 *
 *  - `controller.load()`/`start()` always build a BRAND-NEW `Game` (see
 *    controller.begin), so the game id changes on every load — a load that
 *    lands straight in 'finished' can never look like a transition.
 *  - `reset()` additionally clears the last-seen record, so the first phase
 *    observed after a start/load has nothing to be a transition from. This
 *    is what covers `handleReplay`, which calls `load()` and then
 *    `finishAs()` synchronously: `useMatch` reads the controller through
 *    `useSyncExternalStore`, so those two emits are batched into a single
 *    render and this effect only ever sees the finished end state — with no
 *    previous record to transition from.
 *
 * A match that ARRIVES finished is remembered by game id and never raises a
 * card again, for any finish reached on it afterwards — taking a replayed
 * mate back and re-reaching it, or playing on from it into a different one,
 * are still moves inside a loaded game, which `loadMatch` has already
 * decided the history will not record.
 *
 * `shownRef` keys the card on `reviewKeyOf` (game id + the live move list),
 * so one finish shows one card: dismissing, undoing and redoing back onto
 * the same mate does not pop it again, exactly as that sequence does not
 * record a second history entry. A genuinely different finish (undo, play a
 * different line, get mated again) has a different key and does show.
 */
export function useEndCard(snapshot: MatchSnapshot): EndCardState {
  const { game, phase } = snapshot
  const [open, setOpen] = useState(false)
  const seenRef = useRef<{ id: number; finished: boolean } | null>(null)
  const shownRef = useRef<string | null>(null)
  /**
   * The game id of a match that ARRIVED finished (an import, a replay, a
   * resumed save that was already over). Review fix round 1: without this,
   * "Undo, Redo" on a replayed game read as a live transition and raised a
   * card for a game that was loaded, not played — and, since `loadMatch`
   * leaves `recordedRef` true for the whole of that load, one the history
   * will never record. A finish on such a game is never live, however many
   * times it is taken back and re-reached, or whatever line is played on
   * from it.
   */
  const loadedFinishedRef = useRef<number | null>(null)

  useEffect(() => {
    const id = gameIdOf(game)
    const finished = phase.kind === 'finished'
    const seen = seenRef.current
    seenRef.current = { id, finished }
    // The card only ever stands over a finished game: an undo (or a pause,
    // or anything else that leaves 'finished') takes it away.
    if (!finished) {
      setOpen(false)
      return
    }
    if (!seen || seen.id !== id) {
      // The FIRST phase observed for this match is already 'finished', so
      // the match was loaded that way. `shownRef` is seeded as well as the
      // id being remembered, so that even a single guard left standing
      // covers the Undo/Redo round trip back onto this very finish.
      loadedFinishedRef.current = id
      shownRef.current = reviewKeyOf(game)
      return
    }
    if (seen.finished || loadedFinishedRef.current === id) return
    const key = reviewKeyOf(game)
    if (shownRef.current === key) return
    shownRef.current = key
    setOpen(true)
  }, [game, phase])

  const dismiss = useCallback(() => setOpen(false), [])
  const reset = useCallback(() => {
    seenRef.current = null
    shownRef.current = null
    loadedFinishedRef.current = null
    setOpen(false)
  }, [])

  return { open, dismiss, reset }
}
