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
  private pending: {
    resolve: (r: SearchResult) => void
    reject: (e: Error) => void
    lines: EngineInfo[]
  } | null = null

  constructor(transport: EngineTransport) {
    this.transport = transport
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })
    this.transport.onMessage((line) => this.handle(line))
    this.transport.post('uci')
    this.transport.post('isready')
  }

  private handle(line: string): void {
    if (isCriticalError(line)) {
      const p = this.pending
      this.pending = null
      p?.reject(new Error(`engine critical error: ${line}`))
      return
    }

    if (line === 'readyok') {
      this.resolveReady?.()
      this.resolveReady = null
      return
    }

    const best = parseBestMove(line)
    if (best) {
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

  waitReady(): Promise<void> {
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
