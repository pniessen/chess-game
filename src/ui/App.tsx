import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Game } from '../game-core/game'
import type { Color, DrawReason, GameStatus, PieceSymbol, PlayedMove, Square } from '../game-core/types'
import { exportPgn, gameFromSan, importPgn } from '../game-core/io'
import { Board, type Highlights } from './Board/Board'
import { EvalBar } from './Board/EvalBar'
import { Promotion } from './Board/Promotion'
import { reduceSelection, type SelectionState } from './Board/selection'
import { MatchController, type EngineLike } from '../match/controller'
import type { MatchConfig, MatchPhase } from '../match/types'
import { EngineClient, createWorkerTransport } from '../engine/client'
import { EngineSupervisor, type EngineHealth } from '../engine/supervisor'
import { templatedHint } from '../coach/templated'
import { HINT_BUDGET, hintRequestFrom } from '../coach/hints'
import { CoachClient } from '../coach/client'
import { useCoach } from './useCoach'
import { useHints, type HintAnalyze, type HintReasoner } from './hints/useHints'
import { BoundedEvalCache, useEvaluation, type EvalAnalyze } from './useEvaluation'
import { useOpeningBook } from './useOpeningBook'
import type { OpeningEntry } from '../openings/book'
import { displayedSanKeyOf, hintKeyOf, liveKeyOf, reviewKeyOf } from './gameKey'
import {
  addHistoryEntry,
  clearInProgress,
  historyStatus,
  loadHistory,
  loadInProgress,
  loadScore,
  loadSettings,
  resetHistory,
  saveInProgress,
  saveScore,
  saveSettings,
  updateHistoryAccuracy,
  type HistoryEntry,
  type HistoryStatus,
  type Level,
  type MatchScore,
  type Settings,
} from '../storage/storage'
import { TIME_CONTROLS } from '../clock/types'
import { useMatch } from './useMatch'
import { planResume, setupOf } from './resume'
import { MoveList } from './panels/MoveList'
import { Captured } from './panels/Captured'
import { Clocks } from './panels/Clocks'
import { Controls } from './panels/Controls'
import { Scoreboard } from './panels/Scoreboard'
import { NewGame, type Mode } from './panels/NewGame'
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
import { historyEntryFor, humanSidesOf, newHistoryId } from './history/record'
import { PuzzleScreen } from './puzzles/PuzzleScreen'
import { usePuzzleMode } from './puzzles/usePuzzleMode'
import { blunderPuzzlesFrom } from '../puzzles/blunders'
import { addBlunderPuzzles } from '../puzzles/store'
import { SoundPlayer, soundForTransition, type SoundFrame } from '../sound/sounds'
import './app.css'

/** Task 13 adds the 'history' tab. */
type RightTab = 'moves' | 'explorer' | 'review' | 'history'

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
 * network failure, or a hung handshake) is a separate case: the
 * `EngineSupervisor` replaces a dead worker (within its restart cap) and
 * reports its health — see `AppInner`'s `engineHealth` state below.
 */
