import { Clock } from '../clock/clock'
import { Game } from '../game-core/game'
import { uciToIntent } from '../engine/uci'
import type { Color, GameStatus, MoveIntent, MoveResult } from '../game-core/types'
import { profileFor, type StrengthProfile } from '../engine/strength'
import type { Level } from '../storage/storage'
import type { MatchConfig, MatchPhase, MatchSnapshot, Seat } from './types'
import type { ClockState } from '../clock/types'

/** The subset of EngineClient the controller needs; keeps tests trivial. */
export interface EngineLike {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves: string[]): void
  search(limits: { depth: number; moveTimeMs: number; multiPv: number }): Promise<{
    best: string
    lines: unknown[]
  }>
  stop(): void
  dispose(): void
}

const IDLE_CONFIG: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'human' },
  timeControl: { kind: 'untimed' },
}

/** The true rules winner, or null when the rules did not decide one. */
function winnerFor(status: GameStatus): Color | null {
  return status.kind === 'checkmate' ? status.winner : null
}

export class MatchController {
  private readonly engine: EngineLike
  private game = new Game()
  private clock = new Clock({ kind: 'untimed' })
  private config: MatchConfig = IDLE_CONFIG
  private phase: MatchPhase = { kind: 'idle' }
  private requestId = 0
  private listeners: Array<(s: MatchSnapshot) => void> = []
  private illegalEngineMoves = 0
  /**
   * The requestId of the in-flight engine request issued by step(), or null
   * when no step is pending. Tying the flag to the request it belongs to
   * (rather than a bare boolean) means afterMove() only treats a completing
   * request as "the step" if that request is the one the flag names — so
   * pause()/undo()/resign()/finish() clearing this (alongside bumping
   * requestId) closes every path that can invalidate a pending step, not
   * just the step's own successful completion.
   */
  private stepRequestId: number | null = null
  /**
   * Cached so repeated snapshot() calls with no intervening state change
   * return the SAME object (by reference). useSyncExternalStore compares
   * snapshots with Object.is; without this, snapshot() building a fresh
   * object every call would make every render look like a change and React
   * would re-render (and can warn about an infinite loop) on every check.
   */
  private cachedSnapshot: MatchSnapshot

  constructor(deps: { engine: EngineLike }) {
    this.engine = deps.engine
    this.cachedSnapshot = this.buildSnapshot()
  }

  // ---- subscription -----------------------------------------------------

