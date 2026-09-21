import { useEffect, useRef, useState } from 'react'
import type { Game } from '../game-core/game'
import type { Color, DrawReason, GameStatus, PieceSymbol, Square } from '../game-core/types'
import { exportPgn, importPgn } from '../game-core/io'
import { Board, type Highlights } from './Board/Board'
import { Promotion } from './Board/Promotion'
import { reduceSelection, type SelectionState } from './Board/selection'
import { MatchController, type EngineLike } from '../match/controller'
import type { MatchConfig, MatchPhase } from '../match/types'
import { EngineClient, createWorkerTransport } from '../engine/client'
import { profileFor } from '../engine/strength'
import { templatedHint } from '../coach/templated'
import {
  clearInProgress,
  loadInProgress,
  loadScore,
  loadSettings,
  saveInProgress,
  saveScore,
  saveSettings,
  type Level,
  type MatchScore,
} from '../storage/storage'
import { TIME_CONTROLS } from '../clock/types'
import { useMatch } from './useMatch'
import { MoveList } from './panels/MoveList'
import { Captured } from './panels/Captured'
import { Clocks } from './panels/Clocks'
import { Controls } from './panels/Controls'
import { Scoreboard } from './panels/Scoreboard'
import { NewGame, type Mode } from './panels/NewGame'
import { GameIO } from './panels/GameIO'
import './app.css'

function timeControlFor(id: string) {
  return TIME_CONTROLS.find((t) => t.id === id)?.control ?? { kind: 'untimed' as const }
}

function buildConfig(opts: {
  mode: Mode
  level: Level
  timeControlId: string
  color: 'white' | 'black'
  engineAvailable: boolean
}): MatchConfig {
  const timeControl = timeControlFor(opts.timeControlId)
  if (opts.mode === 'two-player' || !opts.engineAvailable) {
    return { white: { kind: 'human' }, black: { kind: 'human' }, timeControl }
  }
  if (opts.mode === 'zero-player') {
    return {
      white: { kind: 'engine', level: opts.level },
      black: { kind: 'engine', level: opts.level },
      timeControl,
      engineDelayMs: 500,
    }
  }
  const humanIsWhite = opts.color === 'white'
  return {
    white: humanIsWhite ? { kind: 'human' } : { kind: 'engine', level: opts.level },
    black: humanIsWhite ? { kind: 'engine', level: opts.level } : { kind: 'human' },
    timeControl,
  }
}

/**
 * Build the real MatchController, wired to a real Stockfish worker — but
 * never let a missing/broken worker (no `Worker` in this environment, the
 * asset failing to load, etc.) take the whole game down. On failure we fall
 * back to a controller backed by a stub engine that always rejects, and the
 * caller disables every engine-dependent control.
 *
 * This only catches SYNCHRONOUS construction failures (e.g. no `Worker`
 * global at all, as in Vitest/jsdom). A worker that loads but then fails
 * asynchronously (a 404 on the engine asset, a bad deploy base path, a
 * network failure, or a hung handshake) is a separate case, handled by
 * `EngineClient` marking itself dead and notifying subscribers via
 * `onDead()` — see `AppInner`'s `engineDied` state below.
 */
function buildController(): {
  controller: MatchController
  engine: EngineClient | null
  engineAvailable: boolean
} {
  try {
    const engine = new EngineClient(createWorkerTransport())
    return { controller: new MatchController({ engine }), engine, engineAvailable: true }
  } catch {
    const stub: EngineLike = {
      waitReady: () => Promise.reject(new Error('engine unavailable')),
      configure: () => {},
      newGame: () => {},
      setPosition: () => {},
      search: () => Promise.reject(new Error('engine unavailable')),
      stop: () => {},
      dispose: () => {},
    }
    return { controller: new MatchController({ engine: stub }), engine: null, engineAvailable: false }
  }
}

type ControllerBundle = ReturnType<typeof buildController>

function createControllerBundle(): ControllerBundle {
  const bundle = buildController()
  bundle.controller.start({
    white: { kind: 'human' },
    black: { kind: 'human' },
    timeControl: timeControlFor(loadSettings().timeControlId),
  })
  return bundle
}

