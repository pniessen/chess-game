import { useCallback, useState } from 'react'
import type { Game } from '../game-core/game'
import { Board } from './Board/Board'
import { EvalBar } from './Board/EvalBar'
import { Promotion } from './Board/Promotion'
import type { MatchController } from '../match/controller'
import type { EngineSupervisor } from '../engine/supervisor'
import { useEvaluation } from './useEvaluation'
import { useMatch } from './useMatch'
import { Captured } from './panels/Captured'
import { Clocks } from './panels/Clocks'
import { Controls } from './panels/Controls'
import { Scoreboard } from './panels/Scoreboard'
import { NewGame } from './panels/NewGame'
import { GameIO } from './panels/GameIO'
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
}: {
  controller: MatchController
  engine: EngineSupervisor | null
  /** Whether the engine was built successfully at construction time (a *synchronous* outcome). */
  engineConstructed: boolean
}) {
  const { settings, updateSettings } = useSettings()

  useAppearance(settings.appearance)

  const sound = useSoundPlayer(settings.soundEnabled, settings.volume)
  const { coach, coachState } = useCoachClient()

  const snapshot = useMatch(controller)
  // Phase 3: game <-> puzzles. Entering pauses a live match through the
  // controller (no engine moves, no clocks); leaving resumes it.
  const puzzleMode = usePuzzleMode(controller)

  const [tab, setTab] = useState<RightTab>('moves')
  // Reported up by SettingsPopover's onOpenChange, purely so the keyboard
  // shortcuts hook knows it owns the keyboard — App never reads inside it.
  const [settingsOpen, setSettingsOpen] = useState(false)

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
  const input = useMoveInput(controller, snapshot)
  const { selection } = input
  // Task 6: the game-end card. It opens only on a finish observed live (see
  // useEndCard) and is closed again by every start/load, through the
  // lifecycle's `onMatchReset` below.
  const endCard = useEndCard(snapshot)
  const lifecycle = useMatchLifecycle({
    controller,
    settings,
    updateSettings,
    engineAvailable,
    records,
    resetInput: input.resetInput,
    onMatchReset: endCard.reset,
    onShowMoves: () => setTab('moves'),
  })
  const { choices, orientation } = lifecycle

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

  // Task 13: the app-wide keyboard shortcuts. `overlayOpen` covers every
  // overlay that isn't already gated some other way here: the settings
  // popover (whose own open state this reports up via onOpenChange) and the
  // game-end card. The promotion picker and this hook's own shortcuts
  // overlay are passed separately (see useShortcuts).
  const shortcuts = useShortcuts({
    active: puzzleMode.screen === 'game',
    overlayOpen: settingsOpen || endCard.open,
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

  return (
    <main className="app">
      <h1>Chess</h1>

      <StatusHeader
        engineAvailable={engineAvailable}
        resumePending={records.resumeChoice === 'pending'}
        onResumeAccept={lifecycle.handleResumeAccept}
        onResumeDecline={lifecycle.handleResumeDecline}
        turn={position.turn()}
        result={result}
        engineStatus={engineStatus}
        opening={opening}
        coachState={coachState}
        onDismissNotice={() => coach.dismissNotice()}
        actions={
          <>
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

      {shortcuts.helpOpen ? <ShortcutsOverlay onClose={shortcuts.closeHelp} /> : null}

      <div className="layout">
        <div className="left-column">
          <Clocks clock={snapshot.clock} readClock={readClock} orientation={orientation} />
          <Captured moves={game.moves.slice(0, game.ply)} pieceSet={settings.pieceSetId} />
          <Scoreboard score={records.score} />
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
                onExport={() => downloadPgn(game)}
                onDismiss={endCard.dismiss}
              />
            ) : null}
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
            onResume={() => {
              // Both snap the display back to the live ply, which can be
              // exactly one move on from the browsed position: a jump, not
              // a move, so the board cuts to it.
              input.cut()
              controller.resume()
            }}
            onStep={() => {
              input.cut()
              controller.step()
            }}
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
            onPuzzles={openPuzzles}
          />
          <GameIO game={game} onImport={lifecycle.handleImport} />
        </div>

        <div className="right-column">
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