  subscribe(cb: (s: MatchSnapshot) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  private buildSnapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      game: this.game,
      clock: this.clock.getState(),
      config: this.config,
    }
  }

  snapshot(): MatchSnapshot {
    return this.cachedSnapshot
  }

  /**
   * A FRESH read of the clock, computed from the running side's start
   * timestamp (so it never drifts, however irregularly it is polled).
   *
   * `snapshot().clock` is frozen at the last emit() — correct for which side
   * is running, but its times go stale between moves. The on-screen clock
   * polls this instead while a side is running. Deliberately NOT routed
   * through emit(): rebuilding and broadcasting the whole snapshot ten times
   * a second just to repaint two numbers would re-render the entire app.
   */
  clockState(): ClockState {
    return this.clock.getState()
  }

  private emit(): void {
    this.cachedSnapshot = this.buildSnapshot()
    for (const l of this.listeners) l(this.cachedSnapshot)
  }

  // ---- lifecycle --------------------------------------------------------

  start(config: MatchConfig): void {
    // Invalidate anything the engine still owes us from a previous game.
    this.requestId++
    this.illegalEngineMoves = 0
    this.stepRequestId = null

    this.clock.dispose()
    this.config = config
    this.game = new Game(config.startFen ? { fen: config.startFen } : undefined)
    this.clock = new Clock(config.timeControl)
    this.clock.onFlag((side) => this.finishOnFlag(side))

    this.engine.newGame()

    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal', winner: winnerFor(status) }
      this.emit()
      return
    }

    const side = this.livePosition().turn()
    this.clock.start(side)
    this.toMoveOf(side)
    this.emit()
  }

  dispose(): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.dispose()
    this.listeners = []
    this.engine.dispose()
  }

  // ---- live vs viewed position -------------------------------------------

  /**
   * The ACTUAL current game position — the one after every played move.
   *
   * Never use `this.game.current()` in the controller: that is the
   * *displayed* position, which is an earlier ply whenever the user is
   * browsing the move list (legal while paused, or while a human is to
   * move). Everything the controller decides — whose turn it is, which FEN
   * the engine searches, the result — is about the live game, so it must
   * read it from here. `game.status()` is already live.
   */
  private livePosition() {
    return this.game.positionAt(this.game.livePly)
  }

  /** Snap the display back to the live position (browsing is view-only). */
  private viewLive(): void {
    this.game.goTo(this.game.livePly)
  }

  // ---- turn routing -----------------------------------------------------

  private seatFor(side: Color): Seat {
    return side === 'w' ? this.config.white : this.config.black
  }

  /** Set the phase for whoever must move, and kick the engine if it is theirs. */
  private toMoveOf(side: Color): void {
    const seat = this.seatFor(side)
    if (seat.kind === 'human') {
      this.phase = { kind: 'awaiting-human', side }
      return
    }
    const id = ++this.requestId
    this.phase = { kind: 'engine-thinking', side, requestId: id }
    void this.askEngine(side, seat.level, id)
  }

  private async askEngine(side: Color, level: Level, id: number): Promise<void> {
    const profile = profileFor(level)
    const delay = this.config.engineDelayMs ?? 0
    try {
      await this.engine.waitReady()
      if (id !== this.requestId) return

      this.engine.configure(profile)
      // We pass a validated FEN: Stockfish 19 kills its own worker on bad input.
      // Always the LIVE position: the user may be browsing an earlier ply.
      this.engine.setPosition(this.livePosition().fen(), [])

      const multiPv = profile.blunderChance > 0 ? profile.blunderPool : 1
      const result = await this.engine.search({
        depth: profile.depth,
        moveTimeMs: profile.moveTimeMs,
        multiPv,
      })
      if (id !== this.requestId) return // a stale reply; drop it

      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
      }

      this.applyEngineMove(result.best, side, level, id)
    } catch {
      // A rejection here can be a genuine engine failure OR our own
      // supersede (search() rejects the superseded promise when a new
      // search starts, e.g. because a new game began while this one was
      // still thinking). The id check tells the two apart: if id is no
      // longer current, this request has already been invalidated by
      // start()/undo()/pause()/etc, and ending the game here would finish
      // a match that this rejection has nothing to do with.
      if (id !== this.requestId) return
      this.finish('engine-error')
    }
  }

  private applyEngineMove(uci: string, side: Color, level: Level, id: number): void {
    const intent = uciToIntent(uci)
    // An engine move always lands on the live position. goTo() is refused
    // while the engine thinks and resume()/step() snap to live, so this is
    // belt-and-braces: Game.play() refuses outright off the live ply, which
    // would otherwise be miscounted as an illegal engine move.
    this.viewLive()
    const result = intent ? this.game.play(intent) : ({ ok: false } as const)
    if (!result.ok) {
      this.illegalEngineMoves++
      if (this.illegalEngineMoves >= 2) {
        // Spec: halt with the position preserved rather than corrupt it.
        this.finish('engine-error')
        return
      }
      // Ask once more with the same id still current.
      void this.askEngine(side, level, id)
      return
    }
    this.illegalEngineMoves = 0
    this.afterMove(id)
  }

  // ---- moves ------------------------------------------------------------

  submitHumanMove(intent: MoveIntent): MoveResult {
    if (this.phase.kind !== 'awaiting-human') {
      return { ok: false, reason: 'illegal' }
    }
    const result = this.game.play(intent)
    if (!result.ok) return result
    this.afterMove()
    return result
  }

  /**
   * Shared tail for any applied move: check the result, switch the clock.
   * `completedRequestId` is the requestId of the engine request that just
   * resolved into this move (undefined for a human move, which can never be
   * the completion of a step). It is compared against `stepRequestId`
   * rather than trusting a bare "a step is pending" flag, so a step that
   * was invalidated and superseded by a *new* step (or new engine turn)
   * can't be mistaken for the original one completing.
   */
  private afterMove(completedRequestId?: number): void {
    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal', winner: winnerFor(status) }
      this.clock.pause()
      this.emit()
      return
    }

    const next = this.livePosition().turn()
    this.clock.switchTo(next)

    if (this.stepRequestId !== null && completedRequestId === this.stepRequestId) {
      this.stepRequestId = null
      this.phase = { kind: 'paused' }
      this.clock.pause()
      this.emit()
      return
    }

    this.toMoveOf(next)
    this.emit()
  }

  // ---- ending -----------------------------------------------------------

  /** Only reachable for 'engine-error': no winner is declared. */
  private finish(reason: 'engine-error'): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.pause()
    this.phase = { kind: 'finished', status: this.game.status(), reason, winner: null }
    this.emit()
  }

  private finishOnFlag(side: Color): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.pause()
    this.phase = {
      kind: 'finished',
      // A flag is not a rules result: the position may well be in-progress.
      // Report the true rules status, and the winner separately.
      status: this.game.status(),
      reason: 'flag',
      winner: side === 'w' ? 'b' : 'w',
    }
    this.emit()
  }

  resign(side: Color): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.pause()
    this.phase = {
      kind: 'finished',
      // A resignation is not a rules result either; same reasoning as above.
      status: this.game.status(),
      reason: 'resign',
      winner: side === 'w' ? 'b' : 'w',
    }
    this.emit()
  }

  // ---- controls ---------------------------------------------------------

  pause(): void {
    if (this.phase.kind === 'finished' || this.phase.kind === 'idle') return
    this.requestId++ // drop any in-flight engine reply
    this.stepRequestId = null // ...and any step that reply would have completed
    this.clock.pause()
    this.phase = { kind: 'paused' }
    this.emit()
  }

  resume(): void {
    if (this.phase.kind !== 'paused') return
    // The user may have browsed history while paused. Play resumes from the
    // LIVE position, and the view snaps back there so they see the move.
    this.viewLive()
    this.clock.resume()
    this.toMoveOf(this.livePosition().turn())
    this.emit()
  }

  /** Allow exactly one engine move, then return to paused. */
  step(): void {
    if (this.phase.kind !== 'paused') return
    this.viewLive() // same reasoning as resume()
    this.toMoveOf(this.livePosition().turn())
    // Only an engine turn actually issues a request to tie the step to; if
    // it's a human's turn there is nothing pending, so nothing to flag.
    // Read the fresh phase back out through buildSnapshot() rather than
    // `this.phase` directly: TS's control-flow narrowing from the
    // early-return guard above (this.phase.kind !== 'paused') survives the
    // toMoveOf() call textually even though toMoveOf() just reassigned the
    // field, so `this.phase` would still (wrongly) type-check as 'paused'
    // here. Going through the method call's declared return type avoids it.
    // buildSnapshot() (not the cached, public snapshot()) so this reads the
    // state toMoveOf() just wrote, not a stale cached snapshot from before it.
    const phaseAfter = this.buildSnapshot().phase
    this.stepRequestId = phaseAfter.kind === 'engine-thinking' ? phaseAfter.requestId : null
    this.emit()
  }

  setSpeed(delayMs: number): void {
    this.config = { ...this.config, engineDelayMs: delayMs }
    this.emit()
  }

  /** Exactly one human seat and one engine seat. */
  private isOnePlayer(): boolean {
    return (this.config.white.kind === 'human') !== (this.config.black.kind === 'human')
  }

  private isZeroPlayer(): boolean {
    return this.config.white.kind === 'engine' && this.config.black.kind === 'engine'
  }

  /**
   * After undo()/redo() rewrote the live position, put the clock on the side
   * now to move (no increment: nobody just moved). `running` false leaves it
   * paused on that side, so a later resume() restarts the right clock.
   */
  private clockTo(side: Color, running: boolean): void {
    this.clock.start(side)
    if (!running) this.clock.pause()
  }

  /**
   * Take back a move.
   *
   * One-player: pop plies until it is the HUMAN's turn — one ply if the
   * engine is to move (e.g. it is still thinking about the human's last
   * move: its previous reply must survive), two if the human is to move
   * (their move and the engine's reply). Popping a fixed two plies would, in
   * the first case, also remove the engine's previous move and send it off
   * to replay it — possibly differently.
   *
   * Two-player: one ply. Zero-player: one ply, then stay paused.
   *
   * Any in-flight engine request is invalidated either way.
   */
  undo(): void {
    this.requestId++
    this.stepRequestId = null

    // Even with nothing to take back, fall through and re-derive the phase:
    // the requestId bump above has just orphaned any in-flight request.
    const undone = this.game.undo()
    if (undone && this.isOnePlayer()) {
      // At most one more pop: turns alternate, so after it the human is to
      // move. (It fails harmlessly at ply 0, e.g. the engine opened as White.)
      if (this.seatFor(this.livePosition().turn()).kind === 'engine') this.game.undo()
    }

    const status = this.game.status()
    if (status.kind === 'in-progress') {
      const side = this.livePosition().turn()
      if (this.isZeroPlayer()) {
        this.phase = { kind: 'paused' }
        this.clockTo(side, false)
      } else {
        this.clockTo(side, true)
        this.toMoveOf(side)
      }
    }
    this.emit()
  }

  /**
   * Redo what undo() took back — its exact inverse, per mode, restoring
   * RECORDED plies rather than asking the engine for new ones.
   *
   * `Game.redo()` always lands on the live position, so, like undo(), this
   * re-derives `phase` from the fresh position: a redo can restore a
   * checkmate just as easily as an ordinary position. Returns false (no-op,
   * no emit) when there is nothing to redo.
   *
   * One-player: redo plies until it is the human's turn, mirroring undo().
   * If that runs out of recorded plies with the engine to move — i.e. the
   * undo interrupted the engine while it was thinking, so no reply was ever
   * recorded — the position is exactly the one undo() started from, and the
   * engine is asked again, just as it was then. That substitutes nothing:
   * there is no recorded reply to substitute for. (Leaving it 'paused' there
   * would strand a one-player game on the engine's turn.)
   *
   * Two-player: one ply. Zero-player: one ply, stay paused, never search.
   */
  redo(): boolean {
    if (!this.game.redo()) return false
    if (this.isOnePlayer() && this.game.status().kind === 'in-progress') {
      if (this.seatFor(this.livePosition().turn()).kind === 'engine') this.game.redo()
    }

    // The live position just changed under whatever engine request (if any)
    // was in flight for the position we redid away from.
    this.requestId++
    this.stepRequestId = null

    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal', winner: winnerFor(status) }
      this.clock.pause()
      this.emit()
      return true
    }

    const side = this.livePosition().turn()
    if (this.isZeroPlayer()) {
      this.phase = { kind: 'paused' }
      this.clockTo(side, false)
    } else {
      this.clockTo(side, true)
      this.toMoveOf(side)
    }
    this.emit()
    return true
  }

  /**
   * Browse history without disturbing the live game: only the *displayed*
   * ply moves. Refused while the engine is thinking, since the live
   * position the engine is about to reply to must stay exactly what it was
   * asked about — browsing away from it and back doesn't change that
   * position, so there is nothing to invalidate here (contrast redo(),
   * which does change the live position and so does invalidate).
   */
  goTo(ply: number): void {
    if (this.phase.kind === 'engine-thinking') return
    this.game.goTo(ply)
    this.emit()
  }
}
