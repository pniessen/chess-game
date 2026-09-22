import { useCallback, useMemo, useRef, useState } from 'react'
import type { Game } from '../game-core/game'
import type { PlayedMove, Square } from '../game-core/types'
import { Board, type Highlights } from './Board/Board'
import { EvalBar } from './Board/EvalBar'
import { Promotion } from './Board/Promotion'
import type { MatchController } from '../match/controller'
import type { EngineSupervisor } from '../engine/supervisor'
import { templatedHint } from '../coach/templated'
import { HINT_BUDGET, hintRequestFrom } from '../coach/hints'
import { useHints, type HintAnalyze, type HintReasoner } from './hints/useHints'
import { useEvaluation } from './useEvaluation'
import { hintKeyOf, reviewKeyOf } from './gameKey'
import { updateHistoryAccuracy } from '../storage/storage'
import { useMatch } from './useMatch'
import { MoveList } from './panels/MoveList'
import { Captured } from './panels/Captured'
import { Clocks } from './panels/Clocks'
import { Controls } from './panels/Controls'
import { Scoreboard } from './panels/Scoreboard'
import { NewGame } from './panels/NewGame'
import { GameIO } from './panels/GameIO'
import { SettingsPanel } from './panels/SettingsPanel'
import { Tabs } from './panels/Tabs'
import { Explorer } from './panels/Explorer'
import { useReview, type Summarize } from './review/useReview'
import { ReviewPanel } from './review/ReviewPanel'
import { currentMoveText, reviewAnnotations, reviewMarks } from './review/reviewView'
import { reviewRequestFrom, templatedSummary } from '../review/summary'
import { humanSideOf, resultTagOf } from '../match/result'
import { HistoryPanel } from './history/HistoryPanel'
import { humanSidesOf } from './history/record'
import { PuzzleScreen } from './puzzles/PuzzleScreen'
import { usePuzzleMode } from './puzzles/usePuzzleMode'
import { blunderPuzzlesFrom } from '../puzzles/blunders'
import { addBlunderPuzzles } from '../puzzles/store'
import { describeResult, resignableSide } from './app/matchText'
import { useControllerBundle } from './app/useControllerBundle'
import { useSettings } from './app/useSettings'
import { useMoveSounds, useSoundPlayer } from './app/useSound'
import { useCoachClient } from './app/useCoachClient'
import { useEngineHealth } from './app/useEngineHealth'
import { useEngineAnalysis } from './app/useEngineAnalysis'
import { useOpenings } from './app/useOpenings'
import { useMatchRecords } from './app/useMatchRecords'
import { useMoveInput } from './app/useMoveInput'
import { useMatchLifecycle } from './app/useMatchLifecycle'
import './app.css'

/** Task 13 adds the 'history' tab. */
type RightTab = 'moves' | 'explorer' | 'review' | 'history'

/**
 * The one MatchController (and its one Stockfish worker) is owned by
 * `useControllerBundle` — built in an effect so React Strict Mode never
 * leaves a second worker alive. Nothing renders until it exists.
 */
export function App() {
  const bundle = useControllerBundle()

  if (!bundle) return null

  return (
    <AppInner
      controller={bundle.controller}
      engine={bundle.engine}
      engineConstructed={bundle.engineAvailable}
    />
  )
}

