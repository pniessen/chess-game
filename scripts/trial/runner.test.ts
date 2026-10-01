// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeModelKey } from '../../src/claude/models'
import { Position } from '../../src/game-core/position'
import type { MoveRequest } from '../../server/moveDispatch'
import { readLedger } from './budget'
import { runTrial, type RunDeps, type RunOptions } from './runner'
import { gameFile, readJson } from './store'
import type { GameSpec } from './schedule'
import type { TrialEngine } from './stockfish'

const engine: TrialEngine = {
  evaluate: async () => ({ score: { cp: 0 }, best: null }),
  fallbackMove: async () => null,
}

/** A model that plays its first legal move after a tick, at `cost` a call; tracks how many games each model is in at once. */
function fakeMoves(cost = 0.001) {
  const active = new Map<string, number>()
  const maxActive = new Map<string, number>()
  let calls = 0
  let concurrentGames = 0
  let maxConcurrentGames = 0
  const inGame = new Map<string, number>()
  const move = async (req: MoveRequest) => {
    calls++
    const key = req.model
    active.set(key, (active.get(key) ?? 0) + 1)
    maxActive.set(key, Math.max(maxActive.get(key) ?? 0, active.get(key)!))
    await new Promise((r) => setTimeout(r, 1))
    active.set(key, active.get(key)! - 1)
    const pos = new Position()
    for (const s of req.history) pos.trySan(s)
    return {
      outcome: { ok: true as const, san: pos.legalSans()[0]!, why: 'First.', costUsd: cost, ms: 5, tokens: { inputTokens: 10, outputTokens: 1 } },
    }
  }
  return {
    move,
    get calls() {
      return calls
    },
    maxActive,
    inGame,
    get maxConcurrentGames() {
      return maxConcurrentGames
    },
    /** Most games each model was in at once. */
    maxGamesPerModel: new Map<string, number>(),
    gameStarted(spec: GameSpec) {
      concurrentGames++
      maxConcurrentGames = Math.max(maxConcurrentGames, concurrentGames)
      for (const m of [spec.white, spec.black]) {
        inGame.set(m, (inGame.get(m) ?? 0) + 1)
        this.maxGamesPerModel.set(m, Math.max(this.maxGamesPerModel.get(m) ?? 0, inGame.get(m)!))
      }
    },
    gameEnded(spec: GameSpec) {
      concurrentGames--
      for (const m of [spec.white, spec.black]) inGame.set(m, inGame.get(m)! - 1)
    },
  }
}

async function setup(over: Partial<RunOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'trial-run-'))
  const opts: RunOptions = {
    trialId: 'test-1',
    dir: join(root, 'test-1'),
    models: ['haiku', 'jev', 'gemini-flash'],
    gamesPerPair: 1,
    capUsd: 1,
    maxPlies: 6,
    concurrency: 3,
    ...over,
  }
  return { root, opts }
}

function deps(f: ReturnType<typeof fakeMoves>): RunDeps {
  return {
    move: f.move,
    engines: { acquire: async () => engine, release: () => {} },
    sleep: async () => {},
    log: () => {},
    onGameStart: (spec) => f.gameStarted(spec),
    onGameEnd: (spec) => f.gameEnded(spec),
  }
}

