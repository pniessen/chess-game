import { Clock } from '../clock/clock'
import { Game } from '../game-core/game'
import { uciToIntent, type EngineInfo } from '../engine/uci'
import { STARTING_FEN, type Color, type GameStatus, type MoveIntent, type MoveResult, type PlayedMove } from '../game-core/types'
import { profileFor, type StrengthProfile } from '../engine/strength'
import { EngineLane, type AnalysisRequest, type SearchOutcome } from '../engine/lane'
import type { Level } from '../storage/storage'
import {
  NO_CLAUDE,
  isBotSeat,
  type ClaudeNote,
  type ClaudeSnapshot,
  type MatchConfig,
  type MatchPhase,
  type MatchSnapshot,
  type Seat,
} from './types'
import type { ClockState } from '../clock/types'
import type { ClaudeMover, ClaudeMoveResult } from '../claude/gameClient'

/** Stockfish stands in for a failed Claude turn at full strength, so the stand-in is never the weak link. */
const CLAUDE_FALLBACK_LEVEL: Level = 8
/** This many Stockfish stand-ins for one side in one game, and that Claude is out. */
const CLAUDE_FALLBACK_LIMIT = 5

/**
 * The one Claude reply the controller may keep for later (Q8), and the
 * request that produces it. `reply` settles once; awaiting it again is free.
 */
interface ClaudeAsk {
  /** The live FEN the ask was about: the only position it may be played in. */
  fen: string
  reply: Promise<ClaudeMoveResult>
}

/** The subset of EngineClient the controller needs; keeps tests trivial. */
export interface EngineLike {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves: string[]): void
  search(limits: { depth: number; moveTimeMs: number; multiPv: number }): Promise<{
    best: string
    lines: readonly EngineInfo[]
  }>
  stop(): void
  dispose(): void
  /**
   * Optional: bumped every time the worker behind this engine is replaced
   * (EngineSupervisor). EngineLane reads it to re-run a move whose search
   * failed across a replacement; declared here so an adapter that wraps an
   * engine can't silently drop it and disable that retry.
   */
  generation?(): number
}

/** Where book moves come from (OpeningBook satisfies this structurally). */
export interface BookSource {
  continuations(epd: string): readonly string[]
}

/**
 * Decide whether to play from the opening book, and which continuation.
 * Randomness is drawn only when a book move is actually possible, so levels
 * and positions without a book leave the blunder RNG sequence untouched.
 */
export function chooseBookMove(
  continuations: readonly string[],
  bookChance: number,
  random: () => number,
): string | null {
  if (continuations.length === 0 || bookChance <= 0) return null
  if (random() >= bookChance) return null
  const index = Math.min(continuations.length - 1, Math.floor(random() * continuations.length))
  return continuations[index] ?? null
}

const IDLE_CONFIG: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'human' },
  timeControl: { kind: 'untimed' },
}

/**
 * Pick the engine's move for this turn, applying the profile's deliberate
 * blunder rate (spec: "not optional garnish" — without it the low levels
 * are unbeatable and never err in a human-looking way).
 *
 * On a blunder the move comes from the engine's OWN ranked MultiPV lines,
 * never a random legal move (which would hang the queen and feel absurd):
 * take the deepest report for each `multipv` rank, then choose among the
 * weaker half of that ranking (always excluding rank 1, the best line).
 * Plays `best` on a miss, when `blunderChance` is 0, or when there are
 * fewer than two distinct candidate moves to choose from.
 */
export function chooseEngineMove(
  result: { best: string; lines: readonly EngineInfo[] },
  profile: Pick<StrengthProfile, 'blunderChance'>,
  random: () => number,
): string {
  if (profile.blunderChance <= 0) return result.best
  if (random() >= profile.blunderChance) return result.best

  // Deepest report per rank. (A later report at equal depth wins: it is the
  // more complete search of that iteration.)
  const byRank = new Map<number, EngineInfo>()
  for (const line of result.lines) {
    const rank = line.multipv ?? 1
    const seen = byRank.get(rank)
    if (!seen || (line.depth ?? 0) >= (seen.depth ?? 0)) byRank.set(rank, line)
  }

  const ranked: string[] = []
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const move = byRank.get(rank)?.pv[0]
    if (move && !ranked.includes(move)) ranked.push(move)
  }
  // The best move (by the engine's own verdict) is never a blunder candidate.
  const candidates = ranked.filter((m) => m !== result.best)
  if (ranked.length < 2 || candidates.length === 0) return result.best

  // The weaker portion: the bottom half of the ranking, rank 1 excluded.
  const weaker = ranked.slice(Math.max(1, Math.floor(ranked.length / 2))).filter((m) => m !== result.best)
  const pool = weaker.length > 0 ? weaker : candidates
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[index] ?? result.best
}