function AppInner({
  controller,
  engine,
  engineConstructed,
}: {
  controller: MatchController
  engine: EngineSupervisor | null
  /** Whether the engine was built successfully at construction time (a *synchronous* outcome). */
  engineConstructed: boolean
}) {
  const { settings, updateSettings } = useSettings()

  const sound = useSoundPlayer(settings.soundEnabled)
  const { coach, coachState } = useCoachClient()

  const snapshot = useMatch(controller)
  // Phase 3: game <-> puzzles. Entering pauses a live match through the
  // controller (no engine moves, no clocks); leaving resumes it.
  const puzzleMode = usePuzzleMode(controller)

  const [tab, setTab] = useState<RightTab>('moves')

  const { engineHealth, engineAvailable } = useEngineHealth(engine, engineConstructed)

  /**
   * The exact input of the review that is running or done, keyed like
   * historyRef. Phase 3: its blunders become puzzles, and the positions
   * must come from the moves that were REVIEWED, never from whatever the
   * live Game holds by the time the review completes.
   */
  const reviewInputRef = useRef<{ key: string; startFen: string; moves: PlayedMove[] } | null>(null)

  // Stable, so the clock display's polling effect isn't torn down and
  // rebuilt on every App render.
  const readClock = useCallback(() => controller.clockState(), [controller])

  const game: Game = snapshot.game
  const position = game.current()
  const displayedStatus = position.status()
  const lastMove = game.moves[game.ply - 1]

  useMoveSounds(sound, game, snapshot.phase.kind)

  const { evalCache, analyzeForEval } = useEngineAnalysis(controller, engineAvailable)
  const evaluation = useEvaluation({
    analyze: analyzeForEval,
    fen: position.fen(),
    status: displayedStatus,
    enabled: settings.showEval,
    cache: evalCache,
  })

  const { book, bookFailed, opening, finalOpeningName } = useOpenings(controller, game)
  const {
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
  } = useMatchRecords(snapshot, finalOpeningName)
  const input = useMoveInput(controller, snapshot)
  const { selection, canRedo, onSquareClick, handleUndo, handleRedo, handleJump, handleResign } = input
  const lifecycle = useMatchLifecycle({
    controller,
    settings,
    updateSettings,
    engineAvailable,
    records: { pendingResume, setResumeChoice, scoredRef, recordedRef, historyRef },
    resetInput: input.resetInput,
    onShowMoves: () => setTab('moves'),
  })
  const { choices, orientation, handleFlip } = lifecycle
  /** A review belongs to one game AND its exact move list (ruling P5); browsing leaves this unchanged. */
  const reviewKey = reviewKeyOf(game)

  // Through the controller's lane: never races the engine's own move search.
  const analyzeForHint = useCallback<HintAnalyze>(
    (fen, signal) => controller.analyze({ fen, ...HINT_BUDGET }, signal),
    [controller],
  )

  // Press 3 = reasoning: Claude when the coach server can, templated otherwise.
  const reasonForHint = useCallback<HintReasoner>(
    async (s, pos, signal) => {
      const fallback = templatedHint([...s.lines], pos) ?? `${s.san} is the engine's choice.`
      const request = hintRequestFrom(s, pos)
      if (!request) return fallback
      return (await coach.hint(request, signal)) ?? fallback
    },
    [coach],
  )

  const hints = useHints({
    resetKey: hintKeyOf(game, snapshot.phase.kind),
    analyze: analyzeForHint,
    reason: reasonForHint,
  })

  // Hints are always about the LIVE position (the button is disabled while browsing).
  const handleHint = () => hints.advance(game.positionAt(game.livePly))

  // ---- post-game review -----------------------------------------------------

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
    // ref's doc comment above; required fix, Task 13 review round 1, Finding
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

  // Rendered INSTEAD of the game UI, after every hook above, so hook order
  // never changes. The match stays in the controller (paused) meanwhile.
  if (puzzleMode.screen === 'puzzles') {
    return <PuzzleScreen onExit={puzzleMode.exit} themeId={settings.themeId} pieceSetId={settings.pieceSetId} />
  }

  // ---- render -----------------------------------------------------------

  const highlights: Highlights = {
    ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
    legal:
      selection.kind === 'selected'
        ? position.legalMovesFrom(selection.square).map((m) => m.to)
        : [],
    ...(lastMove ? { lastMove: [lastMove.from, lastMove.to] as [Square, Square] } : {}),
    ...(displayedStatus.kind === 'in-progress' && displayedStatus.inCheck
      ? { check: position.kingSquare(position.turn()) ?? undefined }
      : {}),
  }

  return (
    <main className="app">
      <h1>Chess</h1>

      {!engineAvailable ? (
        <p className="engine-warning">
          The chess engine is unavailable — playing in two-player mode only.
        </p>
      ) : null}

      {resumeChoice === 'pending' ? (
        <p className="resume-banner" data-testid="resume-banner">
          Resume your previous game?
          <button data-testid="resume-accept" onClick={lifecycle.handleResumeAccept}>
            Resume
          </button>
          <button data-testid="resume-decline" onClick={lifecycle.handleResumeDecline}>
            Discard
          </button>
        </p>
      ) : null}

      <div className="status-row">
        <p data-testid="turn">{position.turn() === 'w' ? 'White to move' : 'Black to move'}</p>
        <p className="result" data-testid="result">
          {describeResult(snapshot.phase, displayedStatus)}
        </p>
        {engineHealth.kind === 'restarting' ? (
          <p className="engine-status" role="status" data-testid="engine-status">
            Engine restarting…
          </p>
        ) : null}
        <p className="opening" data-testid="opening" title={opening ? `${opening.eco} ${opening.name}` : undefined}>
          {opening ? `${opening.eco} ${opening.name}` : ''}
        </p>
        {coachState.status === 'offline' || coachState.status === 'no-key' ? (
          <span
            className="coach-badge"
            data-testid="coach-badge"
            title={
              coachState.status === 'no-key'
                ? 'The coach server has no ANTHROPIC_API_KEY; using built-in hints.'
                : 'The coach server is not reachable; using built-in hints.'
            }
          >
            coaching offline
          </span>
        ) : null}
      </div>

      {coachState.notice ? (
        <p className="coach-notice" role="status" data-testid="coach-notice">
          {coachState.notice}
          <button data-testid="coach-notice-dismiss" onClick={() => coach.dismissNotice()}>
            Dismiss
          </button>
        </p>
      ) : null}

      <div className="layout">
        <div className="left-column">
          <Clocks clock={snapshot.clock} readClock={readClock} orientation={orientation} />
          <Captured moves={game.moves.slice(0, game.ply)} pieceSet={settings.pieceSetId} />
          <Scoreboard score={score} />
        </div>

        <div className="board-column">
          <div className="board-row">
            {settings.showEval ? <EvalBar evaluation={evaluation} orientation={orientation} /> : null}
            <Board
              position={position}
              orientation={orientation}
              highlights={highlights}
              onSquareClick={onSquareClick}
              annotations={[...hints.annotations, ...reviewAnnotations(reviewed, game.ply)]}
              theme={settings.themeId}
              pieceSet={settings.pieceSetId}
            />
          </div>
          <span className="sr-only" data-testid="ply-count">
            {game.moves.length}
          </span>
          {selection.kind === 'awaiting-promotion' ? (
            <Promotion
              color={position.turn()}
              onChoose={input.choosePromotion}
              onCancel={input.cancelPromotion}
              pieceSet={settings.pieceSetId}
            />
          ) : null}
          <Controls
            phase={snapshot.phase}
            config={snapshot.config}
            canUndo={game.moves.length > 0 && snapshot.phase.kind !== 'idle'}
            canRedo={canRedo}
            canResign={resignableSide(snapshot.config, snapshot.phase) !== null}
            speed={snapshot.config.engineDelayMs ?? 500}
            hint={{
              label: hints.label,
              text: hints.text,
              disabled:
                !engineAvailable ||
                snapshot.phase.kind !== 'awaiting-human' ||
                !game.isViewingLive() ||
                hints.pending ||
                hints.exhausted,
            }}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFlip={handleFlip}
            onResign={handleResign}
            onHint={handleHint}
            onPause={() => controller.pause()}
            onResume={() => controller.resume()}
            onStep={() => controller.step()}
            onSpeedChange={(ms) => controller.setSpeed(ms)}
          />
          <NewGame
            mode={choices.mode}
            level={choices.level}
            timeControlId={choices.timeControlId}
            color={choices.color}
            engineAvailable={engineAvailable}
            onModeChange={choices.setMode}
            onLevelChange={choices.setLevel}
            onTimeControlChange={choices.setTimeControlId}
            onColorChange={choices.setColor}
            onStart={lifecycle.handleNewGame}
            onPuzzles={puzzleMode.enter}
          />
          <GameIO game={game} onImport={lifecycle.handleImport} />
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </div>

        <div className="right-column">
          <Tabs
            active={tab}
            onChange={(id) => setTab(id as RightTab)}
            tabs={[
              {
                id: 'moves',
                label: 'Moves',
                content: (
                  <MoveList
                    moves={game.moves}
                    currentPly={game.ply}
                    onJump={handleJump}
                    disabled={snapshot.phase.kind === 'engine-thinking'}
                    marks={marks}
                  />
                ),
              },
              {
                id: 'explorer',
                label: 'Explorer',
                content: (
                  <Explorer book={book} unavailable={bookFailed} current={opening} onStart={lifecycle.handleStartOpening} />
                ),
              },
              {
                id: 'review',
                label: 'Review',
                content: (
                  <ReviewPanel
                    state={review.state}
                    canReview={engineAvailable && snapshot.phase.kind === 'finished' && game.moves.length > 0}
                    currentText={reviewed ? currentMoveText(reviewed, game.ply) : ''}
                    onStart={handleReview}
                    onCancel={review.cancel}
                  />
                ),
              },
              {
                id: 'history',
                label: 'History',
                content: (
                  <HistoryPanel
                    entries={history}
                    status={historyState}
                    onReplay={lifecycle.handleReplay}
                    onReset={handleHistoryReset}
                  />
                ),
              },
            ]}
          />
        </div>
      </div>
    </main>
  )
}
