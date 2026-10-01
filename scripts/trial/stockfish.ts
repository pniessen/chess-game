/**
 * Stockfish in Node for the trial: fallback moves, adjudication and the
 * report's analysis. The `stockfish` npm package's lite single-threaded WASM
 * build, loaded the way the jev-chess spike did, with two fixes:
 *
 * - The engine script nulls the global `fetch` when it loads (so Emscripten
 *   reads the .wasm from disk). Every provider client here uses `fetch`, so
 *   the real one is captured when this module loads, loads run one at a time,
 *   and each puts it back. The trial also warms its engines before any game
 *   starts, and hands the provider clients fetch explicitly.
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

/** The real fetch, taken when this module loads, before any engine script can null it. */
const REAL_FETCH = globalThis.fetch

/** Loads run one at a time: the engine script nulls `fetch` while it loads, and two overlapping loads would keep it null. */
let loading: Promise<unknown> = Promise.resolve()

/** How long one command may go unanswered before the engine is given up on. */
export const ENGINE_TIMEOUT_MS = 120_000

function loadRaw(): Promise<RawEngine> {
  const run = loading.then(loadRawNow, loadRawNow)
  loading = run.catch(() => undefined)
  return run
}

async function loadRawNow(): Promise<RawEngine> {
  const before = {
    uncaughtException: new Set(process.listeners('uncaughtException')),
    unhandledRejection: new Set(process.listeners('unhandledRejection')),
  }
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
    globalThis.fetch = REAL_FETCH
    // The script registers process-wide handlers that rethrow any uncaught error or unhandled
    // rejection (Emscripten's exit handling). They would turn one stray rejection anywhere into a
    // crash of the whole trial, and pile up a pair per engine: take them off again.
    for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
      for (const l of process.listeners(event)) if (!before[event].has(l)) process.removeListener(event, l as (...args: unknown[]) => void)
    }
  }
}

export async function createEngine(): Promise<TrialEngine> {
  const raw = await loadRaw()
  let lines: string[] = []
  let broken: Error | null = null
  let waiter: { done: (l: string) => boolean; resolve: (out: string[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null =
    null
  const fail = (e: Error) => {
    broken ??= e
    const w = waiter
    waiter = null
    if (w) {
      clearTimeout(w.timer)
      w.reject(e)
    }
  }
  raw.listener = (line) => {
    lines.push(line)
    if (waiter?.done(line)) {
      const w = waiter
      waiter = null
      clearTimeout(w.timer)
      const out = lines
      lines = []
      w.resolve(out)
    }
  }
  const send = (cmd: string) =>
    setImmediate(() => {
      try {
        raw.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) })
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      }
    })
  // A command that never answers (a WASM abort, a lost bestmove) rejects after ENGINE_TIMEOUT_MS,
  // and the instance is not used again.
  const until = (done: (l: string) => boolean, cmds: string[]) =>
    new Promise<string[]>((resolve, reject) => {
      if (broken) return reject(broken)
      lines = []
      const timer = setTimeout(() => fail(new Error(`Stockfish did not answer within ${ENGINE_TIMEOUT_MS / 1000}s`)), ENGINE_TIMEOUT_MS)
      waiter = { done, resolve, reject, timer }
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
      // No score would quietly read as level (a draw at adjudication): fail the game instead.
      if (!r.score) throw new Error('Stockfish gave no score')
      return { score: r.score, best: r.best }
    },
    async fallbackMove(fen) {
      return (await search(fen, `go depth ${fallback.depth} movetime ${fallback.moveTimeMs}`)).best
    },
  }
}

/**
 * Engines for concurrent games, made on first use (or by `warm`) and reused:
 * one instance per game in play at once, never shared between two of them.
 * The runner does not release the engine of a game that crashed, so a broken
 * instance is never reused.
 */
export class EnginePool {
  private free: TrialEngine[] = []
  constructor(private readonly make: () => Promise<TrialEngine> = createEngine) {}

  /** Make `n` engines up front, so no engine script loads (and nulls fetch) while games are calling APIs. */
  async warm(n: number): Promise<void> {
    for (let i = this.free.length; i < n; i++) this.free.push(await this.make())
  }

  async acquire(): Promise<TrialEngine> {
    return this.free.pop() ?? (await this.make())
  }

  release(engine: TrialEngine): void {
    this.free.push(engine)
  }
}
