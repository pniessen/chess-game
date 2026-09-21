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

/**
 * Slack on top of a search's own `movetime` before a missing `bestmove` is
 * treated as a dead engine. Every `go` we send carries an explicit
 * `movetime`, and Stockfish stops at whichever of depth/movetime comes
 * first, so `movetime` is an upper bound on a healthy search; the grace
 * covers a slow first search, a busy main thread, and throttled timers.
 */
export const BESTMOVE_GRACE_MS = 5_000

export class EngineClient {
  private readonly transport: EngineTransport
  private readonly readyPromise: Promise<void>
  private resolveReady: (() => void) | null = null
  private rejectReady: ((e: Error) => void) | null = null
  /**
   * The caller currently waiting on `search()`. `goSent` is false while its
   * `go` is still held back behind an earlier search's `bestmove` (see
   * `goOutstanding`); `limits` is what to send once it is released.
   */
  private pending: {
    resolve: (r: SearchResult) => void
    reject: (e: Error) => void
    lines: EngineInfo[]
    limits: SearchLimits
    goSent: boolean
  } | null = null

  /**
   * Set once a `CRITICAL ERROR` line is observed. Stockfish 19 terminates
   * its own process when this happens, so every operation that would await
   * a response from the worker must reject immediately afterwards instead
   * of posting to a process that will never answer again.
   */
  private deadReason: string | null = null

  /**
   * True from the moment a `go` is posted until ITS `bestmove` arrives.
   *
   * UCI guarantees exactly one `bestmove` per `go`, including a `go` that
   * was cut short by `stop` (probed on the bundled lite-single build: always
   * exactly one, and a `stop` on an idle engine produces none). So the
   * client never has more than one `go` on the wire: a `search()` that
   * supersedes a running search posts `stop` and holds its own `go` until
   * the stopped search's `bestmove` has arrived. That `bestmove` is then
   * unambiguous: it answers the one outstanding `go`, and is discarded
   * because its caller has already been rejected as superseded.
   *
   * History: Phase 1 first counted "stale bestmoves to ignore" but posted
   * the new `go` right behind `stop`, so two `go`s were on the wire at once
   * and the count was only right if the engine never folded `stop` + `go`
   * into a single `bestmove` (the reason it was dropped; probing found no
   * such folding, `stop` + `go` always produced two). Phase 1 then
   * replaced it with an `isready`/`readyok` barrier, which assumed
   * `readyok` is only sent after the stopped search's `bestmove`. Stockfish
   * does not guarantee that: it answers `isready` while the search is still
   * unwinding, and `readyok` was observed BEFORE the stopped search's
   * `bestmove`. The barrier then released the new `go` early and the stale
   * `bestmove` resolved it, leaving every later search one reply behind.
   * Waiting on the `bestmove` itself depends on neither assumption.
   */
  private goOutstanding = false

  /**
   * FIFO record of what each outstanding `isready` we've sent is FOR, so
   * that when a `readyok` comes back we route it to the right place instead
   * of guessing: the initial handshake (which `waitReady()` exposes) versus
   * `newGame()`'s own `isready`. Search sequencing no longer uses
   * `isready` at all (see `goOutstanding`).
   */
  private readonly readyokQueue: Array<'handshake' | 'other'> = []

  /** Timer for the initial handshake; cleared once it succeeds, fails, or we dispose. */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Watchdog for the one outstanding `go` (see `goOutstanding`): armed when
   * a `go` is posted, cleared when its `bestmove` arrives, on death, and on
   * dispose. If it fires, the `bestmove` was lost and the engine would
   * otherwise stay wedged forever with every later `go` held back.
   */
  private bestmoveTimer: ReturnType<typeof setTimeout> | null = null

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
    this.goOutstanding = false
    this.clearBestmoveTimer()
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
      // `bestmove` will ever arrive again, so a search whose `go` is held
      // back behind a stopped search must not keep anyone waiting on it.
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
      // 'other' (e.g. newGame()'s isready) or an unexpected extra readyok
      // with nothing queued: nothing to route it to.
      return
    }

    const best = parseBestMove(line)
    if (best) {
      if (!this.goOutstanding) return // no `go` of ours is unanswered: stray line
      this.goOutstanding = false
      this.clearBestmoveTimer()
      const p = this.pending
      if (p && p.goSent) {
        // The answer to the pending caller's own `go`.
        this.pending = null
        p.resolve({ best: best.best, lines: p.lines })
        return
      }
      // The answer to a search that was superseded (its caller has already
      // been rejected). Discard it; the engine is idle now, so release the
      // held-back `go` of whichever search is current, if any.
      if (p) this.sendGo(p)
      return
    }

    if (this.pending?.goSent) {
      // Only while the pending caller's own `go` is the one running: while
      // its `go` is still held back, `info` lines belong to the superseded
      // search that is unwinding.
      const info = parseInfo(line)
      if (info) this.pending.lines.push(info)
    }
  }

  private sendGo(p: NonNullable<EngineClient['pending']>): void {
    const { limits } = p
    p.goSent = true
    this.goOutstanding = true
    this.transport.post(`setoption name MultiPV value ${Math.max(1, limits.multiPv)}`)
    // Always pass an explicit limit: a bare `go` defaults to depth 245,
    // which never terminates in practice.
    this.transport.post(`go depth ${limits.depth} movetime ${limits.moveTimeMs}`)
    this.armBestmoveTimer(limits.moveTimeMs + BESTMOVE_GRACE_MS)
  }

  private armBestmoveTimer(ms: number): void {
    this.clearBestmoveTimer()
    this.bestmoveTimer = setTimeout(() => {
      this.bestmoveTimer = null
      if (this.deadReason !== null || !this.goOutstanding) return
      this.markDead(`bestmove never arrived within ${ms} ms`)
      this.failPendingWork(`engine stopped responding: ${this.deadReason}`)
    }, ms)
  }

  private clearBestmoveTimer(): void {
    if (this.bestmoveTimer !== null) {
      clearTimeout(this.bestmoveTimer)
      this.bestmoveTimer = null
    }
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

    const old = this.pending
    if (old) {
      // A search is already in flight (or itself still held back). Settle it
      // now — as "superseded" — rather than discarding its resolve/reject
      // and leaving it pending forever.
      this.pending = null
      old.reject(new Error('search superseded by a newer search() call'))
    }
    if (this.goOutstanding && (old === null || old.goSent)) {
      // The engine is running a search nobody wants any more. Tell it to
      // stop (harmless if the caller already did), then hold this search's
      // `go` until that search's `bestmove` arrives; see `goOutstanding` for
      // why that, and not `readyok`, is the signal. If `old` was itself
      // held back, the running search was already stopped when `old`
      // superseded it, and its `bestmove` will release this search instead.
      this.transport.post('stop')
    }

    return new Promise<SearchResult>((resolve, reject) => {
      const p = { resolve, reject, lines: [] as EngineInfo[], limits, goSent: false }
      this.pending = p
      if (!this.goOutstanding) this.sendGo(p)
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
    this.goOutstanding = false
    this.clearBestmoveTimer()
    this.readyokQueue.length = 0
    this.transport.post('quit')
    this.transport.terminate()
  }
}
