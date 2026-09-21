import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EngineClient, type EngineTransport } from './client'
import { AnalysisAborted, EngineLane, StaleRequest } from './lane'
import { profileFor } from './strength'
import type { EngineInfo } from './uci'

/**
 * A hand-driven engine that behaves like EngineClient where it matters:
 * a new search() REJECTS the previous unsettled one ("superseded").
 * `log` records every command in order so tests can assert sequencing.
 */
function fakeEngine(opts: { waitReady?: () => Promise<void> } = {}) {
  const log: string[] = []
  const searches: Array<{
    settled: boolean
    resolve: (best: string, lines?: EngineInfo[]) => void
    reject: (e: Error) => void
  }> = []
  const engine = {
    waitReady: opts.waitReady ?? (() => Promise.resolve()),
    configure: (p: { level: number }) => void log.push(`configure:${p.level}`),
    newGame: () => void log.push('newGame'),
    setPosition: (fen: string) => void log.push(`position:${fen}`),
    stop: () => void log.push('stop'),
    search: (l: { depth: number; moveTimeMs: number; multiPv: number }) =>
      new Promise<{ best: string; lines: EngineInfo[] }>((resolve, reject) => {
        log.push(`go:${l.depth}`)
        for (const old of searches) {
          if (!old.settled) old.reject(new Error('search superseded by a newer search() call'))
        }
        const s = {
          settled: false,
          resolve: (best: string, lines: EngineInfo[] = []) => {
            s.settled = true
            resolve({ best, lines })
          },
          reject: (e: Error) => {
            s.settled = true
            reject(e)
          },
        }
        searches.push(s)
      }),
  }
  return { log, searches, engine }
}

const MOVE = { profile: profileFor(3), fen: 'MOVE-FEN', limits: { depth: 3, moveTimeMs: 150, multiPv: 4 } }
const REQ = { fen: 'ANALYSIS-FEN', depth: 14, moveTimeMs: 300 }

describe('EngineLane', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('analysis on an idle engine runs at full strength', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const p = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log).toEqual(['configure:8', 'position:ANALYSIS-FEN', 'go:14'])
    f.searches[0]?.resolve('e2e4', [{ depth: 14, scoreCp: 20, pv: ['e2e4'] }])
    await expect(p).resolves.toMatchObject({ best: 'e2e4' })
  })

  test('analysis waits while a move search is in flight', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const move = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    const analysis = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1) // only the move

    f.searches[0]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(2)
    expect(f.log.slice(-3)).toEqual(['configure:8', 'position:ANALYSIS-FEN', 'go:14'])
    f.searches[1]?.resolve('g1f3')
    await expect(analysis).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('a move pre-empts running analysis: stop first, then the move; analysis re-runs after', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const analysis = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)

    const move = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    // stop is posted BEFORE the move's configure/position.
    const i = f.log.lastIndexOf('stop')
    expect(i).toBeGreaterThan(-1)
    expect(f.log.slice(i)).toEqual(['stop', 'configure:3', 'position:MOVE-FEN', 'go:3'])

    f.searches[1]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    // The pre-empted analysis ran again and its caller gets THAT result.
    expect(f.searches).toHaveLength(3)
    f.searches[2]?.resolve('d2d4')
    await expect(analysis).resolves.toMatchObject({ best: 'd2d4' })
  })

  test('aborting a queued request rejects it and it never reaches the engine', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    void lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    const ctrl = new AbortController()
    const p = lane.analyze(REQ, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted)
    f.searches[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)
  })

  test('aborting the running request stops the engine and rejects', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const ctrl = new AbortController()
    const p = lane.analyze(REQ, ctrl.signal)
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted)
    expect(f.log.at(-1)).toBe('stop')
  })

  test('a move that went stale while waiting for readiness never touches the engine', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    await expect(lane.move(MOVE, () => false)).rejects.toBeInstanceOf(StaleRequest)
    expect(f.log).toEqual([])
  })

  test('newGame pre-empts analysis before ucinewgame', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    void lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    lane.newGame()
    expect(f.log.slice(-2)).toEqual(['stop', 'newGame'])
  })

  test('dispose rejects queued and running analysis', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const a = lane.analyze(REQ)
    const b = lane.analyze({ ...REQ, fen: 'B' })
    await vi.advanceTimersByTimeAsync(0)
    lane.dispose()
    await expect(a).rejects.toThrow(/disposed/)
    await expect(b).rejects.toThrow(/disposed/)
  })

  test('a pre-empted analysis reply that still arrives is dropped; the caller gets the re-run', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const analysis = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)

    const move = lane.move(MOVE, () => true)
    // The stopped search answers (its bestmove) before the move's search starts.
    f.searches[0]?.resolve('STALE')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(2) // the move
    f.searches[1]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(3) // the re-run
    f.searches[2]?.resolve('d2d4')
    await expect(analysis).resolves.toMatchObject({ best: 'd2d4' })
  })

  test('analysis aborted while waiting for readiness sends nothing to the engine', async () => {
    let ready: () => void = () => {}
    const gate = new Promise<void>((r) => (ready = r))
    const f = fakeEngine({ waitReady: () => gate })
    const lane = new EngineLane(f.engine)
    const ctrl = new AbortController()
    const p = lane.analyze(REQ, ctrl.signal)
    await vi.advanceTimersByTimeAsync(0) // pumped: now awaiting waitReady()
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted)
    ready()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log.filter((c) => c !== 'stop')).toEqual([])
    expect(f.searches).toHaveLength(0)
  })

  test('an analysis that is already aborted never queues', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(lane.analyze(REQ, ctrl.signal)).rejects.toBeInstanceOf(AnalysisAborted)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log).toEqual([])
  })

  test('a move that supersedes a still-running move search stops the engine before reconfiguring', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const first = lane.move(MOVE, () => true)
    // Attach the rejection handler now: the supersede below rejects `first`
    // synchronously inside `second`'s engine.search() call, before we'd
    // otherwise get a chance to await it (Node would flag it unhandled).
    const firstSuperseded = expect(first).rejects.toThrow(/superseded/)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)

    const MOVE2 = { profile: profileFor(5), fen: 'MOVE2-FEN', limits: { depth: 5, moveTimeMs: 400, multiPv: 3 } }
    const second = lane.move(MOVE2, () => true)
    await vi.advanceTimersByTimeAsync(0)

    // stop is posted BEFORE the second move's configure/position, i.e.
    // before any UCI option/position command reaches the still-searching engine.
    const i = f.log.lastIndexOf('stop')
    expect(i).toBeGreaterThan(-1)
    expect(f.log.slice(i)).toEqual(['stop', 'configure:5', 'position:MOVE2-FEN', 'go:5'])

    await firstSuperseded
    f.searches[1]?.resolve('g1f3')
    await expect(second).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('newGame stops the engine before ucinewgame when a move search is in flight', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const move = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)

    lane.newGame()
    expect(f.log.slice(-2)).toEqual(['stop', 'newGame'])

    f.searches[0]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
  })

  test('a move requested in the same turn as the previous move settles goes before queued analysis', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const first = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    const analysis = lane.analyze(REQ)
    // Like the zero-player controller: the next move is asked for as soon as one lands.
    const second = first.then(() => lane.move({ ...MOVE, fen: 'NEXT-FEN' }, () => true))
    f.searches[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(2)
    expect(f.log.at(-2)).toBe('position:NEXT-FEN') // the move, not the analysis
    // ...and the analysis was never even started (so never needed pre-empting).
    expect(f.log).not.toContain('stop')
    expect(f.log).not.toContain('configure:8')
    f.searches[1]?.resolve('e7e5')
    await expect(second).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(3)
    f.searches[2]?.resolve('g1f3')
    await expect(analysis).resolves.toMatchObject({ best: 'g1f3' })
  })
})

