import { Clock } from '../clock/clock'
import { Game } from '../game-core/game'
import { uciToIntent } from '../engine/uci'
import type { Color, GameStatus, MoveIntent, MoveResult } from '../game-core/types'
import { profileFor, type StrengthProfile } from '../engine/strength'
import type { Level } from '../storage/storage'
import type { MatchConfig, MatchPhase, MatchSnapshot, Seat } from './types'

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

  constructor(deps: { engine: EngineLike }) {
    this.engine = deps.engine
  }

  // ---- subscription -----------------------------------------------------

  subscribe(cb: (s: MatchSnapshot) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  snapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      game: this.game,
      clock: this.clock.getState(),
      config: this.config,
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
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

    const side = this.game.current().turn()
    this.clock.start(side)
    this.toMoveOf(side)
    this.emit()
  }

  dispose(): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.dispose()
    this.listeners = []
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
      this.engine.setPosition(this.game.current().fen(), [])

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

    const next = this.game.current().turn()
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
    this.clock.resume()
    this.toMoveOf(this.game.current().turn())
    this.emit()
  }

  /** Allow exactly one engine move, then return to paused. */
  step(): void {
    if (this.phase.kind !== 'paused') return
    this.toMoveOf(this.game.current().turn())
    // Only an engine turn actually issues a request to tie the step to; if
    // it's a human's turn there is nothing pending, so nothing to flag.
    // Read the fresh phase back out through snapshot() rather than
    // `this.phase` directly: TS's control-flow narrowing from the
    // early-return guard above (this.phase.kind !== 'paused') survives the
    // toMoveOf() call textually even though toMoveOf() just reassigned the
    // field, so `this.phase` would still (wrongly) type-check as 'paused'
    // here. Going through the method call's declared return type avoids it.
    const phaseAfter = this.snapshot().phase
    this.stepRequestId = phaseAfter.kind === 'engine-thinking' ? phaseAfter.requestId : null
    this.emit()
  }

  setSpeed(delayMs: number): void {
    this.config = { ...this.config, engineDelayMs: delayMs }
    this.emit()
  }

  /**
   * Take back a move. Against an engine this must remove BOTH plies, or the
   * engine instantly replays and the undo appears to do nothing.
   */
  undo(): void {
    this.requestId++
    this.stepRequestId = null
    const opponentIsEngine =
      this.config.white.kind === 'engine' || this.config.black.kind === 'engine'
    const bothEngines =
      this.config.white.kind === 'engine' && this.config.black.kind === 'engine'

    this.game.undo()
    if (opponentIsEngine && !bothEngines) this.game.undo()

    const status = this.game.status()
    if (status.kind === 'in-progress') {
      const side = this.game.current().turn()
      if (bothEngines) {
        this.phase = { kind: 'paused' }
      } else {
        this.toMoveOf(side)
      }
    }
    this.emit()
  }
}