/** The true rules winner, or null when the rules did not decide one. */
function winnerFor(status: GameStatus): Color | null {
  return status.kind === 'checkmate' ? status.winner : null
}

export class MatchController {
  private readonly engine: EngineLike
  /** The ONLY path to the engine: moves pre-empt analysis, analysis waits for moves. */
  private readonly lane: EngineLane
  /** Injectable so blunder injection is deterministic under test. */
  private readonly random: () => number
  private game = new Game()
  private clock = new Clock({ kind: 'untimed' })
  private config: MatchConfig = IDLE_CONFIG
  private phase: MatchPhase = { kind: 'idle' }
  private requestId = 0
  private listeners: Array<(s: MatchSnapshot) => void> = []
  private illegalEngineMoves = 0
  /** The opening book, once loaded; null until then (engines just search). */
  private book: BookSource | null = null
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
  /** Asked for a Claude seat's moves; the UI owns its begin()/end() lifecycle. */
  private readonly claude: ClaudeMover | null
  /**
   * Claude's notes, spend and fallback counts for this game. Replaced (never
   * mutated) when any of it changes, so the snapshot's `claude` object keeps
   * its identity across emits that did not touch it.
   */
  private claudeState: ClaudeSnapshot = NO_CLAUDE
  /**
   * The single Claude reply held for later — or still on its way (Q8).
   *
   * A Claude reply costs real money, so one that arrives after its request
   * went stale is not thrown away if it still answers the live position: a
   * pause (or step) invalidates the request but not the position. The next
   * askClaude() for the same live FEN awaits this instead of calling move()
   * again — whether the reply has landed already or is still in flight, so a
   * quick pause/resume never pays for the same move twice.
   *
   * Any change of the live position (a move, undo, redo, a new game) makes
   * the reply unusable, and every one of those paths clears this; the FEN
   * key is checked again on use as belt-and-braces.
   */
  private claudeAsk: ClaudeAsk | null = null
  /**
   * Bumped by every new game. A Claude reply's spend is only credited to the
   * game that asked for it, even when the reply itself is dropped as stale.
   */
  private gameEpoch = 0

