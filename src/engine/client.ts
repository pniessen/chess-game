import type { StrengthProfile } from './strength'
import { isCriticalError, parseBestMove, parseInfo, type EngineInfo } from './uci'

export interface EngineTransport {
  post(cmd: string): void
  onMessage(cb: (line: string) => void): void
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
    terminate: () => worker.terminate(),
  }
}

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
   * Number of upcoming `bestmove` lines that belong to a search we already
   * gave up on (because a newer `search()` call superseded it and sent
   * `stop`). Stockfish still replies to `stop` with exactly one `bestmove`
   * for the search it was told to abandon, and that reply can arrive after
   * we have already started the next search — see `search()`.
   */
  private staleBestMovesToIgnore = 0

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
    this.transport.post('uci')
    this.transport.post('isready')
  }

  private handle(line: string): void {
    if (isCriticalError(line)) {
      // The worker is gone. Reject whatever is in flight right now with the
      // concrete cause (this is the "engine returned an illegal move" style
      // failure — the line itself carries Stockfish's own explanation), and
      // remember that the client is dead so every later call gets a
      // clearly different "engine died" message instead of hanging.
      this.deadReason = line
      this.staleBestMovesToIgnore = 0
      const p = this.pending
      this.pending = null
      p?.reject(new Error(`Stockfish crashed: ${line}`))
      if (this.rejectReady) {
        this.rejectReady(this.deadClientError())
        this.resolveReady = null
        this.rejectReady = null
      }
      return
    }

    if (line === 'readyok') {
      this.resolveReady?.()
      this.resolveReady = null
      this.rejectReady = null
      return
    }

    const best = parseBestMove(line)
    if (best) {
      if (this.staleBestMovesToIgnore > 0) {
        // This bestmove answers a `stop` we sent for a search we already
        // gave up on. It must not be allowed to resolve whatever search is
        // pending now (that would silently hand back a stale move).
        this.staleBestMovesToIgnore -= 1
        return
      }
      const p = this.pending
      this.pending = null
      p?.resolve({ best: best.best, lines: p.lines })
      return
    }

    if (this.pending) {
      const info = parseInfo(line)
      if (info) this.pending.lines.push(info)
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
      // A search is already in flight. Settle it now — as "superseded" —
      // rather than discarding its resolve/reject and leaving it pending
      // forever, and tell the engine to abandon it so it stops burning CPU
      // on a result nobody will read.
      //
      // Stockfish answers `stop` with exactly one `bestmove` for the search
      // being abandoned, and that reply can arrive after `this.pending` has
      // already been replaced by the new search below. `staleBestMovesToIgnore`
      // tells `handle()` to swallow that one late `bestmove` instead of
      // resolving the new promise with the old (wrong) move.
      this.staleBestMovesToIgnore += 1
      const old = this.pending
      this.pending = null
      old.reject(new Error('search superseded by a newer search() call'))
      this.transport.post('stop')
    }

    return new Promise<SearchResult>((resolve, reject) => {
      this.pending = { resolve, reject, lines: [] }
      this.transport.post(`setoption name MultiPV value ${Math.max(1, limits.multiPv)}`)
      // Always pass an explicit limit: a bare `go` defaults to depth 245,
      // which never terminates in practice.
      this.transport.post(`go depth ${limits.depth} movetime ${limits.moveTimeMs}`)
    })
  }

  stop(): void {
    this.transport.post('stop')
  }

  dispose(): void {
    this.pending?.reject(new Error('engine disposed'))
    this.pending = null
    this.transport.post('quit')
    this.transport.terminate()
  }
}