function buildController(): {
  controller: MatchController
  engine: EngineSupervisor | null
  engineAvailable: boolean
} {
  try {
    const engine = new EngineSupervisor({ createClient: () => new EngineClient(createWorkerTransport()) })
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
 * `Worker` its `EngineSupervisor` keeps alive — replacing it after a crash,
 * never running two at once) for the whole app.
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
  engine: EngineSupervisor | null
  /** Whether the engine was built successfully at construction time (a *synchronous* outcome). */
  engineConstructed: boolean
}) {
  const [settings, setSettings] = useState(() => loadSettings())
  // Every settings change is persisted immediately. (Phase 1 kept a frozen
  // copy and re-saved it on New game, which would silently undo any other
  // setting changed since the page loaded.)
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  const [pendingResume] = useState(() => loadInProgress())

  const [sound] = useState(() => new SoundPlayer({ enabled: settings.soundEnabled }))
  useEffect(() => {
    sound.setEnabled(settings.soundEnabled)
  }, [sound, settings.soundEnabled])
  useEffect(() => {
    // Browsers only start audio inside a user gesture: create it on the first one.
    const unlock = () => sound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [sound])

  // One coach client per app; it owns the offline badge and the one-time notice.
  const [coach] = useState(() => new CoachClient())
  const coachState = useCoach(coach)
  useEffect(() => {
    void coach.checkHealth()
  }, [coach])

  const snapshot = useMatch(controller)
  // Phase 3: game <-> puzzles. Entering pauses a live match through the
  // controller (no engine moves, no clocks); leaving resumes it.
  const puzzleMode = usePuzzleMode(controller)

  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const [orientation, setOrientation] = useState<'white' | 'black'>(settings.orientation)
  const [mode, setMode] = useState<Mode>('two-player')
  const [level, setLevel] = useState<Level>(settings.level)
  const [timeControlId, setTimeControlId] = useState(settings.timeControlId)
  const [color, setColor] = useState<'white' | 'black'>(settings.orientation)
  const [canRedo, setCanRedo] = useState(false)
  const [score, setScore] = useState<MatchScore>(loadScore)
  const [resumeChoice, setResumeChoice] = useState<'pending' | 'resolved'>(
    pendingResume ? 'pending' : 'resolved',
  )
  const [tab, setTab] = useState<RightTab>('moves')

  // The engine can also fail *after* construction: a 404 on the asset, a
  // network failure, a hung handshake, or a lost bestmove all arrive
  // asynchronously and can't be caught by buildController()'s try/catch.
  // The supervisor restarts the worker (status "Engine restarting…", the
  // game carries on); only once its restart budget is spent does it report
  // 'dead', which we fold into the same "engine unavailable" degradation a
  // synchronous failure produces (warning banner, engine modes disabled).
  const [engineHealth, setEngineHealth] = useState<EngineHealth>(() => engine?.health() ?? { kind: 'ok' })
  useEffect(() => {
    if (!engine) return
    setEngineHealth(engine.health())
    return engine.onHealth(setEngineHealth)
  }, [engine])
  const engineAvailable = engineConstructed && engineHealth.kind !== 'dead'

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

  const lastSoundFrame = useRef<SoundFrame | null>(null)
  useEffect(() => {
    const finished = snapshot.phase.kind === 'finished'
    const prev = lastSoundFrame.current
    lastSoundFrame.current = { game, livePly: game.livePly, finished }
    const name = soundForTransition(prev, {
      game,
      livePly: game.livePly,
      finished,
      lastMove: game.moves[game.livePly - 1],
      status: game.status(),
    })
    if (name) sound.play(name)
  }, [sound, game, game.livePly, snapshot.phase.kind])

  // Evaluations by FEN, shared by the eval bar and the review. Bounded (LRU):
  // both fill it, and it lives for the whole session.
  const [evalCache] = useState(() => new BoundedEvalCache())
  const analyzeForEval = useMemo<EvalAnalyze | null>(
    () => (engineAvailable ? (req, signal) => controller.analyze(req, signal) : null),
    [engineAvailable, controller],
  )
  const evaluation = useEvaluation({
    analyze: analyzeForEval,
    fen: position.fen(),
    status: displayedStatus,
    enabled: settings.showEval,
    cache: evalCache,
  })

  const { book, failed: bookFailed } = useOpeningBook()
  // The engine's opening book is the same dataset. Until it loads (or if it
  // failed), the controller has none and engines simply search.
  useEffect(() => {
    controller.setBook(book)
  }, [controller, book])
  // The SANs up to the displayed ply: an undo followed by a different move
  // leaves ply/livePly unchanged, so the moves themselves are the memo key.
  const sanKey = displayedSanKeyOf(game)
  const opening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.ply, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, game.ply, sanKey],
  )

  // The LIVE game's full move list: an undo followed by a different move
  // keeps the same Game object and length, so the SANs are the key.
  const liveSanKey = liveKeyOf(game)
  const finalOpening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.livePly, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, liveSanKey],
  )
  const finalOpeningName = finalOpening ? `${finalOpening.eco} ${finalOpening.name}` : null
  /** A review belongs to one game AND its exact move list (ruling P5); browsing leaves this unchanged. */
  const reviewKey = reviewKeyOf(game)

  // ---- persistence --------------------------------------------------------

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

  // ---- match lifecycle ------------------------------------------------------

  const startMatch = (config: MatchConfig) => {
    controller.start(config)
    scoredRef.current = false
    recordedRef.current = false
    historyRef.current = null
    setCanRedo(false)
    setSelection({ kind: 'idle' })
  }

  const handleNewGame = () => {
    const config = buildConfig({ mode, level, timeControlId, color, engineAvailable })
    startMatch(config)
    updateSettings({ level, timeControlId, ...(mode === 'one-player' ? { orientation: color } : {}) })
    setOrientation(mode === 'one-player' ? color : 'white')
  }

  /**
   * Start a match from existing history. load(), not start() + N x
   * submitHumanMove(): replaying through the move path credited a clock
   * increment per historical move and emitted once per move.
   *
   * `alreadyScored` is decided BEFORE load() runs, since load() may land
   * straight in 'finished'. A history that is already finished is always
   * treated as scored: the user never played that result here (or, for a
   * resumed game, it was counted when it happened).
   */
  const loadMatch = (config: MatchConfig, history: Game, alreadyScored: boolean, alreadyRecorded = false) => {
    scoredRef.current = alreadyScored || history.status().kind !== 'in-progress'
    // Required fix (Task 13 review, round 1, Finding 3): recording is
    // decoupled from scoring — it depends ONLY on whether the loaded game is
    // already finished, never on `scoredRef`/`alreadyScored`. A resume passes
    // `pendingResume.scored || plan.degraded` as `alreadyScored`, and a
    // DEGRADED resume (an engine seat, but no engine today) of a game that is
    // still IN-PROGRESS sets that to true even though nothing has been
    // recorded yet; tying `recordedRef` to `scoredRef` as before meant that
    // game's later live finish was silently never recorded. A history that
    // is already finished (an import, a resume, a replay) is still never
    // re-recorded: only a finish OBSERVED LIVE creates a history entry.
    // `alreadyRecorded` carries a resumed save's own flag (finished, recorded,
    // taken back, reloaded): its next finish must not add a second entry,
    // exactly as it wouldn't have without the reload.
    recordedRef.current = alreadyRecorded || history.status().kind !== 'in-progress'
    historyRef.current = null
    controller.load(config, history)
    setCanRedo(false)
    setSelection({ kind: 'idle' })
  }

  const handleImport = (imported: Game) => {
    loadMatch(
      { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: timeControlFor(timeControlId) },
      imported,
      false,
    )
    setMode('two-player')
  }

  /** The explorer's "Start from this opening": the line, with the current New-game choices. */
  const handleStartOpening = (entry: OpeningEntry) => {
    const built = gameFromSan(entry.moves)
    if (!built.ok) return
    loadMatch(buildConfig({ mode, level, timeControlId, color, engineAvailable }), built.game, false)
    setOrientation(mode === 'one-player' ? color : 'white')
    setTab('moves')
  }

  /**
   * Replay a stored game: load it as a finished two-player game to browse
   * and review. Replaying never adds a second history entry or changes the
   * score (loadMatch treats it as already-scored, like an import).
   *
   * A resignation/flag isn't a rules result `load()` can reconstruct by
   * itself (the position after the last recorded move may still be
   * 'in-progress'), so it's re-applied explicitly via `finishAs()`.
   */
  const handleReplay = (entry: HistoryEntry) => {
    const parsed = importPgn(entry.pgn)
    if (!parsed.ok) return
    loadMatch({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }, parsed.game, true)
    recordedRef.current = true
    // `controller.load()` (called synchronously by loadMatch above) builds
    // its OWN new Game internally — not `parsed.game` — so the object this
    // review/accuracy guard must key on is read back from the controller,
    // not captured from `parsed`.
    historyRef.current = { id: entry.id, key: reviewKeyOf(controller.snapshot().game) }
    if (parsed.game.status().kind === 'in-progress' && entry.termination !== 'normal') {
      const winner = entry.result === '1-0' ? 'w' : entry.result === '0-1' ? 'b' : null
      if (winner) controller.finishAs(entry.termination, winner)
    }
    setMode('two-player')
    setOrientation('white')
    setTab('moves')
  }

  const handleResumeAccept = () => {
    if (!pendingResume) return
    const result = importPgn(pendingResume.pgn)
    if (result.ok) {
      // Restore the ORIGINAL mode: a resumed one-player game must stay
      // one-player (as two-player, a loss to the engine scored as a "win").
      const plan = planResume(pendingResume.setup, engineAvailable, timeControlFor(timeControlId))
      loadMatch(plan.config, result.game, pendingResume.scored || plan.degraded, pendingResume.recorded)
      setMode(plan.mode)
      if (plan.level !== null) setLevel(plan.level)
      if (plan.humanColor !== null) setColor(plan.humanColor)
      if (plan.timeControlId !== null) setTimeControlId(plan.timeControlId)
      setOrientation(plan.humanColor ?? 'white')
    }
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
              onChoose={(piece) => {
                const out = reduceSelection(
                  selection,
                  { kind: 'promotion-chosen', piece },
                  position,
                )
                apply(out.state, out.move)
              }}
              onCancel={() => setSelection({ kind: 'idle' })}
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
            onPuzzles={puzzleMode.enter}
          />
          <GameIO game={game} onImport={handleImport} />
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
                  <Explorer book={book} unavailable={bookFailed} current={opening} onStart={handleStartOpening} />
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
                    onReplay={handleReplay}
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