describe('runTrial', () => {
  test('plays every game once, saves each atomically, and charges its own ledger', async () => {
    const { root, opts } = await setup()
    const f = fakeMoves()
    const s = await runTrial(opts, deps(f))
    expect(s).toMatchObject({ state: 'done', played: 3, skipped: 0, total: 3 })
    expect(f.calls).toBe(18)
    // One file per game, named by its schedule id, and no temp files left behind.
    const files = (await readdir(join(opts.dir, 'games'))).sort()
    expect(files).toEqual(['haiku-gemini-flash-1.json', 'haiku-jev-1.json', 'jev-gemini-flash-1.json'])
    const ledger = await readLedger(opts.dir)
    expect(ledger.entries).toHaveLength(18)
    expect(ledger.entries.every((e) => e.kind === 'move' && e.outcome === 'ok')).toBe(true)
    expect(ledger.spentUsd).toBeCloseTo(0.018)
    expect(ledger.moveUsd).toBeCloseTo(0.018)
    const progress = await readJson<{ state: string; finished: number; spentUsd: number }>(join(opts.dir, 'progress.json'))
    expect(progress).toMatchObject({ state: 'done', finished: 3 })
    await rm(root, { recursive: true })
  })

  test('resume: a restart with the same id skips finished games and recomputes spend from the ledger', async () => {
    const { root, opts } = await setup()
    await runTrial(opts, deps(fakeMoves()))
    const again = fakeMoves()
    const s = await runTrial(opts, deps(again))
    expect(again.calls).toBe(0)
    expect(s).toMatchObject({ state: 'done', played: 0, skipped: 3 })
    expect(s.spentUsd).toBeCloseTo(0.018)

    // A game lost in a crash (its file never written) is played again; its earlier calls stay spent.
    await rm(gameFile(opts.dir, 'haiku-jev-1'))
    const third = fakeMoves()
    const s3 = await runTrial(opts, deps(third))
    expect(third.calls).toBe(6)
    expect(s3).toMatchObject({ played: 1, skipped: 2 })
    expect(s3.spentUsd).toBeCloseTo(0.024)
    await rm(root, { recursive: true })
  })

  test('resume: earlier spend counts toward the cap before the next game starts', async () => {
    // Stop after the first game starts, so one of the two is played.
    const { root, opts } = await setup({ models: ['haiku', 'jev'], gamesPerPair: 2, capUsd: 1 })
    const stop = { stopped: false }
    const first = fakeMoves(0.01)
    const d1 = { ...deps(first), stop, onGameStart: () => (stop.stopped = true) }
    expect(await runTrial(opts, d1)).toMatchObject({ state: 'stopped', played: 1 })
    // $0.06 spent + $0.16 held for the next game is over a $0.20 cap: it must not start.
    const second = fakeMoves(0.01)
    const s = await runTrial({ ...opts, capUsd: 0.2 }, deps(second))
    expect(second.calls).toBe(0)
    expect(s).toMatchObject({ state: 'blocked-by-cap', played: 0, skipped: 1 })
    await rm(root, { recursive: true })
  })

  test('the hard cap holds across concurrent games: calls in flight count against it until charged', async () => {
    // Two disjoint games at once ((haiku, gemini-flash) and (jev, gemini-pro), $0.82 held), every
    // call charged its full worst case, and a barrier that lets calls through only in pairs, one
    // from each game, so both games always check the cap against the same spend. Without counting
    // the calls in flight, some cap in this range lets both through when only one fits.
    const { worstCaseCallUsd } = await import('../../server/moveDispatch')
    for (let cap = 0.83; cap <= 1.0; cap += 0.01) {
      const { root, opts } = await setup({ models: ['haiku', 'jev', 'gemini-pro', 'gemini-flash'], gamesPerPair: 1, capUsd: cap, maxPlies: 160 })
      let waiting: Array<() => void> = []
      const move = async (req: MoveRequest) => {
        await new Promise<void>((resolve) => {
          waiting.push(resolve)
          if (waiting.length === 2) {
            for (const r of waiting) r()
            waiting = []
          } else setTimeout(resolve, 20) // the other game has ended or stopped
        })
        const pos = new Position()
        for (const s of req.history) pos.trySan(s)
        const cost = worstCaseCallUsd(req.model)
        return { outcome: { ok: true as const, san: pos.legalSans()[0]!, why: '', costUsd: cost, ms: 2, tokens: { inputTokens: 1, outputTokens: 1 } } }
      }
      const s = await runTrial(opts, { ...deps(fakeMoves()), move })
      expect(s.state).toBe('cap-reached')
      expect((await readLedger(opts.dir)).spentUsd).toBeLessThanOrEqual(cap + 1e-9)
      await rm(root, { recursive: true })
    }
  }, 60_000)

  test('a different field under the same id is refused, not mixed in', async () => {
    const { root, opts } = await setup()
    await runTrial(opts, deps(fakeMoves()))
    await expect(runTrial({ ...opts, models: ['haiku', 'jev'] }, deps(fakeMoves()))).rejects.toThrow(/trial.json/)
    await expect(runTrial({ ...opts, gamesPerPair: 2 }, deps(fakeMoves()))).rejects.toThrow(/trial.json/)
    await rm(root, { recursive: true })
  })

  test('never more than one game at a time per model, yet games do run side by side', async () => {
    const models: ClaudeModelKey[] = ['fable', 'opus', 'sonnet', 'haiku', 'jev', 'gemini-pro', 'gemini-flash']
    const { root, opts } = await setup({ models, gamesPerPair: 2, maxPlies: 4, capUsd: 40 })
    const f = fakeMoves()
    const s = await runTrial(opts, deps(f))
    expect(s).toMatchObject({ state: 'done', played: 42 })
    for (const [, n] of f.maxActive) expect(n).toBe(1)
    expect([...f.maxGamesPerModel.values()].every((n) => n === 1)).toBe(true)
    expect(f.maxGamesPerModel.size).toBe(7)
    expect(f.maxConcurrentGames).toBe(3)
    await rm(root, { recursive: true })
  })

  test('the cap: a game starts only if its reserves fit, and a blocked trial stops cleanly', async () => {
    // haiku 0.14 + jev 0.02 = 0.16 held per game; each game spends 6 x $0.01.
    const { root, opts } = await setup({ models: ['haiku', 'jev'], gamesPerPair: 3, capUsd: 0.2 })
    const f = fakeMoves(0.01)
    const s = await runTrial(opts, deps(f))
    expect(s).toMatchObject({ state: 'blocked-by-cap', played: 1 })
    expect(f.calls).toBe(6)
    expect(s.spentUsd).toBeCloseTo(0.06)
    // Raising the cap on a restart lets the rest go on.
    const s2 = await runTrial({ ...opts, capUsd: 1 }, deps(fakeMoves(0.01)))
    expect(s2).toMatchObject({ state: 'done', played: 2, skipped: 1 })
    await rm(root, { recursive: true })
  })

  test('the hard cap mid-game: the game is set aside (not saved as finished) and the trial stops', async () => {
    // Haiku's worst-case call is $0.044: once $0.116 is spent its next call does not fit under $0.16.
    const { root, opts } = await setup({ models: ['haiku', 'jev'], gamesPerPair: 1, capUsd: 0.16, maxPlies: 160 })
    const f = fakeMoves(0.02)
    const s = await runTrial(opts, deps(f))
    expect(s.state).toBe('cap-reached')
    expect(s.played).toBe(0)
    expect(await readdir(join(opts.dir, 'games'))).toEqual([])
    expect((await readdir(join(opts.dir, 'aborted'))).length).toBe(1)
    expect(s.spentUsd).toBeLessThanOrEqual(0.16)
    await rm(root, { recursive: true })
  })
})
