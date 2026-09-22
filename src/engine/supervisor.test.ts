import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BESTMOVE_GRACE_MS, EngineClient, type EngineTransport } from './client'
import { EngineSupervisor, MAX_RESTARTS, RESTART_WINDOW_MS, type EngineHealth } from './supervisor'
import { MatchController } from '../match/controller'
import { profileFor } from './strength'

/**
 * One hand-driven "worker" per EngineClient the supervisor builds. `alive`
 * turns false on terminate(), so the single-worker invariant is checked
 * against what the supervisor actually terminated, not what it meant to.
 */
interface FakeWorker {
  sent: string[]
  alive: boolean
  emit(line: string): void
  emitError(err: unknown): void
  /** Answer the uci/isready handshake. */
  handshake(): void
}

function workerPool() {
  const workers: FakeWorker[] = []
  /** Max workers alive at once, sampled at every creation. */
  let peakAlive = 0
  const createClient = () => {
    const w: FakeWorker = {
      sent: [],
      alive: true,
      emit: (line) => handler?.(line),
      emitError: (err) => errorHandler?.(err),
      handshake: () => {
        w.emit('uciok')
        w.emit('readyok')
      },
    }
    let handler: ((line: string) => void) | null = null
    let errorHandler: ((err: unknown) => void) | null = null
    const transport: EngineTransport = {
      post: (cmd) => void w.sent.push(cmd),
      onMessage: (cb) => {
        handler = cb
      },
      onError: (cb) => {
        errorHandler = cb
      },
      terminate: () => {
        w.alive = false
      },
    }
    workers.push(w)
    peakAlive = Math.max(peakAlive, workers.filter((x) => x.alive).length)
    return new EngineClient(transport)
  }
  return {
    workers,
    createClient,
    alive: () => workers.filter((w) => w.alive),
    peakAlive: () => peakAlive,
    latest: () => workers[workers.length - 1]!,
  }
}

const gos = (w: FakeWorker) => w.sent.filter((c) => c.startsWith('go '))

