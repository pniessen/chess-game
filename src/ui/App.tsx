import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game } from '../game-core/game'
import { Board } from './Board/Board'
import { EvalBar } from './Board/EvalBar'
import { Promotion } from './Board/Promotion'
import type { MatchController } from '../match/controller'
import type { EngineSupervisor } from '../engine/supervisor'
import type { ClaudeMover } from '../claude/gameClient'
import { useEvaluation } from './useEvaluation'
import { useMatch } from './useMatch'
import { Captured } from './panels/Captured'
import { Clocks } from './panels/Clocks'
import { Controls } from './panels/Controls'
import { Scoreboard } from './panels/Scoreboard'
import { NewGameControl } from './panels/NewGameControl'
import { GameFilePopover } from './panels/GameFilePopover'
import { SettingsPopover } from './panels/SettingsPopover'
import { currentMoveText, reviewAnnotations } from './review/reviewView'
import { PuzzleScreen } from './puzzles/PuzzleScreen'
import { usePuzzleMode } from './puzzles/usePuzzleMode'
import { describeResult, resignableSide } from './app/matchText'
import { highlightsFor } from './app/highlights'
import { StatusHeader } from './app/StatusHeader'
import { GameEndCard } from './app/GameEndCard'
import { RightTabs, type RightTab } from './app/RightTabs'
import { useControllerBundle } from './app/useControllerBundle'
import { useSettings } from './app/useSettings'
import { useAppearance } from './app/useAppearance'
import { useMoveSounds, useSoundPlayer } from './app/useSound'
import { useCoachClient } from './app/useCoachClient'
import { useClaudeBudget } from './app/useClaudeBudget'
import { useClaudeSession } from './app/useClaudeSession'
import { claudeErrorText } from './app/claudeText'
import { ClaudeStatus, ClaudeWhy } from './app/ClaudePanel'
import { claudeComments, claudeHeaders } from './app/claudeRecord'
import { shortModelLabel } from '../claude/models'
import { CLAUDE_GAMES } from '../claude/enabled'
import type { Seat } from '../match/types'
import { useEngineHealth } from './app/useEngineHealth'
import { useEngineLoading } from './app/useEngineLoading'
import { useEngineAnalysis } from './app/useEngineAnalysis'
import { useOpenings } from './app/useOpenings'
import { useMatchRecords } from './app/useMatchRecords'
import { useMoveInput } from './app/useMoveInput'
import { useMatchLifecycle } from './app/useMatchLifecycle'
import { useCoachHints } from './app/useCoachHints'
import { useReviewFlow } from './app/useReviewFlow'
import { useEndCard } from './app/useEndCard'
import { useShortcuts } from './app/useShortcuts'
import { ShortcutsOverlay } from './app/ShortcutsOverlay'
import { useShareLink } from './app/useShareLink'
import { useOverflowFade } from './app/useOverflowFade'
import { downloadPgn } from './pgnFile'
import './app.css'

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
      claudeMover={bundle.claude}
    />
  )
}

/**
 * Composition only: each concern lives in a hook under ./app/. The call
 * order below is the effect order, and every hook runs before the puzzle
 * screen's early return, so hook order never changes between renders.
 */