  constructor(deps: { engine: EngineLike; random?: () => number; claude?: ClaudeMover }) {
    this.engine = deps.engine
    this.lane = new EngineLane(this.engine)
    this.random = deps.random ?? Math.random
    this.claude = deps.claude ?? null
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
      claude: this.claudeState,
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

  /**
   * Low-priority engine analysis for the UI (hints, eval bar, review). It
   * never races the controller's own move searches; see EngineLane.
   */
  analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome> {
    return this.lane.analyze(req, signal)
  }

  /** The opening book loads asynchronously; until then (or without one) engines always search. */
  setBook(book: BookSource | null): void {
    this.book = book
  }

  /**
   * The book's continuations from the LIVE position that game-core accepts
   * as legal there. A malformed or wrong dataset entry is simply skipped:
   * it must never reach Game.play(), where it would count as an illegal
   * engine move (and, twice over, end the game with 'engine-error').
   */
  private legalBookMoves(): readonly string[] {
    if (!this.book) return []
    const position = this.livePosition()
    const listed = this.book.continuations(position.epd())
    if (listed.length === 0) return []
    const legal = new Set(position.legalMoves().map((m) => `${m.from}${m.to}${m.promotion ?? ''}`))
    return listed.filter((uci) => legal.has(uci))
  }

  private emit(): void {
    this.cachedSnapshot = this.buildSnapshot()
    for (const l of this.listeners) l(this.cachedSnapshot)
  }

  // ---- lifecycle --------------------------------------------------------

  start(config: MatchConfig): void {
    this.begin(config, new Game(config.startFen ? { fen: config.startFen } : undefined))
  }

  /**
   * Start a match from existing history (an imported PGN, a resumed game).
   *
   * The history is rebuilt directly into a fresh `Game` — never replayed
   * through submitHumanMove(), which would switch the clock once per move
   * and credit an increment for every historical move (+80s each side for a
   * resumed 40-move blitz game), and emit once per move. The clock starts
   * only afterwards, for the side to move, with its initial time. If that
   * side is an engine seat, the engine is asked to move. Emits once.
   *
   * `config.startFen` is ignored in favour of `history.startFen`. Returns
   * false (leaving the current match untouched) if the history does not
   * replay legally, which a validated import never produces.
   */
  load(
    config: MatchConfig,
    history: { readonly startFen: string; readonly moves: readonly PlayedMove[] },
  ): boolean {
    const game = new Game({ fen: history.startFen })
    for (const m of history.moves) {
      const r = game.play({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })
      if (!r.ok) return false
    }
    this.begin({ ...config, startFen: history.startFen }, game)
    return true
  }

  /** Shared by start()/load(): adopt `game` as the live match and route the first turn. */
  private begin(config: MatchConfig, game: Game): void {
    // Invalidate anything the engine still owes us from a previous game.
    this.requestId++
    this.illegalEngineMoves = 0
    this.stepRequestId = null
    this.gameEpoch++
    this.claudeAsk = null
    this.claudeState = NO_CLAUDE

    this.clock.dispose()
    this.config = config
    this.game = game
    this.clock = new Clock(config.timeControl)
    this.clock.onFlag((side) => this.finishOnFlag(side))

    this.lane.newGame()

    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal', winner: winnerFor(status) }
      this.emit()
      return
    }

    // The clock starts only now, for whoever is to move: no increment is
    // ever credited for moves that were already on the board.
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
    this.lane.dispose()
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

  /**
   * Set the phase for whoever must move, and kick the engine (or Claude) if
   * it is theirs. A Claude turn is an 'engine-thinking' phase too: every
   * guard keyed on that phase (goTo refused, step's request tie, the stale
   * requestId drop) applies to it unchanged, and the UI tells the two apart
   * from config[side].
   */
  private toMoveOf(side: Color): void {
    const seat = this.seatFor(side)
    if (seat.kind === 'human') {
      this.phase = { kind: 'awaiting-human', side }
      return
    }
    const id = ++this.requestId
    this.phase = { kind: 'engine-thinking', side, requestId: id }
    if (seat.kind === 'claude') void this.askClaude(side, id)
    else void this.askEngine(side, seat.level, id)
  }

  private async askEngine(side: Color, level: Level, id: number): Promise<void> {
    const profile = profileFor(level)
    const delay = this.config.engineDelayMs ?? 0
    try {
      const inBook = profile.bookChance > 0 ? this.legalBookMoves() : []
      const bookMove = chooseBookMove(inBook, profile.bookChance, this.random)
      if (bookMove !== null) {
        // No search, but still asynchronous: 'engine-thinking' is emitted
        // first, the speed slider still paces zero-player games, and every
        // invalidation path (a bumped requestId) drops it exactly as it
        // drops a stale search reply.
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
        this.applyEngineMove(bookMove, side, level, id)
        return
      }
      const multiPv = profile.blunderChance > 0 ? profile.blunderPool : 1
      // Always the LIVE position: the user may be browsing an earlier ply.
      // We pass a validated FEN: Stockfish 19 kills its own worker on bad input.
      const result = await this.lane.move(
        {
          profile,
          fen: this.livePosition().fen(),
          limits: { depth: profile.depth, moveTimeMs: profile.moveTimeMs, multiPv },
        },
        () => id === this.requestId,
      )
      if (id !== this.requestId) return // a stale reply; drop it

      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
      }

      this.applyEngineMove(chooseEngineMove(result, profile, this.random), side, level, id)
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
      // Spec error table: rejected, logged, re-requested once. Only the move
      // and the position: nothing else (and no key material) is logged.
      console.warn(`engine returned an illegal move ${uci} for FEN ${this.livePosition().fen()}`)
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
    this.notePlayed(null)
    this.afterMove(id)
  }

  // ---- Claude turns -----------------------------------------------------

  /**
   * The Claude reply for the live position: the held one (Q8) if it answers
   * this very FEN, else a fresh move() call, which becomes the held ask.
   */
  private claudeAskFor(fen: string, claude: ClaudeMover): ClaudeAsk {
    if (this.claudeAsk?.fen === fen) return this.claudeAsk
    const game = this.game
    const history = game.moves.map((m) => m.san)
    const ask: ClaudeAsk = {
      fen,
      reply: claude.move({
        // The server assumes the standard start unless told otherwise.
        ...(game.startFen !== STARTING_FEN ? { startFen: game.startFen } : {}),
        history,
      }),
    }
    this.claudeAsk = ask
    return ask
  }

  /**
   * Ask Claude for `side`'s move. Claude's failures are Claude's alone: they
   * never touch `illegalEngineMoves` nor end the game as 'engine-error'.
   *
   *  - ok: played via its SAN on the live position (see playClaudeSan).
   *  - retry: asked once more (`retried`); a second failure of any kind that
   *    is not terminal, or a SAN the position refuses, hands the turn to
   *    Stockfish (claudeFallback).
   *  - budget / fatal: nothing more can come from Claude this game.
   *
   * A reply to a stale request is held when it is an ok answer to the still
   * live position (a pause, a step's end), dropped otherwise.
   */
  private async askClaude(side: Color, id: number, retried = false): Promise<void> {
    const claude = this.claude
    if (!claude) {
      this.finish('claude-unavailable')
      return
    }
    const epoch = this.gameEpoch
    const ask = this.claudeAskFor(this.livePosition().fen(), claude)
    let reply: ClaudeMoveResult
    try {
      reply = await ask.reply
    } catch {
      // A ClaudeMover never throws by contract; treat a broken one as fatal.
      reply = { ok: false, kind: 'fatal' }
    }
    // Spend is the server's running total for the game: credit it whenever
    // it is reported, even on a reply we end up dropping, since that move
    // was paid for all the same. Never across games, though.
    if (reply.ok && epoch === this.gameEpoch) this.recordSpend(reply.gameSpentUsd)

    // Pace a zero-player game exactly as an engine move is paced.
    const delay = this.config.engineDelayMs ?? 0
    if (reply.ok && delay > 0 && id === this.requestId) {
      await new Promise((r) => setTimeout(r, delay))
    }

    if (id !== this.requestId) {
      // Stale. Keep an ok reply for the live position it answers (the next
      // ask for that FEN picks it up); anything else goes. Only touch the
      // slot if it still holds THIS ask: every live-position change has
      // already cleared it, and a newer ask may since have taken its place.
      if (this.claudeAsk === ask && (!reply.ok || ask.fen !== this.livePosition().fen())) {
        this.claudeAsk = null
      }
      return
    }
    // Current: this ask is consumed whatever it says.
    if (this.claudeAsk === ask) this.claudeAsk = null

    if (reply.ok) {
      if (this.playClaudeSan(reply.san, reply.why)) {
        this.afterMove(id)
        return
      }
      void this.claudeFallback(side, id)
      return
    }
    if (reply.kind === 'budget' || reply.kind === 'fatal') {
      this.finish('claude-unavailable')
      return
    }
    if (!retried) {
      void this.askClaude(side, id, true)
      return
    }
    void this.claudeFallback(side, id)
  }

  /**
   * Play Claude's SAN on the live position. SAN is resolved to a move intent
   * against the live position first (livePosition() is a fresh copy, so
   * trying it there changes nothing), then played through Game.play like any
   * other move. False, with nothing changed, if the position refuses it.
   */
  private playClaudeSan(san: string, why: string): boolean {
    this.viewLive() // same belt-and-braces as applyEngineMove
    const resolved = this.livePosition().trySan(san)
    if (!resolved.ok) return false
    const { from, to, promotion } = resolved.move
    const played = this.game.play({ from, to, ...(promotion ? { promotion } : {}) })
    if (!played.ok) return false
    this.notePlayed({ why, fallback: false })
    return true
  }

  /**
   * Stockfish plays Claude's turn at full strength, through the lane like
   * any engine move and dropped the same way when its request goes stale.
   * Unlike an engine seat's move, it is not re-requested on an illegal
   * reply and never counts toward `illegalEngineMoves`: if even the
   * fallback cannot move, Claude's side cannot go on — 'claude-unavailable'.
   */
  private async claudeFallback(side: Color, id: number): Promise<void> {
    const profile = profileFor(CLAUDE_FALLBACK_LEVEL)
    const delay = this.config.engineDelayMs ?? 0
    try {
      const result = await this.lane.move(
        {
          profile,
          fen: this.livePosition().fen(),
          limits: { depth: profile.depth, moveTimeMs: profile.moveTimeMs, multiPv: 1 },
        },
        () => id === this.requestId,
      )
      if (id !== this.requestId) return
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
      }
      const intent = uciToIntent(result.best)
      this.viewLive()
      const played = intent ? this.game.play(intent) : ({ ok: false } as const)
      if (!played.ok) {
        this.finish('claude-unavailable')
        return
      }
    } catch {
      // Same stale-versus-real distinction as askEngine's catch.
      if (id !== this.requestId) return
      this.finish('claude-unavailable')
      return
    }

    this.notePlayed({ why: '', fallback: true })
    const { fallbacks } = this.claudeState
    const count = fallbacks[side] + 1
    this.claudeState = { ...this.claudeState, fallbacks: { ...fallbacks, [side]: count } }
    // The limit ends the game after the move that reached it is on the board
    // — unless that very move already ended it by the rules.
    if (count >= CLAUDE_FALLBACK_LIMIT && this.game.status().kind === 'in-progress') {
      this.claudeAsk = null
      this.finish('claude-unavailable')
      return
    }
    this.afterMove(id)
  }

