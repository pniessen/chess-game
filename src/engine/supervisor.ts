import type { StrengthProfile } from './strength'
import type { SearchLimits, SearchResult } from './client'

/** The EngineClient surface the supervisor drives (EngineClient satisfies it). */
export interface SupervisedClient {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves?: string[]): void
  search(limits: SearchLimits): Promise<SearchResult>
  stop(): void
  dispose(): void
  onDead(cb: (reason: string) => void): () => void
}

/**
 * `ok`: the current worker is alive (or still loading for the first time).
 * `restarting`: the previous worker died and its replacement is handshaking.
 * `dead`: the restart budget is spent (or a replacement could not be built);
 * AI modes degrade exactly as before recovery existed.
 */
export type EngineHealth =
  | { kind: 'ok' }
  | { kind: 'restarting'; reason: string }
  | { kind: 'dead'; reason: string }

/** Automatic restarts allowed inside any RESTART_WINDOW_MS. */
export const MAX_RESTARTS = 2
export const RESTART_WINDOW_MS = 5 * 60_000

/**
 * Owns the ONE Stockfish worker and replaces it when it dies.
 *
 * It stands in for the EngineClient everywhere (MatchController and its
 * EngineLane only ever see this object), delegating to whichever client is
 * current. When that client dies — a worker `error` event, a handshake
 * timeout, the bestmove watchdog, or a CRITICAL ERROR line — the supervisor
 * synchronously disposes it (terminating its worker) and only then builds
 * the replacement, so there is never more than one live worker, not even
 * for a tick. `generation()` is bumped at the swap; EngineLane uses it to
 * re-run a game move that failed across a replacement (analysis just
 * fails, as it always has). The dead client's pending work is rejected
 * before the swap, and a disposed client never resolves anything again, so
 * a reply from the dead worker cannot reach the game.
 */
export class EngineSupervisor {
  private readonly createClient: () => SupervisedClient
  private readonly now: () => number
  private readonly warn: (msg: string) => void
  private client: SupervisedClient
  private gen = 0
  private restartTimes: number[] = []
  private state: EngineHealth = { kind: 'ok' }
  private listeners: Array<(h: EngineHealth) => void> = []
  private disposed = false

  constructor(opts: {
    /** Builds a client with a fresh worker. May throw (no `Worker` global). */
    createClient: () => SupervisedClient
    /** Injectable clock for the restart cap. */
    now?: () => number
    warn?: (msg: string) => void
  }) {
    this.createClient = opts.createClient
    this.now = opts.now ?? Date.now
    this.warn = opts.warn ?? ((msg) => console.warn(msg))
    // A synchronous failure here propagates: the caller falls back to its stub.
    this.client = this.createClient()
    this.watch(this.client)
  }

  health(): EngineHealth {
    return this.state
  }

  onHealth(cb: (h: EngineHealth) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  generation(): number {
    return this.gen
  }

  private setHealth(h: EngineHealth): void {
    this.state = h
    for (const l of [...this.listeners]) l(h)
  }

  private watch(client: SupervisedClient): void {
    client.onDead((reason) => this.handleDeath(client, reason))
  }

  private handleDeath(client: SupervisedClient, reason: string): void {
    if (this.disposed || client !== this.client) return
    // Terminate the dead worker first: the replacement below must never
    // coexist with it.
    client.dispose()

    const t = this.now()
    this.restartTimes = this.restartTimes.filter((at) => t - at < RESTART_WINDOW_MS)
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.setHealth({ kind: 'dead', reason })
      return
    }

    let next: SupervisedClient
    try {
      next = this.createClient()
    } catch {
      this.setHealth({ kind: 'dead', reason })
      return
    }
    this.restartTimes.push(t)
    this.client = next
    this.gen++
    this.watch(next)
    this.setHealth({ kind: 'restarting', reason })
    next.waitReady().then(
      () => {
        if (this.disposed || this.client !== next) return
        this.warn(`Stockfish engine restarted after: ${reason}`)
        this.setHealth({ kind: 'ok' })
      },
      // A replacement that dies is handled by its own onDead above.
      () => {},
    )
  }

  // ---- the EngineClient surface, delegated to the current client ---------

  waitReady(): Promise<void> {
    return this.client.waitReady()
  }

  configure(profile: StrengthProfile): void {
    this.client.configure(profile)
  }

  newGame(): void {
    this.client.newGame()
  }

  setPosition(fen: string, moves: string[] = []): void {
    this.client.setPosition(fen, moves)
  }

  search(limits: SearchLimits): Promise<SearchResult> {
    return this.client.search(limits)
  }

  stop(): void {
    this.client.stop()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.listeners = []
    this.client.dispose()
  }
}