/**
 * EngineLane over the real EngineClient, with a hand-driven transport.
 * Reproduces the ordering probed on stockfish-19-lite-single: the stopped
 * analysis's `bestmove` can arrive AFTER a `readyok` that was requested
 * behind the `stop`.
 */
describe('EngineLane over EngineClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function wired() {
    const sent: string[] = []
    let handler: ((line: string) => void) | null = null
    const transport: EngineTransport = {
      post: (cmd) => void sent.push(cmd),
      onMessage: (cb) => void (handler = cb),
      onError: () => {},
      terminate: () => {},
    }
    const client = new EngineClient(transport)
    const lane = new EngineLane(client)
    const emit = (line: string) => handler?.(line)
    const gos = () => sent.filter((c) => c.startsWith('go '))
    return { sent, client, lane, emit, gos }
  }

  test('a move that pre-empts analysis gets its own bestmove even when readyok beats the stale one', async () => {
    const w = wired()
    w.emit('readyok') // handshake
    const analysis = w.lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(w.gos()).toEqual(['go depth 14 movetime 300'])

    const move = w.lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    w.emit('readyok') // any isready on the wire answers first...
    w.emit('bestmove d2d4 ponder d7d5') // ...then the stopped analysis's reply
    expect(w.gos()).toEqual(['go depth 14 movetime 300', 'go depth 3 movetime 150'])
    w.emit('bestmove e7e5') // the move search's own reply
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })

    // The pre-empted analysis re-runs and gets ITS reply, not one behind.
    await vi.advanceTimersByTimeAsync(0)
    expect(w.gos()).toHaveLength(3)
    w.emit('info depth 14 multipv 1 score mate 1 pv h5f7')
    w.emit('bestmove h5f7')
    await expect(analysis).resolves.toMatchObject({ best: 'h5f7' })
  })

  test('newGame while a move searches, then a new move, stays in step', async () => {
    const w = wired()
    w.emit('readyok') // handshake
    let firstCurrent = true
    const first = w.lane.move(MOVE, () => firstCurrent)
    first.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(w.gos()).toEqual(['go depth 3 movetime 150'])
    firstCurrent = false
    w.lane.newGame()
    const second = w.lane.move({ ...MOVE, fen: 'MOVE2-FEN' }, () => true)
    await vi.advanceTimersByTimeAsync(0)
    w.emit('readyok') // newGame()'s isready, before the stopped search's bestmove
    w.emit('bestmove d2d4')
    expect(w.gos()).toHaveLength(2)
    w.emit('bestmove g8f6')
    await expect(first).rejects.toThrow(/supersed/i)
    await expect(second).resolves.toMatchObject({ best: 'g8f6' })
  })
})