/** Let promise chains and 0 ms timers (the lane's pump) run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

const ONE_PLAYER = {
  white: { kind: 'human' },
  black: { kind: 'engine', level: 1 },
  timeControl: { kind: 'untimed' },
} as const

const MOVE_TIME = profileFor(1).moveTimeMs

function setup(opts: { now?: () => number } = {}) {
  const pool = workerPool()
  const warn = vi.fn<(msg: string) => void>()
  const sup = new EngineSupervisor({ createClient: pool.createClient, warn, ...(opts.now ? { now: opts.now } : {}) })
  const health: EngineHealth[] = []
  sup.onHealth((h) => health.push(h))
  const controller = new MatchController({ engine: sup, random: () => 0.99 })
  return { pool, warn, sup, health, controller }
}

/** Human plays 1.e4 so the engine owes Black's reply. */
async function humanOpens(controller: MatchController) {
  controller.start(ONE_PLAYER)
  expect(controller.submitHumanMove({ from: 'e2', to: 'e4' }).ok).toBe(true)
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('EngineSupervisor', () => {
  test('a worker error event while a move is owed: fresh worker, move re-requested, reply applied', async () => {
    const { pool, warn, health, controller } = setup()
    pool.latest().handshake()
    await humanOpens(controller)
    const first = pool.latest()
    expect(gos(first)).toHaveLength(1)

    first.emitError({ message: 'worker crashed' })
    await flush()

    // The dead worker is gone and exactly one replacement exists.
    expect(pool.workers).toHaveLength(2)
    expect(first.alive).toBe(false)
    expect(pool.alive()).toHaveLength(1)
    expect(health.at(-1)).toEqual({ kind: 'restarting', reason: 'worker error: worker crashed' })
    // The game is preserved: still Black's move, still thinking.
    expect(controller.snapshot().phase.kind).toBe('engine-thinking')
    expect(controller.snapshot().game.moves).toHaveLength(1)

    const second = pool.latest()
    // No go until the new engine has finished its handshake.
    expect(gos(second)).toHaveLength(0)
    second.handshake()
    await flush()
    expect(health.at(-1)).toEqual({ kind: 'ok' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('worker error: worker crashed')
    // Re-requested on the NEW engine, for the live position.
    expect(gos(second)).toHaveLength(1)
    expect(second.sent).toContain(
      'position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    )

    second.emit('bestmove e7e5')
    await flush()
    expect(controller.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(controller.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    expect(pool.peakAlive()).toBe(1)
  })

  test('a handshake that never answers triggers a restart', async () => {
    const { pool, health, warn } = setup()
    const first = pool.latest()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(first.alive).toBe(false)
    expect(pool.workers).toHaveLength(2)
    expect(health.at(-1)?.kind).toBe('restarting')
    pool.latest().handshake()
    await flush()
    expect(health.at(-1)).toEqual({ kind: 'ok' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/handshake timed out/)
    expect(pool.peakAlive()).toBe(1)
  })

  test('the bestmove watchdog triggers a restart and the owed move is re-requested', async () => {
    const { pool, controller } = setup()
    pool.latest().handshake()
    await humanOpens(controller)
    const first = pool.latest()
    expect(gos(first)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(MOVE_TIME + BESTMOVE_GRACE_MS)
    expect(first.alive).toBe(false)
    const second = pool.latest()
    expect(second).not.toBe(first)
    second.handshake()
    await flush()
    expect(gos(second)).toHaveLength(1)
    second.emit('bestmove c7c5')
    await flush()
    expect(controller.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'c5'])
  })

  test('a late reply from the dead engine never applies', async () => {
    const { pool, controller } = setup()
    pool.latest().handshake()
    await humanOpens(controller)
    const first = pool.latest()
    first.emitError({ message: 'boom' })
    await flush()

    // The dead worker's last words arrive after its replacement was built.
    first.emit('bestmove d7d5')
    await flush()
    expect(controller.snapshot().game.moves).toHaveLength(1)
    expect(controller.snapshot().phase.kind).toBe('engine-thinking')

    const second = pool.latest()
    second.handshake()
    await flush()
    first.emit('bestmove d7d5') // ...and again, after the new engine is up
    await flush()
    expect(controller.snapshot().game.moves).toHaveLength(1)
    second.emit('bestmove e7e5')
    await flush()
    expect(controller.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
  })

  test('a move invalidated while the engine restarts is not re-requested', async () => {
    const { pool, controller } = setup()
    pool.latest().handshake()
    await humanOpens(controller)
    pool.latest().emitError({ message: 'boom' })
    controller.pause() // e.g. puzzle mode opened: requestId bumped
    await flush()
    const second = pool.latest()
    second.handshake()
    await flush()
    expect(gos(second)).toHaveLength(0)
    expect(controller.snapshot().phase).toEqual({ kind: 'paused' })

    // Resuming asks the new engine exactly once, as usual.
    controller.resume()
    await flush()
    expect(gos(second)).toHaveLength(1)
  })

  test('pending analysis fails on engine death and is not retried', async () => {
    const { pool, controller } = setup()
    pool.latest().handshake()
    controller.start({ ...ONE_PLAYER, black: { kind: 'human' } })
    const analysis = controller.analyze({ fen: controller.snapshot().game.current().fen(), depth: 10, moveTimeMs: 200 })
    const settled = analysis.then(
      () => 'resolved',
      (e: Error) => `rejected: ${e.message}`,
    )
    await flush()
    expect(gos(pool.latest())).toHaveLength(1)
    pool.latest().emitError({ message: 'boom' })
    await flush()
    await expect(settled).resolves.toMatch(/^rejected: .*worker failed/)
    pool.latest().handshake()
    await flush()
    expect(gos(pool.latest())).toHaveLength(0)
  })

  test(`at most ${MAX_RESTARTS} restarts per ${RESTART_WINDOW_MS / 60_000} minutes; then the engine stays dead`, async () => {
    let t = 1_000_000
    const { pool, health, controller, warn } = setup({ now: () => t })
    pool.latest().handshake()
    await humanOpens(controller)

    for (let i = 0; i < MAX_RESTARTS; i++) {
      pool.latest().emitError({ message: `crash ${i}` })
      await flush()
      pool.latest().handshake()
      await flush()
      t += 60_000
    }
    expect(pool.workers).toHaveLength(1 + MAX_RESTARTS)
    expect(warn).toHaveBeenCalledTimes(MAX_RESTARTS)
    expect(controller.snapshot().phase.kind).toBe('engine-thinking')

    // Third death inside the window: no new worker, today's behaviour.
    pool.latest().emitError({ message: 'crash again' })
    await flush()
    expect(pool.workers).toHaveLength(1 + MAX_RESTARTS)
    expect(pool.alive()).toHaveLength(0)
    expect(health.at(-1)).toEqual({ kind: 'dead', reason: 'worker error: crash again' })
    const phase = controller.snapshot().phase
    expect(phase.kind === 'finished' && phase.reason).toBe('engine-error')
    expect(pool.peakAlive()).toBe(1)
  })

  test('restarts older than the window no longer count against the cap', async () => {
    let t = 0
    const { pool, health } = setup({ now: () => t })
    pool.latest().handshake()
    for (let i = 0; i < MAX_RESTARTS; i++) {
      pool.latest().emitError({ message: 'crash' })
      pool.latest().handshake()
      await flush()
    }
    t += RESTART_WINDOW_MS + 1
    pool.latest().emitError({ message: 'crash later' })
    await flush()
    expect(pool.workers).toHaveLength(2 + MAX_RESTARTS)
    expect(health.at(-1)?.kind).toBe('restarting')
  })

  test('a replacement that dies during its own handshake is restarted too (within the cap)', async () => {
    const { pool, health } = setup()
    pool.latest().handshake()
    pool.latest().emitError({ message: 'first' })
    pool.latest().emitError({ message: 'second' }) // the replacement fails to load
    await flush()
    expect(pool.workers).toHaveLength(3)
    expect(pool.alive()).toHaveLength(1)
    expect(health.at(-1)).toEqual({ kind: 'restarting', reason: 'worker error: second' })
  })

  test('dispose mid-restart terminates the replacement and nothing fires afterwards', async () => {
    const { pool, sup, health, warn } = setup()
    pool.latest().handshake()
    pool.latest().emitError({ message: 'boom' })
    const second = pool.latest()
    const before = health.length
    sup.dispose()
    expect(pool.alive()).toHaveLength(0)
    second.handshake()
    second.emitError({ message: 'late' })
    await flush()
    expect(pool.workers).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
    expect(health).toHaveLength(before)
  })

  test('the generation counts replacements', async () => {
    const { pool, sup } = setup()
    expect(sup.generation()).toBe(0)
    pool.latest().emitError({ message: 'boom' })
    expect(sup.generation()).toBe(1)
  })

  test('a replacement that cannot be constructed leaves the engine dead', async () => {
    let calls = 0
    const pool = workerPool()
    const sup = new EngineSupervisor({
      createClient: () => {
        if (calls++ > 0) throw new Error('no Worker')
        return pool.createClient()
      },
      warn: vi.fn(),
    })
    const health: EngineHealth[] = []
    sup.onHealth((h) => health.push(h))
    pool.latest().emitError({ message: 'boom' })
    expect(pool.alive()).toHaveLength(0)
    expect(health.at(-1)).toEqual({ kind: 'dead', reason: 'worker error: boom' })
    await expect(sup.waitReady()).rejects.toThrow(/dead/i)
  })
})
