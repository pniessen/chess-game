import { useState } from 'react'
import type { Game } from '../../game-core/game'
import { gameFromSan, importPgn } from '../../game-core/io'
import type { MatchController } from '../../match/controller'
import type { MatchConfig } from '../../match/types'
import type { OpeningEntry } from '../../openings/book'
import { clearInProgress, type HistoryEntry, type Level, type Settings } from '../../storage/storage'
import type { Mode } from '../panels/NewGame'
import { planResume, setupOf } from '../resume'
import { reviewKeyOf } from '../gameKey'
import { buildConfig, timeControlFor } from './matchConfig'
import type { MatchRecords } from './useMatchRecords'

export interface NewGameChoices {
  mode: Mode
  level: Level
  timeControlId: string
  color: 'white' | 'black'
  setMode: (mode: Mode) => void
  setLevel: (level: Level) => void
  setTimeControlId: (id: string) => void
  setColor: (color: 'white' | 'black') => void
}

/**
 * Starting and loading matches: New game, import, start-from-opening,
 * replay from history and resume. Owns the New-game choices and the board
 * orientation; every start/load resets the records' scored/recorded/history
 * refs exactly as before and clears the board input (`resetInput`).
 */
export function useMatchLifecycle({
  controller,
  settings,
  updateSettings,
  engineAvailable,
  records,
  resetInput,
  onMatchReset,
  onShowMoves,
}: {
  controller: MatchController
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  engineAvailable: boolean
  records: Pick<MatchRecords, 'pendingResume' | 'setResumeChoice' | 'scoredRef' | 'recordedRef' | 'historyRef'>
  /** Clears redo and any selection; called after every start/load. */
  resetInput: () => void
  /** Task 6: closes the game-end card and forgets the phase it had seen; called after every start/load. */
  onMatchReset: () => void
  /** Brings the Moves tab to the front. */
  onShowMoves: () => void
}) {
  const { pendingResume, setResumeChoice, scoredRef, recordedRef, historyRef } = records
  const [orientation, setOrientation] = useState<'white' | 'black'>(settings.orientation)
  const [mode, setMode] = useState<Mode>('two-player')
  const [level, setLevel] = useState<Level>(settings.level)
  const [timeControlId, setTimeControlId] = useState(settings.timeControlId)
  const [color, setColor] = useState<'white' | 'black'>(settings.orientation)

  const startMatch = (config: MatchConfig) => {
    controller.start(config)
    scoredRef.current = false
    recordedRef.current = false
    historyRef.current = null
    resetInput()
    onMatchReset()
  }

  /**
   * Task 6: "Rematch" on the game-end card — the setup that just finished,
   * read back off the controller rather than off the New game panel, whose
   * selects the user may have changed while the game was running. Same
   * seats (so the same colours and the same engine level), same time
   * control, same speed, same starting position; the board is not flipped,
   * because a rematch keeps the colours you were playing.
   *
   * Routed through `planResume`, which is exactly the job to be done here:
   * turn a setup back into a config to play, DEGRADING an engine seat to a
   * human one when there is no engine (review fix round 1 — without this a
   * rematch after the worker died started a match with a seat nothing could
   * fill, and the board simply waited), and hand back what the New game
   * panel should say, so the panel cannot drift out of step with the
   * running match and silently feed stale values to the NEXT new game.
   */
  const handleRematch = () => {
    const { config } = controller.snapshot()
    const plan = planResume(setupOf(config), engineAvailable, timeControlFor(timeControlId))
    // planResume works from a stored setup, which carries no start
    // position; a rematch of a game that began from one starts there again.
    startMatch({ ...plan.config, ...(config.startFen !== undefined ? { startFen: config.startFen } : {}) })
    setMode(plan.mode)
    if (plan.level !== null) setLevel(plan.level)
    if (plan.humanColor !== null) setColor(plan.humanColor)
    if (plan.timeControlId !== null) setTimeControlId(plan.timeControlId)
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
    resetInput()
    onMatchReset()
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
    onShowMoves()
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
    onShowMoves()
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

  const handleFlip = () => setOrientation((o) => (o === 'white' ? 'black' : 'white'))

  const choices: NewGameChoices = { mode, level, timeControlId, color, setMode, setLevel, setTimeControlId, setColor }
  return {
    choices,
    orientation,
    handleFlip,
    handleNewGame,
    handleRematch,
    handleImport,
    handleStartOpening,
    handleReplay,
    handleResumeAccept,
    handleResumeDecline,
  }
}
