import type { StrengthProfile } from './strength'
import { isCriticalError, parseBestMove, parseInfo, type EngineInfo } from './uci'

export interface EngineTransport {
  post(cmd: string): void
  onMessage(cb: (line: string) => void): void
  /**
   * Fired for a transport-level failure that has nothing to do with the UCI
   * protocol — a 404 on the engine asset, a network failure, a wrong deploy
   * base path, or any other reason the browser's Worker never got to run.
   * `new Worker(url)` does not throw for these; they only ever surface here,
   * asynchronously, via the worker's own `error` event.
   */
  onError(cb: (err: unknown) => void): void
  terminate(): void
}

export interface SearchResult {
  best: string
  lines: EngineInfo[]
}

export interface SearchLimits {
  depth: number
  moveTimeMs: number
  multiPv: number
}

const DEFAULT_ENGINE_URL = '/engine/stockfish-19-lite-single.js'

/**
 * Load the Emscripten glue script as a CLASSIC worker. It is not an ES
 * module and finds its .wasm relative to its own URL, so Vite's module
 * worker pipeline must not touch it.
 */
export function createWorkerTransport(url: string = DEFAULT_ENGINE_URL): EngineTransport {
  const worker = new Worker(url)
  return {
    post: (cmd) => worker.postMessage(cmd),
    onMessage: (cb) =>
      worker.addEventListener('message', (e: MessageEvent<string>) => {
        if (typeof e.data === 'string') cb(e.data)
      }),
    // A 404 on the script, a bad MIME type, or an uncaught exception while
    // the worker script evaluates all land here as an ErrorEvent — never as
    // a thrown exception from `new Worker(url)` itself.
    onError: (cb) => worker.addEventListener('error', (e) => cb(e)),
    terminate: () => worker.terminate(),
  }
}

/** Best-effort human-readable text out of whatever a transport's `onError` handed us. */
function describeTransportError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return String(err)
}