function AppInner({
  controller,
  engine,
  engineConstructed,
  claudeMover = null,
}: {
  controller: MatchController
  engine: EngineSupervisor | null
  /** Claude vs Claude's server client; the lifecycle begins and ends its games. */
  claudeMover?: ClaudeMover | null
  /** Whether the engine was built successfully at construction time (a *synchronous* outcome). */
  engineConstructed: boolean
}) {
  const { settings, updateSettings } = useSettings()

  useAppearance(settings.appearance)

  const sound = useSoundPlayer(settings.soundEnabled, settings.volume)
  const { coach, coachState } = useCoachClient()
  // Claude vs Claude runs only against the local server, so only a build
  // with the flag (dev, or VITE_CLAUDE_GAMES=on) offers it: see
  // claude/enabled.ts. CLAUDE_GAMES is a build-time constant, so every
  // `CLAUDE_GAMES && …` below is dropped from a public build's bundle.

  const snapshot = useMatch(controller)
  // Phase 3: game <-> puzzles. Entering pauses a live match through the
  // controller (no engine moves, no clocks); leaving resumes it.
  const puzzleMode = usePuzzleMode(controller)

  const [tab, setTab] = useState<RightTab>('moves')
  // Reported up by SettingsPopover's onOpenChange, purely so the keyboard
  // shortcuts hook knows it owns the keyboard — App never reads inside it.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Task 4: the same, for the Game file popover. Note that App does NOT
  // arbitrate which of the two is open: each popover already dismisses
  // itself on a pointerdown outside it, and the OTHER popover's trigger is
  // outside it, so pressing one closes the other before its own click
  // lands, ON POINTER ACTIVATION. Fix round 2 precision: that is not a
  // structural guarantee against every way a trigger can activate — it
  // only fires from a pointerdown outside the open popover, which
  // Enter/Space on a focused trigger is not. Not reachable today (no
  // `.focus()` call site in src/ui/ targets a trigger while a popover is
  // open, and Tab is trapped inside whichever one is open) — this is
  // precision about the mechanism, not a known defect. Lifting the open
  // state here to enforce it unconditionally would have meant making
  // SettingsPopover controlled — a change to a component this task is
  // meant to leave alone — to close a gap nothing can reach.
  const [gameFileOpen, setGameFileOpen] = useState(false)
  // Task 6 (mobile pass): the same, for New game's mobile-only popover
  // (NewGameControl). Never set true on desktop — nothing there is ever
  // "open" in this sense — but declared unconditionally, same as the two
  // above, so `overlayOpen` below never has to know which width it's at.
  const [newGameOpen, setNewGameOpen] = useState(false)

  // Task 6 (mobile pass, item B): the bottom-fade scroll affordance on
  // `.left-column` — see useOverflowFade's own doc comment for why it
  // needs the column's DOM node directly rather than derived state.
  const leftColumnRef = useRef<HTMLDivElement>(null)
  useOverflowFade(leftColumnRef)

  const { engineHealth, engineAvailable } = useEngineHealth(engine, engineConstructed)
  // "Loading" (the very first handshake) and "restarting" (a later one,
  // after a crash) never overlap — see useEngineLoading — so this is a
  // simple, mutually-exclusive union for the status area and the Hint
  // button to key off of.
  const engineLoading = useEngineLoading(engine)
  // Once the restart budget is spent, the existing "engine unavailable"
  // banner already owns this message — loading/restarting must not show
  // alongside (or instead of) it, however the settle of the loading
  // promise above happens to be timed relative to the health update that
  // declared the engine dead.
  const engineStatus: 'ok' | 'loading' | 'restarting' = !engineAvailable
    ? 'ok'
    : engineLoading
      ? 'loading'
      : engineHealth.kind === 'restarting'
        ? 'restarting'
        : 'ok'
  const engineWarmingUp = engineStatus !== 'ok'

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
  const records = useMatchRecords(snapshot, finalOpeningName)
  // Task 14: a shared-position link, read off the URL once at startup.
  const share = useShareLink()
  const input = useMoveInput(controller, snapshot)
  const { selection } = input
  // Task 6: the game-end card. It opens only on a finish observed live (see
  // useEndCard) and is closed again by every start/load, through the
  // lifecycle's `onMatchReset` below.
  const endCard = useEndCard(snapshot)
  const claudeSession = useClaudeSession(controller, claudeMover)
  const lifecycle = useMatchLifecycle({
    controller,
    settings,
    updateSettings,
    engineAvailable,
    records,
    resetInput: input.resetInput,
    onMatchReset: endCard.reset,
    onShowMoves: () => setTab('moves'),
    claude: claudeSession,
  })
  const { choices, orientation } = lifecycle
  const claudeBudget = useClaudeBudget(CLAUDE_GAMES && choices.mode === 'claude-vs-claude')

  // Task 14: a valid share link takes precedence over the normal start —
  // but ONLY when there is nothing to conflict with. When a saved
  // in-progress game is also waiting, loading the share link automatically
  // would silently bury it (the ordinary resume banner would never appear
  // this session), so that case is offered as a choice instead, reusing the
  // exact same resume-banner pattern/markup (see StatusHeader) rather than
  // a second one. See handleShareAccept below for why accepting does NOT
  // resolve the resume choice; declining just leaves the ordinary resume
  // banner to run exactly as it always has.
  const shareOk = share.pending.kind === 'ok'
  const shareConflict = shareOk && !share.resolved && records.pendingResume !== null
  const shareAutoLoad = shareOk && !share.resolved && records.pendingResume === null

  useEffect(() => {
    if (!shareAutoLoad || share.pending.kind !== 'ok') return
    lifecycle.handleImport(share.pending.position.game)
    share.resolve()
    // Runs once, exactly when there is a share link and nothing to ask
    // about: `shareAutoLoad` itself flips to false the moment `resolve()`
    // commits, so this never re-fires on the stale `lifecycle`/`share`
    // closures a full dependency list would otherwise force a re-run for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareAutoLoad])

  const handleShareAccept = () => {
    if (share.pending.kind !== 'ok') return
    lifecycle.handleImport(share.pending.position.game)
    share.resolve()
    // Deliberately leaves `resumeChoice` exactly as it was: it is what
    // gates useMatchRecords' autosave (see saveInProgress there), and
    // resolving it here would let the newly-loaded shared game overwrite
    // the still-undecided saved one the moment it starts autosaving. Left
    // 'pending', the ordinary resume banner reappears once `shareConflict`
    // above goes false (it no longer has this offer to yield to) — now
    // offering to ALSO resume the saved game on top of the shared position,
    // which is exactly the fallback this hook exists to preserve.
  }
  const handleShareDecline = () => share.resolve()
  const shareError = share.pending.kind === 'error' && !share.resolved ? share.pending.message : null
  const handleDismissShareError = () => share.resolve()

  const { hints, handleHint } = useCoachHints({ controller, coach, game, phaseKind: snapshot.phase.kind })
  const { review, reviewed, marks, handleReview } = useReviewFlow({
    snapshot,
    finalOpeningName,
    coach,
    analyze: analyzeForEval,
    evalCache,
    historyRef: records.historyRef,
    setHistory: records.setHistory,
  })

  // The result banner text and whether this game can be reviewed: read by
  // the status header, the Review tab and the game-end card, so they are
  // computed once and cannot drift apart.
  const result = describeResult(snapshot.phase, displayedStatus)
  const canReview = engineAvailable && snapshot.phase.kind === 'finished' && game.moves.length > 0

  // Read by the Hint button AND the 'h' shortcut, so they can never disagree
  // about whether a hint is available right now.
  const hintDisabled =
    !engineAvailable ||
    snapshot.phase.kind !== 'awaiting-human' ||
    !game.isViewingLive() ||
    hints.pending ||
    hints.exhausted ||
    engineWarmingUp

  // The puzzle button and the 'p' shortcut are the same action: leaving a
  // game-end card open behind the puzzle screen would remount it — and
  // re-steal focus — on the way back.
  const openPuzzles = () => {
    endCard.dismiss()
    puzzleMode.enter()
  }

  // Task 13: the app-wide keyboard shortcuts. `overlayOpen` is the settings
  // or Game file popover (each reports its own open state up via
  // onOpenChange) — a true modal for this hook's purposes. `isTypingTarget`
  // would already spare the Game file textarea, but a popover that owns the
  // keyboard has to report itself, or the letter shortcuts stay live under
  // it. The game-end card is passed
  // separately as `cardOpen`: it is non-modal by design (see GameEndCard's
  // doc comment), so useShortcuts lets the navigation keys through while it
  // is open and blocks only the rest. The promotion picker and this hook's
  // own shortcuts overlay are passed separately too (see useShortcuts).
  const shortcuts = useShortcuts({
    active: puzzleMode.screen === 'game',
    overlayOpen: settingsOpen || gameFileOpen || newGameOpen,
    cardOpen: endCard.open,
    promotionOpen: selection.kind === 'awaiting-promotion',
    hintDisabled,
    currentPly: game.ply,
    totalPlies: game.moves.length,
    onJump: input.handleJump,
    onFlip: lifecycle.handleFlip,
    onUndo: input.handleUndo,
    onRedo: input.handleRedo,
    onHint: handleHint,
    onOpenPuzzles: openPuzzles,
    onCancelPromotion: input.cancelPromotion,
  })

  // Rendered INSTEAD of the game UI, after every hook above, so hook order
  // never changes. The match stays in the controller (paused) meanwhile.
  if (puzzleMode.screen === 'puzzles') {
    return <PuzzleScreen onExit={puzzleMode.exit} themeId={settings.themeId} pieceSetId={settings.pieceSetId} />
  }

  // ---- render -----------------------------------------------------------

  const highlights = highlightsFor({ selection, position, lastMove, displayedStatus })

  // A game with a Claude seat shows who is thinking, what it has cost, each
  // move's reason and the model names; every other game renders as before.
  const claudeGame =
    CLAUDE_GAMES && (snapshot.config.white.kind === 'claude' || snapshot.config.black.kind === 'claude')
  const seatName = (seat: Seat, fallback: string) => (seat.kind === 'claude' ? shortModelLabel(seat.model) : fallback)
  const clockNames = claudeGame
    ? { w: seatName(snapshot.config.white, 'White'), b: seatName(snapshot.config.black, 'Black') }
    : undefined
  const exportGame = () =>
    claudeGame ? downloadPgn(game, claudeHeaders(snapshot), claudeComments(snapshot)) : downloadPgn(game)

  return (
    <main className="app">
      <h1>Chess</h1>

      <StatusHeader
        engineAvailable={engineAvailable}
        // Suppressed while the share-conflict banner below is unresolved,
        // so the two never show at once — declining the share offer is
        // what lets this one appear, exactly as it always has.
        resumePending={records.resumeChoice === 'pending' && !shareConflict}
        onResumeAccept={lifecycle.handleResumeAccept}
        onResumeDecline={lifecycle.handleResumeDecline}
        shareConflict={shareConflict}
        onShareAccept={handleShareAccept}
        onShareDecline={handleShareDecline}
        shareError={shareError}
        onDismissShareError={handleDismissShareError}
        turn={position.turn()}
        result={result}
        engineStatus={engineStatus}
        opening={opening}
        coachState={coachState}
        onDismissNotice={() => coach.dismissNotice()}
        actions={
          <>
            <GameFilePopover
              game={game}
              onImport={lifecycle.handleImport}
              onOpenChange={setGameFileOpen}
            />
            <button
              type="button"
              className="shortcuts-trigger"
              data-testid="shortcuts-toggle"
              aria-haspopup="dialog"
              aria-expanded={shortcuts.helpOpen}
              onClick={() => (shortcuts.helpOpen ? shortcuts.closeHelp() : shortcuts.openHelp())}
            >
              <span className="shortcuts-icon" aria-hidden="true">
                ?
              </span>
              Shortcuts
            </button>
            <SettingsPopover
              settings={settings}
              onChange={updateSettings}
              onPreviewVolume={() => sound.play('move')}
              onOpenChange={setSettingsOpen}
            />
          </>
        }
      />

      {CLAUDE_GAMES && claudeSession.error ? (
        <p className="share-error-banner" role="alert" data-testid="claude-error">
          {claudeErrorText(claudeSession.error)}
          <button data-testid="claude-error-dismiss" onClick={claudeSession.dismissError}>
            Dismiss
          </button>
        </p>
      ) : null}

      {shortcuts.helpOpen ? <ShortcutsOverlay onClose={shortcuts.closeHelp} /> : null}

      <div className={claudeGame ? 'layout claude-game' : 'layout'}>
        <div className="left-column" ref={leftColumnRef}>
          <Clocks clock={snapshot.clock} readClock={readClock} orientation={orientation} names={clockNames} />
          {claudeGame ? (
            <ClaudeStatus phase={snapshot.phase} config={snapshot.config} spentUsd={snapshot.claude.spentUsd} />
          ) : null}
          <Captured moves={game.moves.slice(0, game.ply)} pieceSet={settings.pieceSetId} />
          <Scoreboard score={records.score} />
          {/* Task 2: moved out of .board-column, below the fold behind a
              610px board, into the left column where it fits above it. */}
          <Controls
            phase={snapshot.phase}
            config={snapshot.config}
            canUndo={game.moves.length > 0 && snapshot.phase.kind !== 'idle'}
            canRedo={input.canRedo}
            canResign={resignableSide(snapshot.config, snapshot.phase) !== null}
            speed={snapshot.config.engineDelayMs ?? 500}
            hint={{
              label: hints.label,
              text: hints.text,
              disabled: hintDisabled,
              loading: engineWarmingUp,
            }}
            onUndo={input.handleUndo}
            onRedo={input.handleRedo}
            onFlip={lifecycle.handleFlip}
            onResign={input.handleResign}
            onHint={handleHint}
            onPause={() => controller.pause()}
            // A paused Claude game with no server session (after a reload)
            // begins one first; both run at once for any other game.
            onResume={() =>
              lifecycle.withClaudeSession(() => {
                // Both snap the display back to the live ply, which can be
                // exactly one move on from the browsed position: a jump, not
                // a move, so the board cuts to it.
                input.cut()
                controller.resume()
              })
            }
            onStep={() =>
              lifecycle.withClaudeSession(() => {
                input.cut()
                controller.step()
              })
            }
            onSpeedChange={(ms) => controller.setSpeed(ms)}
          />
        </div>

        <div className="board-column">
          <div className="board-row">
            {settings.showEval ? <EvalBar evaluation={evaluation} orientation={orientation} /> : null}
            <Board
              position={position}
              orientation={orientation}
              highlights={highlights}
              onSquareClick={input.onSquareClick}
              annotations={[...hints.annotations, ...reviewAnnotations(reviewed, game.ply)]}
              theme={settings.themeId}
              pieceSet={settings.pieceSetId}
              lastPlayed={lastMove ?? null}
              cutKey={input.cutKey}
            />
            {endCard.open ? (
              <GameEndCard
                headline={result}
                opening={finalOpeningName}
                canReview={canReview}
                onRematch={lifecycle.handleRematch}
                onReview={() => {
                  setTab('review')
                  endCard.dismiss()
                  handleReview()
                }}
                onExport={exportGame}
                onDismiss={endCard.dismiss}
              />
            ) : null}
          </div>
          {claudeGame ? <ClaudeWhy notes={snapshot.claude.notes} ply={game.ply} /> : null}
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
        </div>

        <div className="right-column">
          {/* Task 3: moved out of .board-column, below a 610px board, into
              the right column where it fits above the tabs. Level and time
              control stay here too — see SettingsPopover's doc comment for
              why they belong next to the button that starts the next game,
              not in a settings popover. Task 6: below 1020px this collapses
              into a popover (NewGameControl); inline here otherwise. */}
          <NewGameControl
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
            onPuzzles={openPuzzles}
            onOpenChange={setNewGameOpen}
            claude={
              CLAUDE_GAMES
                ? {
                    white: choices.claudeWhite,
                    black: choices.claudeBlack,
                    onWhiteChange: choices.setClaudeWhite,
                    onBlackChange: choices.setClaudeBlack,
                    budgetLeftUsd: claudeBudget,
                  }
                : undefined
            }
          />
          <RightTabs
            active={tab}
            onChange={setTab}
            moves={{
              moves: game.moves,
              currentPly: game.ply,
              onJump: input.handleJump,
              disabled: snapshot.phase.kind === 'engine-thinking',
              marks,
              orientation,
              theme: settings.themeId,
              pieceSet: settings.pieceSetId,
              ...(claudeGame ? { claudeNotes: snapshot.claude.notes } : {}),
            }}
            explorer={{ book, unavailable: bookFailed, current: opening, onStart: lifecycle.handleStartOpening }}
            review={{
              state: review.state,
              canReview,
              currentText: reviewed ? currentMoveText(reviewed, game.ply) : '',
              onStart: handleReview,
              onCancel: review.cancel,
            }}
            history={{
              entries: records.history,
              status: records.historyState,
              onReplay: lifecycle.handleReplay,
              onReset: records.handleHistoryReset,
            }}
          />
        </div>
      </div>
    </main>
  )
}
