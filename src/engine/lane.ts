import { profileFor, type StrengthProfile } from './strength'
import type { EngineInfo } from './uci'

/** The engine surface the lane drives. Structurally a subset of EngineClient. */
export interface LaneEngine {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves: string[]): void
  search(limits: { depth: number; moveTimeMs: number; multiPv: number }): Promise<{
    best: string
    lines: readonly EngineInfo[]
  }>
  stop(): void
}

export interface AnalysisRequest {
  fen: string
  depth: number
  moveTimeMs: number
  multiPv?: number
}

export interface SearchOutcome {
  best: string
  lines: readonly EngineInfo[]
}

export class AnalysisAborted extends Error {
  constructor() {
    super('analysis aborted')
    this.name = 'AnalysisAborted'
  }
}

export class StaleRequest extends Error {
  constructor() {
    super('engine request went stale before it started')
    this.name = 'StaleRequest'
  }
}

interface Job {
  req: AnalysisRequest
  resolve: (r: SearchOutcome) => void
  reject: (e: Error) => void
  signal: AbortSignal | undefined
}

/** Full strength for every analysis; set on each run because moves reconfigure. */
const ANALYSIS_PROFILE = profileFor(8)

/**
 * The single scheduler in front of the single Stockfish worker.
 * See Task 3 of the Phase 2 plan for the rules; in short: moves pre-empt
 * analysis, analysis waits for moves, and nothing else talks to the engine.
 */
export class EngineLane {
  private readonly engine: LaneEngine
  private movesInFlight = 0
  private running: { job: Job; token: number } | null = null
  private queue: Job[] = []
  private token = 0
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(engine: LaneEngine) {
    this.engine = engine
  }

  async move(
    req: { profile: StrengthProfile; fen: string; limits: { depth: number; moveTimeMs: number; multiPv: number } },
    isCurrent: () => boolean,
  ): Promise<SearchOutcome> {
    this.preemptAnalysis()
    this.movesInFlight++
    try {
      await this.engine.waitReady()
      if (!isCurrent()) throw new StaleRequest()
      this.engine.configure(req.profile)
      this.engine.setPosition(req.fen, [])
      return await this.engine.search(req.limits)
    } finally {
      this.movesInFlight--
      this.schedulePump()
    }
  }

  analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome> {
    if (this.disposed) return Promise.reject(new Error('engine lane disposed'))
    if (signal?.aborted) return Promise.reject(new AnalysisAborted())
    return new Promise<SearchOutcome>((resolve, reject) => {
      const onAbort = () => this.abortJob(job)
      // Settling detaches the listener, so a long-lived signal never pins a finished job.
      const job: Job = {
        req,
        resolve: (r) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(r)
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort)
          reject(e)
        },
        signal,
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(job)
      this.schedulePump()
    })
  }

  newGame(): void {
    this.preemptAnalysis()
    this.engine.newGame()
  }

  dispose(): void {
    this.disposed = true
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer)
    const err = new Error('engine lane disposed')
    this.running?.job.reject(err)
    this.running = null
    for (const job of this.queue) job.reject(err)
    this.queue = []
  }

  /** Stop the running analysis (if any) and put it back at the front of the queue. */
  private preemptAnalysis(): void {
    const running = this.running
    if (!running) return
    this.running = null // invalidates its token: its eventual reply is ignored
    this.engine.stop()
    this.queue.unshift(running.job)
    // For move(): movesInFlight is incremented synchronously right after this,
    // so the pump will wait. For newGame(): nothing else would wake the queue.
    this.schedulePump()
  }

  private abortJob(job: Job): void {
    const queued = this.queue.indexOf(job)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      job.reject(new AnalysisAborted())
      return
    }
    if (this.running?.job === job) {
      this.running = null
      this.engine.stop()
      job.reject(new AnalysisAborted())
      this.schedulePump()
    }
  }

  /** A macrotask, so a move requested in the same turn of the event loop goes first. */
  private schedulePump(): void {
    if (this.disposed || this.pumpTimer !== null) return
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null
      this.pump()
    }, 0)
  }

  private pump(): void {
    if (this.disposed || this.movesInFlight > 0 || this.running) return
    const job = this.queue.shift()
    if (!job) return
    const token = ++this.token
    this.running = { job, token }
    const isMine = () => this.running?.token === token

    void (async () => {
      try {
        await this.engine.waitReady()
        if (!isMine()) return
        this.engine.configure(ANALYSIS_PROFILE)
        this.engine.setPosition(job.req.fen, [])
        const out = await this.engine.search({
          depth: job.req.depth,
          moveTimeMs: job.req.moveTimeMs,
          multiPv: job.req.multiPv ?? 1,
        })
        if (!isMine()) return // pre-empted (re-queued) or aborted (already rejected)
        this.running = null
        job.resolve(out)
      } catch (err) {
        if (!isMine()) return
        this.running = null
        job.reject(err instanceof Error ? err : new Error(String(err)))
      } finally {
        this.schedulePump()
      }
    })()
  }
}
