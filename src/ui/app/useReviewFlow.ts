import { useCallback, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { PlayedMove } from '../../game-core/types'
import type { MatchSnapshot } from '../../match/types'
import type { CoachClient } from '../../coach/client'
import { updateHistoryAccuracy, type HistoryEntry } from '../../storage/storage'
import type { EvalAnalyze, EvalCache } from '../useEvaluation'
import { useReview, type Summarize } from '../review/useReview'
import { reviewMarks } from '../review/reviewView'
import { reviewRequestFrom, templatedSummary } from '../../review/summary'
import { humanSideOf, resultTagOf } from '../../match/result'
import { humanSidesOf } from '../history/record'
import { reviewKeyOf } from '../gameKey'
import { blunderPuzzlesFrom } from '../../puzzles/blunders'
import { addBlunderPuzzles } from '../../puzzles/store'

/**
 * The post-game review: runs it through the controller's analysis, asks the
 * coach for the summary, and on completion writes the accuracy onto the
 * game's history entry and turns the human side's blunders into puzzles.
 */
export function useReviewFlow({
  snapshot,
  finalOpeningName,
  coach,
  analyze: analyzeForEval,
  evalCache,
  historyRef,
  setHistory,
}: {
  snapshot: MatchSnapshot
  finalOpeningName: string | null
  coach: Pick<CoachClient, 'review'>
  analyze: EvalAnalyze | null
  evalCache: EvalCache
  historyRef: RefObject<{ id: string; key: string } | null>
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>
}) {
  const game = snapshot.game
  /** A review belongs to one game AND its exact move list (ruling P5); browsing leaves this unchanged. */
  const reviewKey = reviewKeyOf(game)

  /**
   * The exact input of the review that is running or done, keyed like
   * historyRef. Phase 3: its blunders become puzzles, and the positions
   * must come from the moves that were REVIEWED, never from whatever the
   * live Game holds by the time the review completes.
   */
  const reviewInputRef = useRef<{ key: string; startFen: string; moves: PlayedMove[] } | null>(null)

  const summarizeReview = useCallback<Summarize>(
    async (review, signal) => {
      const result = resultTagOf(snapshot.phase)
      const fallback = templatedSummary(review, { opening: finalOpeningName, result })
      let text: string | null = null
      try {
        text = await coach.review(
          reviewRequestFrom(review, { result, opening: finalOpeningName, humanSide: humanSideOf(snapshot.config) }),
          signal,
        )
      } catch {
        // CoachClient already falls back silently; this is belt and braces.
      }
      return text ? { text, source: 'claude' } : { text: fallback, source: 'templated' }
    },
    [snapshot.phase, snapshot.config, finalOpeningName, coach],
  )

  // Invalidated (and its engine jobs aborted) whenever reviewKey changes:
  // undo, redo, a new move, load, new game, start-from-opening.
  const review = useReview({
    gameKey: reviewKey,
    analyze: analyzeForEval,
    summarize: summarizeReview,
    onEval: (fen, e) => evalCache.set(fen, e),
    // Write the review's accuracy onto the history entry it belongs to —
    // but only if `historyRef` still points at THIS exact move list (see the
    // ref's doc comment in useMatchRecords.ts; required fix, Task 13 review round 1, Finding
    // 1, tightening the Task 12 "never attach a review to the wrong game"
    // ruling from a `Game` object identity check to a `reviewKeyOf` check).
    // `useReview` already refuses to call this at all once its `gameKey`
    // has changed (see useReview.ts's `activeKeyRef`/cancel), so this is a
    // second, independent check at the write site.
    onComplete: (r) => {
      const rec = historyRef.current
      if (!rec || rec.key !== reviewKey) return
      const games = updateHistoryAccuracy(rec.id, r.accuracy)
      setHistory(games)
      // Phase 3: the human side's blunders become "My mistakes" puzzles —
      // only for a game in history, whose entry says which sides were human
      // (a replay runs as two-player, so snapshot.config cannot tell).
      const input = reviewInputRef.current
      const entry = games.find((e) => e.id === rec.id)
      if (!input || input.key !== rec.key || !entry) return
      addBlunderPuzzles(
        blunderPuzzlesFrom({
          review: r,
          startFen: input.startFen,
          moves: input.moves,
          humanSides: humanSidesOf(entry),
          source: { gameId: entry.id, gameDate: entry.date, opening: entry.opening },
          now: new Date(),
        }),
      )
    },
  })
  const reviewed = review.state.kind === 'done' ? review.state.review : null
  const marks = useMemo(() => (reviewed ? reviewMarks(reviewed) : undefined), [reviewed])

  // Required fix (Task 13 review, round 1, Finding 2): snapshot the moves and
  // the final status TOGETHER, right here, rather than handing `review.start`
  // the live `game.moves` array (the same mutable array `Game.undo()` pops —
  // see run.ts's own copy-before-first-await comment for why that matters).
  // `runReview` copies `opts.moves` again internally before its first
  // `await`, which is harmless — but it only guards moves mutated WHILE the
  // review is running. If `useReview.start` were ever changed to defer
  // calling `runReview` (e.g. behind a microtask), the live array could be
  // mutated in that gap before `runReview` ever sees it; taking the snapshot
  // here, synchronously, at the moment the user asked for a review, is what
  // actually guarantees moves and finalStatus describe the same position.
  const handleReview = () => {
    const moves = [...game.moves]
    const finalStatus = game.status()
    reviewInputRef.current = { key: reviewKey, startFen: game.startFen, moves }
    review.start({ startFen: game.startFen, moves, finalStatus })
  }

  return { review, reviewed, marks, handleReview }
}
