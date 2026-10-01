/**
 * Stockfish in Node for the trial: fallback moves, adjudication and the
 * report's analysis. The `stockfish` npm package's lite single-threaded WASM
 * build, loaded the way the jev-chess spike did, with two fixes:
 *
 * - The engine script nulls the global `fetch` when it loads (so Emscripten
 *   reads the .wasm from disk). Every provider client here uses `fetch`, so it
 *   is captured before each load and put back right after.
 * - The package's `initEngine` can load only one engine per process (its
 *   `require` of the engine script is cached and the script replaces its own
 *   export), so each instance re-requires the script fresh.
 *
 * One instance runs one search at a time; its commands are queued. Give each
 * concurrent game its own instance (see EnginePool). Never send `quit`: the
 * script calls process.exit on it.
 */
import { createRequire } from 'node:module'
import { profileFor } from '../../src/engine/strength'
import { CLAUDE_FALLBACK_LEVEL } from '../../src/match/claudeFallback'
import type { Score } from './types'

export interface TrialEngine {
  /** Score (side to move) and best move (UCI) of `fen` at a fixed depth. */
  evaluate(fen: string, depth: number): Promise<{ score: Score; best: string | null }>
  /** The app's fallback move for a failed model turn: CLAUDE_FALLBACK_LEVEL's depth and time. */
  fallbackMove(fen: string): Promise<string | null>
}

interface RawEngine {
  listener?: (line: string) => void
  ccall(name: string, ret: null, types: string[], args: string[], opts: { async: boolean }): void
  _isReady?: () => boolean
}

const require = createRequire(import.meta.url)
const ENGINE_JS = require.resolve('stockfish/bin/stockfish-19-lite-single.js')
const ENGINE_WASM = ENGINE_JS.replace(/\.js$/, '.wasm')

/** The score of the last `info ... score` line of a search (MultiPV 1). */
export function parseScore(lines: readonly string[]): Score | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = / score (cp|mate) (-?\d+)/.exec(lines[i]!)
    if (m && lines[i]!.startsWith('info')) return m[1] === 'cp' ? { cp: Number(m[2]) } : { mate: Number(m[2]) }
  }
  return null
}

/** The move of a `bestmove` line, or null for `(none)`. */
export function parseBest(line: string | undefined): string | null {
  const best = line?.split(/\s+/)[1]
  return best && best !== '(none)' ? best : null
}

async function loadRaw(): Promise<RawEngine> {
  const savedFetch = globalThis.fetch
  try {
    delete require.cache[ENGINE_JS]
    const factory = require(ENGINE_JS) as () => (m: object) => Promise<unknown>
    // A listener from the start, so the engine's banner is not printed to the console.
    const engine = {
      locateFile: (f: string) => (f.includes('.wasm') ? ENGINE_WASM : ENGINE_JS),
      listener: () => {},
    } as unknown as RawEngine
    await factory()(engine)
    while (engine._isReady && !engine._isReady()) await new Promise((r) => setTimeout(r, 10))
    return engine
  } finally {
    globalThis.fetch = savedFetch
  }
}

export async function createEngine(): Promise<TrialEngine> {
  const raw = await loadRaw()
  let lines: string[] = []
  let waiter: { done: (l: string) => boolean; resolve: (out: string[]) => void } | null = null
  raw.listener = (line) => {
    lines.push(line)
    if (waiter?.done(line)) {
      const w = waiter
      waiter = null
      const out = lines
      lines = []
      w.resolve(out)
    }
  }
  const send = (cmd: string) => setImmediate(() => raw.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) }))
  const until = (done: (l: string) => boolean, cmds: string[]) =>
    new Promise<string[]>((resolve) => {
      lines = []
      waiter = { done, resolve }
      for (const c of cmds) send(c)
    })

  // One search at a time per instance.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job)
    queue = run.catch(() => undefined)
    return run
  }

  await until((l) => l === 'uciok', ['uci'])
  await until((l) => l === 'readyok', [
    'setoption name UCI_LimitStrength value false',
    'setoption name Skill Level value 20',
    'setoption name MultiPV value 1',
    'isready',
  ])

  const search = (fen: string, go: string) =>
    serial(async () => {
      const out = await until((l) => l.startsWith('bestmove'), [`position fen ${fen}`, go])
      return { score: parseScore(out), best: parseBest(out.at(-1)) }
    })

  const fallback = profileFor(CLAUDE_FALLBACK_LEVEL)
  return {
    async evaluate(fen, depth) {
      const r = await search(fen, `go depth ${depth}`)
      return { score: r.score ?? { cp: 0 }, best: r.best }
    },
    async fallbackMove(fen) {
      return (await search(fen, `go depth ${fallback.depth} movetime ${fallback.moveTimeMs}`)).best
    },
  }
}

/**
 * Engines for concurrent games, made on first use and reused: one instance
 * per game in play at once, never shared between two of them.
 */
export class EnginePool {
  private free: TrialEngine[] = []
  constructor(private readonly make: () => Promise<TrialEngine> = createEngine) {}

  async acquire(): Promise<TrialEngine> {
    return this.free.pop() ?? (await this.make())
  }

  release(engine: TrialEngine): void {
    this.free.push(engine)
  }
}