const DRAW_TEXT: Record<DrawReason, string> = {
  stalemate: 'Draw — stalemate',
  'insufficient-material': 'Draw — insufficient material',
  'threefold-repetition': 'Draw — threefold repetition',
  'fifty-move-rule': 'Draw — fifty-move rule',
}

/**
 * The result banner. Decision: derive it from `phase.reason` / `phase.winner`
 * — never from `status.kind` alone — because a resignation or a flag leaves
 * `status.kind` at 'in-progress' (the rules didn't end the game). `status`
 * here is only ever `phase.status`, the status captured at the moment the
 * match finished, so browsing history afterwards can never change the banner.
 */
function describeResult(phase: MatchPhase, displayed: GameStatus): string {
  const name = (c: Color) => (c === 'w' ? 'White' : 'Black')
  if (phase.kind === 'finished') {
    const { status, reason, winner } = phase
    switch (reason) {
      case 'normal':
        if (status.kind === 'checkmate') return `Checkmate — ${name(status.winner)} wins`
        if (status.kind === 'draw') return DRAW_TEXT[status.reason]
        return winner ? `${name(winner)} wins` : 'Game over'
      case 'flag':
        return winner ? `${name(winner)} wins on time` : 'Draw on time'
      case 'resign': {
        if (!winner) return 'Resignation'
        const loser = winner === 'w' ? 'b' : 'w'
        return `${name(loser)} resigns — ${name(winner)} wins`
      }
      case 'engine-error':
        return 'Game halted — engine error'
    }
  }
  return displayed.kind === 'in-progress' && displayed.inCheck ? 'Check' : ''
}

/** Which side, if any, is a human who can actually click "Resign" right now. */
function resignableSide(config: MatchConfig, phase: MatchPhase): Color | null {
  const whiteHuman = config.white.kind === 'human'
  const blackHuman = config.black.kind === 'human'
  if (whiteHuman && blackHuman) {
    return phase.kind === 'awaiting-human' ? phase.side : null
  }
  if (whiteHuman) return 'w'
  if (blackHuman) return 'b'
  return null
}

/**
 * Owns the lifecycle of the one `MatchController` (and the real Stockfish
 * `Worker` its `EngineClient` spawns) for the whole app.
 *
 * This can't be `useState(() => createControllerBundle())`: React Strict
 * Mode's development-only double-render calls a `useState` lazy initializer
 * TWICE, and — unlike the state value itself, of which only one of the two
 * results is kept — the *side effects* of both calls still happen. That was
 * the original bug: two Stockfish workers spawned on every mount, and one
 * was permanently orphaned (never terminated).
 *
 * Building the bundle inside a `useEffect` instead avoids that: an effect
 * body runs once per real mount. Strict Mode still double-invokes *effects*
 * on the initial mount (mount -> cleanup -> mount, synchronously, before
 * the user can interact), but that's a paired create/dispose cycle here —
 * each invocation of this effect owns exactly the bundle it created,
 * closed over by its own cleanup — so the dance nets out to: a first
 * bundle is created and immediately disposed, a second one is created and
 * stays live until the component actually unmounts. At every point in that
 * sequence at most one worker is alive, and every worker that was ever
 * created eventually gets `dispose()`d. In production (no Strict Mode
 * replay) the effect simply runs once.
 *
 * The trade-off is that `controller` isn't available for the very first
 * render (effects run after the initial commit), so `App` renders nothing
 * until the effect has fired — in practice a single, imperceptible tick.
 */