/**
 * How long we'll wait for the initial `uci`/`isready` handshake to answer
 * with `readyok` before treating the worker as dead. A worker that loaded
 * but never speaks UCI (wrong script, hung wasm init, etc.) would otherwise
 * leave every caller of `waitReady()`/`search()` hanging forever.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000

export class EngineClient {
  private readonly transport: EngineTransport
  private readonly readyPromise: Promise<void>
  private resolveReady: (() => void) | null = null
  private rejectReady: ((e: Error) => void) | null = null
  private pending: {
    resolve: (r: SearchResult) => void
    reject: (e: Error) => void
    lines: EngineInfo[]
  } | null = null

  /**
   * Set once a `CRITICAL ERROR` line is observed. Stockfish 19 terminates
   * its own process when this happens, so every operation that would await
   * a response from the worker must reject immediately afterwards instead
   * of posting to a process that will never answer again.
   */
  private deadReason: string | null = null

  /**
   * True while we are unwinding a superseded search: we sent `stop` (and an
   * `isready` right behind it) for the OLD search and are waiting for the
   * MATCHING `readyok` before starting the new one.
   *
   * This replaces an earlier counter-based scheme that tried to predict how
   * many `bestmove` replies a `stop` would produce. That assumption is
   * false: `stop` immediately followed by `go` is a known UCI anti-pattern,
   * and Stockfish may fold the abort into the new search and emit only ONE
   * `bestmove` — the new search's real result — which the counter would
   * then swallow as if it were the stale one, hanging the new promise
   * forever. An isready/readyok barrier does not depend on that count:
   * Stockfish processes commands strictly in order, so the `readyok` we
   * queued right after `stop` is only sent once the engine has fully
   * unwound the old search, however many (zero, one, or more) `bestmove`
   * lines that produced along the way. Every `bestmove` and `info` line
   * that arrives before that `readyok` is treated as belonging to the old
   * search and discarded; the new `go` is only sent once it arrives.
   */
  private awaitingBarrier = false

  /**
   * The limits for a `search()` call that supersedes one already in flight,
   * held back until `awaitingBarrier` clears. `null` whenever there is
   * nothing queued (either no search is pending, or the pending search's
   * `go` has already been sent to the engine).
   */
  private queuedLimits: SearchLimits | null = null

  /**
   * FIFO record of what each outstanding `isready` we've sent is FOR, so
   * that when a `readyok` comes back we route it to the right place instead
   * of guessing. This matters because `waitReady()`'s initial handshake and
   * a supersede barrier both ride on `isready`/`readyok`, and Stockfish may
   * not have answered the initial `isready` yet by the time a barrier opens
   * (a caller can call `search()` before ever awaiting `waitReady()`).
   * Since Stockfish answers commands strictly in the order it received
   * them, popping this queue in order always matches the right `readyok`
   * to the right purpose, regardless of which happens to arrive "first" in
   * wall-clock time relative to some other outstanding request.
   */
  private readonly readyokQueue: Array<'handshake' | 'barrier' | 'other'> = []

  /** Timer for the initial handshake; cleared once it succeeds, fails, or we dispose. */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

  /** Notified once, the first time this client transitions to dead, with the reason. */
  private deadListeners: Array<(reason: string) => void> = []

  constructor(transport: EngineTransport) {
    this.transport = transport
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // A caller who never calls waitReady() (e.g. one only using search())
    // must not turn a later dead-engine rejection into an unhandled-rejection
    // warning. This no-op subscriber doesn't stop waitReady()'s own callers
    // from observing the rejection themselves.
    this.readyPromise.catch(() => {})
    this.transport.onMessage((line) => this.handle(line))
    this.transport.onError((err) => {
      this.markDead(`worker error: ${describeTransportError(err)}`)
      this.failPendingWork(`engine worker failed: ${this.deadReason}`)
    })
    this.transport.post('uci')
    this.transport.post('isready')
    this.readyokQueue.push('handshake')

    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null
      if (this.deadReason !== null) return
      this.markDead('handshake timed out waiting for readyok')
      this.failPendingWork(`engine handshake timed out: ${this.deadReason}`)
    }, HANDSHAKE_TIMEOUT_MS)
  }

  /**
   * Record the fatal reason (once — later calls are no-ops so an error event
   * racing a CRITICAL ERROR line can't clobber the original cause) and tear
   * down everything that assumed the engine was still alive: no `readyok`
   * or further replies will ever arrive again.
   */
  private markDead(reason: string): void {
    if (this.deadReason !== null) return
    this.deadReason = reason
    this.awaitingBarrier = false
    this.queuedLimits = null
    this.readyokQueue.length = 0
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    for (const l of this.deadListeners) l(reason)
  }

  /** Reject whatever `search()`/`waitReady()` callers are currently waiting on. */
  private failPendingWork(pendingMessage: string): void {
    const p = this.pending
    this.pending = null
    p?.reject(new Error(pendingMessage))
    if (this.rejectReady) {
      this.rejectReady(this.deadClientError())
      this.resolveReady = null
      this.rejectReady = null
    }
  }

  /**
   * Subscribe to this client's death (from a CRITICAL ERROR line, a
   * transport error event, or a handshake timeout). Fires at most once,
   * with the reason. Returns an unsubscribe function.
   */
  onDead(cb: (reason: string) => void): () => void {
    this.deadListeners.push(cb)
    return () => {
      this.deadListeners = this.deadListeners.filter((l) => l !== cb)
    }
  }

  private handle(line: string): void {
    if (isCriticalError(line)) {
      // The worker is gone. Reject whatever is in flight right now with the
      // concrete cause (this is the "engine returned an illegal move" style
      // failure — the line itself carries Stockfish's own explanation), and
      // remember that the client is dead so every later call gets a
      // clearly different "engine died" message instead of hanging. No
      // `readyok` will ever arrive again, so a barrier left outstanding
      // must not keep anyone waiting on it.
      this.markDead(line)
      this.failPendingWork(`Stockfish crashed: ${line}`)
      return
    }

    if (line === 'readyok') {
      const kind = this.readyokQueue.shift()
      if (kind === 'handshake') {
        if (this.handshakeTimer !== null) {
          clearTimeout(this.handshakeTimer)
          this.handshakeTimer = null
        }
        this.resolveReady?.()
        this.resolveReady = null
        this.rejectReady = null
        return
      }
      if (kind === 'barrier') {
        // The engine has now fully unwound the superseded search — any
        // `bestmove`/`info` lines it still had in flight arrived before
        // this line, per UCI's strict command ordering. Safe to start the
        // queued search now, if the promise it belongs to hasn't itself
        // been superseded away in the meantime.
        this.awaitingBarrier = false
        if (this.pending && this.queuedLimits !== null) {
          const limits = this.queuedLimits
          this.queuedLimits = null
          this.sendGo(limits)
        }
        return
      }
      // 'other' (e.g. newGame()'s isready) or an unexpected extra readyok
      // with nothing queued: nothing to route it to.
      return
    }

    const best = parseBestMove(line)
    if (best) {
      if (this.awaitingBarrier) {
        // A reply from the search we are unwinding behind the barrier.
        // There may be zero, one, or several of these before the matching
        // `readyok` — none of them may resolve `pending`, which by now
        // belongs to the NEW search.
        return
      }
      const p = this.pending
      this.pending = null
      p?.resolve({ best: best.best, lines: p.lines })
      return
    }

    if (this.pending && !this.awaitingBarrier) {
      // Also gated on the barrier: `pending` is replaced synchronously the
      // moment a new search() supersedes the old one, but the old search
      // can still be emitting `info` lines for a bit afterwards. Without
      // this guard those stale lines would land in the NEW search's
      // `lines` array.
      const info = parseInfo(line)
      if (info) this.pending.lines.push(info)
    }
  }

  private sendGo(limits: SearchLimits): void {
    this.transport.post(`setoption name MultiPV value ${Math.max(1, limits.multiPv)}`)
    // Always pass an explicit limit: a bare `go` defaults to depth 245,
    // which never terminates in practice.
    this.transport.post(`go depth ${limits.depth} movetime ${limits.moveTimeMs}`)
  }

  /** Distinct from the crash-time message: this is for calls made *after* the engine is already known dead. */
  private deadClientError(): Error {
    return new Error(
      `engine is dead: it crashed earlier (${this.deadReason}); create a new EngineClient to continue`,
    )
  }

  waitReady(): Promise<void> {
    if (this.deadReason !== null) return Promise.reject(this.deadClientError())
    return this.readyPromise
  }

  configure(profile: StrengthProfile): void {
    this.transport.post(`setoption name MultiPV value ${Math.max(1, profile.blunderPool)}`)
    if (profile.uciElo !== null) {
      this.transport.post('setoption name UCI_LimitStrength value true')
      this.transport.post(`setoption name UCI_Elo value ${profile.uciElo}`)
    } else {
      this.transport.post('setoption name UCI_LimitStrength value false')
      this.transport.post(`setoption name Skill Level value ${profile.skillLevel}`)
    }
  }

  newGame(): void {
    this.transport.post('ucinewgame')
    this.transport.post('isready')
    this.readyokQueue.push('other')
  }

  /**
   * The caller must have validated the FEN and the moves already. Stockfish
   * 19 kills its own process on malformed input, which would silently take
   * the worker down mid-game.
   */
  setPosition(fen: string, moves: string[] = []): void {
    const suffix = moves.length > 0 ? ` moves ${moves.join(' ')}` : ''
    this.transport.post(`position fen ${fen}${suffix}`)
  }

  search(limits: SearchLimits): Promise<SearchResult> {
    if (this.deadReason !== null) return Promise.reject(this.deadClientError())

    if (this.pending) {
      // A search is already in flight (or itself still queued behind an
      // earlier barrier). Settle it now — as "superseded" — rather than
      // discarding its resolve/reject and leaving it pending forever.
      const old = this.pending
      this.pending = null
      old.reject(new Error('search superseded by a newer search() call'))

      if (this.queuedLimits === null) {
        // The old search's `go` was actually sent to the engine, so it is
        // really searching right now and must be stopped. See the
        // `awaitingBarrier` doc comment for why this is a barrier rather
        // than a counted swallow: `stop` immediately followed by `go` is a
        // known UCI anti-pattern, so we hold the new `go` back until the
        // engine confirms (via `readyok`) that it has finished unwinding
        // the old search.
        this.transport.post('stop')
        this.awaitingBarrier = true
        this.transport.post('isready')
        this.readyokQueue.push('barrier')
      }
      // else: the old search's `go` was never sent — it was itself still
      // queued behind a barrier that is still outstanding. There is
      // nothing new to stop, and that existing barrier's `readyok` will
      // still unblock whichever search ends up queued when it arrives.
    }

    return new Promise<SearchResult>((resolve, reject) => {
      this.pending = { resolve, reject, lines: [] }
      if (this.awaitingBarrier) {
        this.queuedLimits = limits
      } else {
        this.sendGo(limits)
      }
    })
  }

  stop(): void {
    this.transport.post('stop')
  }

  dispose(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    this.pending?.reject(new Error('engine disposed'))
    this.pending = null
    this.awaitingBarrier = false
    this.queuedLimits = null
    this.readyokQueue.length = 0
    this.transport.post('quit')
    this.transport.terminate()
  }
}