  /**
   * Bookkeeping for the move just played at the live ply: its Claude note
   * (null for a human or engine move) replaces whatever the notes held for
   * that ply or beyond. Notes past the live ply survive an undo, so a redo
   * brings a Claude move back with its note; a different move played there
   * instead cuts that future off, here as in Game.play.
   */
  private notePlayed(note: ClaudeNote | null): void {
    const ply = this.game.livePly - 1
    const notes = this.claudeState.notes
    const kept: Record<number, ClaudeNote> = {}
    let dropped = false
    for (const [key, value] of Object.entries(notes)) {
      if (Number(key) < ply) kept[Number(key)] = value
      else dropped = true
    }
    if (!note && !dropped) return // nothing Claude-side changed: keep the identity
    if (note) kept[ply] = note
    this.claudeState = { ...this.claudeState, notes: kept }
  }

  /** `spentUsd` is the largest running total the server has reported (replies can land out of order). */
  private recordSpend(gameSpentUsd: number): void {
    if (gameSpentUsd <= this.claudeState.spentUsd) return
    this.claudeState = { ...this.claudeState, spentUsd: gameSpentUsd }
  }

  // ---- moves ------------------------------------------------------------

  submitHumanMove(intent: MoveIntent): MoveResult {
    if (this.phase.kind !== 'awaiting-human') {
      return { ok: false, reason: 'illegal' }
    }
    const result = this.game.play(intent)
    if (!result.ok) return result
    this.notePlayed(null)
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
    // The live position just moved on: no held Claude reply answers it now.
    this.claudeAsk = null
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

  /** An aborted game ('engine-error' or 'claude-unavailable'): no winner is declared. */
  private finish(reason: 'engine-error' | 'claude-unavailable'): void {
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

  /**
   * End the match with a result the rules did not produce — used to replay a
   * stored game that ended by resignation or on time. Same bookkeeping as resign().
   */
  finishAs(reason: 'resign' | 'flag', winner: Color): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.pause()
    this.phase = { kind: 'finished', status: this.game.status(), reason, winner }
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

  /** No human seat: engines and/or Claude on both sides. */
  private isZeroPlayer(): boolean {
    return isBotSeat(this.config.white) && isBotSeat(this.config.black)
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
    // A held Claude reply answers the position undo() just left. With
    // nothing taken back (ply 0) the position is unchanged, and it still
    // answers it: keep it, the re-derived turn below picks it up.
    if (undone) this.claudeAsk = null
    if (undone && this.isOnePlayer()) {
      // At most one more pop: turns alternate, so after it the human is to
      // move. (It fails harmlessly at ply 0, e.g. the engine opened as White.)
      if (isBotSeat(this.seatFor(this.livePosition().turn()))) this.game.undo()
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
      if (isBotSeat(this.seatFor(this.livePosition().turn()))) this.game.redo()
    }

    // The live position just changed under whatever engine request (if any)
    // was in flight for the position we redid away from.
    this.requestId++
    this.stepRequestId = null
    this.claudeAsk = null

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