export function App() {
  const [bundle, setBundle] = useState<ControllerBundle | null>(null)

  useEffect(() => {
    const b = createControllerBundle()
    setBundle(b)
    return () => {
      b.controller.dispose()
    }
  }, [])

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
  engine: EngineClient | null
  /** Whether the engine was built successfully at construction time (a *synchronous* outcome). */
  engineConstructed: boolean
}) {
  const [settings] = useState(() => loadSettings())
  const [pendingResume] = useState(() => loadInProgress())

  const snapshot = useMatch(controller)

  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const [orientation, setOrientation] = useState<'white' | 'black'>(settings.orientation)
  const [mode, setMode] = useState<Mode>('two-player')
  const [level, setLevel] = useState<Level>(settings.level)
  const [timeControlId, setTimeControlId] = useState(settings.timeControlId)
  const [color, setColor] = useState<'white' | 'black'>(settings.orientation)
  const [canRedo, setCanRedo] = useState(false)
  const [hintText, setHintText] = useState('')
  const [hintPending, setHintPending] = useState(false)
  const [score, setScore] = useState<MatchScore>(loadScore)
  const [resumeChoice, setResumeChoice] = useState<'pending' | 'resolved'>(
    pendingResume ? 'pending' : 'resolved',
  )

  // The engine can also fail *after* construction: a 404 on the asset, a
  // network failure, or a hung handshake all arrive asynchronously and
  // can't be caught by buildController()'s try/catch. EngineClient detects
  // all three and notifies via onDead(); we fold that into the same
  // "engine unavailable" degradation that a synchronous failure produces
  // (warning banner, engine modes disabled) rather than letting the game
  // sit in engine-thinking with no way out.
  const [engineDied, setEngineDied] = useState(false)
  useEffect(() => {
    if (!engine) return
    return engine.onDead(() => setEngineDied(true))
  }, [engine])
  const engineAvailable = engineConstructed && !engineDied

  const scoredRef = useRef(false)

  const game: Game = snapshot.game
  const position = game.current()
  const displayedStatus = position.status()
  const lastMove = game.moves[game.ply - 1]

  // ---- persistence --------------------------------------------------------

  useEffect(() => {
    if (resumeChoice !== 'resolved') return
    if (snapshot.phase.kind === 'idle') return
    if (game.moves.length > 0) {
      saveInProgress(exportPgn(game))
    } else {
      clearInProgress()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, game.moves.length, resumeChoice])

  useEffect(() => {
    if (snapshot.phase.kind !== 'finished') return
    if (scoredRef.current) return
    // Guards against double-counting: set before anything else runs, so a
    // re-render with the same finished `phase`, or a redo that lands back
    // on this same finished position (neither of which calls startMatch,
    // the only place this ref is reset), can't score the game twice.
    scoredRef.current = true

    // Scoreboard semantics, derived from `phase.winner` (never `status.kind`
    // — see describeResult above) and the seat kinds, are mode-dependent:
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
    clearInProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase])

  // ---- match lifecycle ------------------------------------------------------

  const startMatch = (config: MatchConfig) => {
    controller.start(config)
    scoredRef.current = false
    setCanRedo(false)
    setHintText('')
    setSelection({ kind: 'idle' })
  }

  const handleNewGame = () => {
    const config = buildConfig({ mode, level, timeControlId, color, engineAvailable })
    startMatch(config)
    saveSettings({
      ...settings,
      level,
      timeControlId,
      orientation: mode === 'one-player' ? color : settings.orientation,
    })
    setOrientation(mode === 'one-player' ? color : 'white')
  }

  const handleImport = (imported: Game) => {
    startMatch({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: timeControlFor(timeControlId),
      startFen: imported.startFen,
    })
    for (const m of imported.moves) {
      controller.submitHumanMove({
        from: m.from,
        to: m.to,
        ...(m.promotion ? { promotion: m.promotion } : {}),
      })
    }
    setMode('two-player')
  }

  const handleResumeAccept = () => {
    if (!pendingResume) return
    const result = importPgn(pendingResume)
    if (result.ok) handleImport(result.game)
    setResumeChoice('resolved')
  }

  const handleResumeDecline = () => {
    clearInProgress()
    setResumeChoice('resolved')
  }

  // ---- moves ----------------------------------------------------------------

  const apply = (
    next: SelectionState,
    move?: { from: Square; to: Square; promotion?: PieceSymbol },
  ) => {
    setSelection(next)
    if (move) {
      const result = controller.submitHumanMove(move)
      if (result.ok) setCanRedo(false)
    }
  }

  const onSquareClick = (square: Square) => {
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    apply(out.state, out.move)
  }

  const handleUndo = () => {
    if (game.moves.length === 0) return
    controller.undo()
    setCanRedo(true)
    setSelection({ kind: 'idle' })
  }

  const handleRedo = () => {
    if (!canRedo) return
    // The controller owns this: it re-derives `phase` from the position
    // redo() lands on (e.g. back onto a checkmate), not just the move data.
    const restored = controller.redo()
    if (restored) setCanRedo(false)
  }

  // Move-list jumps browse history via the controller's goTo(), which only
  // moves the *displayed* ply and never touches the live game. The
  // controller itself also refuses this while the engine is thinking (the
  // live position it's about to reply to must stay put); phase.kind is
  // checked here too so the button reflects the same rule the controller
  // enforces, rather than trusting the click to just no-op silently.
  const handleJump = (ply: number) => {
    if (snapshot.phase.kind === 'engine-thinking') return
    controller.goTo(ply)
  }

  const handleFlip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'))

  const handleResign = () => {
    const side = resignableSide(snapshot.config, snapshot.phase)
    if (side) controller.resign(side)
  }

  const handleHint = async () => {
    if (!engine || snapshot.phase.kind !== 'awaiting-human') return
    setHintPending(true)
    setHintText('')
    try {
      await engine.waitReady()
      engine.configure(profileFor(8))
      const pos = game.current()
      engine.setPosition(pos.fen(), [])
      const result = await engine.search({ depth: 12, moveTimeMs: 500, multiPv: 1 })
      setHintText(templatedHint(result.lines, pos) ?? 'No hint available.')
    } catch {
      setHintText('Hint unavailable.')
    } finally {
      setHintPending(false)
    }
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
          <button data-testid="resume-accept" onClick={handleResumeAccept}>
            Resume
          </button>
          <button data-testid="resume-decline" onClick={handleResumeDecline}>
            Discard
          </button>
        </p>
      ) : null}

      <div className="status-row">
        <p data-testid="turn">{position.turn() === 'w' ? 'White to move' : 'Black to move'}</p>
        <p className="result" data-testid="result">
          {describeResult(snapshot.phase, displayedStatus)}
        </p>
      </div>

      <div className="layout">
        <div className="left-column">
          <Clocks clock={snapshot.clock} orientation={orientation} />
          <Captured moves={game.moves.slice(0, game.ply)} />
          <Scoreboard score={score} />
        </div>

        <div className="board-column">
          <Board
            position={position}
            orientation={orientation}
            highlights={highlights}
            onSquareClick={onSquareClick}
          />
          <span className="sr-only" data-testid="ply-count">
            {game.moves.length}
          </span>
          {selection.kind === 'awaiting-promotion' ? (
            <Promotion
              color={position.turn()}
              onChoose={(piece) => {
                const out = reduceSelection(
                  selection,
                  { kind: 'promotion-chosen', piece },
                  position,
                )
                apply(out.state, out.move)
              }}
              onCancel={() => setSelection({ kind: 'idle' })}
            />
          ) : null}
          <Controls
            phase={snapshot.phase}
            config={snapshot.config}
            canUndo={game.moves.length > 0 && snapshot.phase.kind !== 'idle'}
            canRedo={canRedo}
            canResign={resignableSide(snapshot.config, snapshot.phase) !== null}
            engineAvailable={engineAvailable}
            speed={snapshot.config.engineDelayMs ?? 500}
            hintText={hintText}
            hintPending={hintPending}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFlip={handleFlip}
            onResign={handleResign}
            onHint={() => void handleHint()}
            onPause={() => controller.pause()}
            onResume={() => controller.resume()}
            onStep={() => controller.step()}
            onSpeedChange={(ms) => controller.setSpeed(ms)}
          />
          <NewGame
            mode={mode}
            level={level}
            timeControlId={timeControlId}
            color={color}
            engineAvailable={engineAvailable}
            onModeChange={setMode}
            onLevelChange={setLevel}
            onTimeControlChange={setTimeControlId}
            onColorChange={setColor}
            onStart={handleNewGame}
          />
          <GameIO game={game} onImport={handleImport} />
        </div>

        <div className="right-column">
          <div className="tabs">
            <div className="tabs-header">
              <button type="button">Moves</button>
            </div>
            <MoveList
              moves={game.moves}
              currentPly={game.ply}
              onJump={handleJump}
              disabled={snapshot.phase.kind === 'engine-thinking'}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
