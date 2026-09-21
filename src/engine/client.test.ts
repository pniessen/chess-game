import { describe, expect, test, vi } from 'vitest'
import { EngineClient, type EngineTransport } from './client'
import { profileFor } from './strength'

/** A transport we drive by hand; no Stockfish involved. */
function fakeTransport() {
  const sent: string[] = []
  let handler: ((line: string) => void) | null = null
  let errorHandler: ((err: unknown) => void) | null = null
  const transport: EngineTransport = {
    post: (cmd) => { sent.push(cmd) },
    onMessage: (cb) => { handler = cb },
    onError: (cb) => { errorHandler = cb },
    terminate: vi.fn(),
  }
  return {
    transport,
    sent,
    emit: (line: string) => handler?.(line),
    emitError: (err: unknown) => errorHandler?.(err),
  }
}

describe('EngineClient', () => {
  test('handshakes with uci then isready and resolves on readyok', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    expect(f.sent).toContain('uci')
    expect(f.sent).toContain('isready')
    const ready = client.waitReady()
    f.emit('uciok')
    f.emit('readyok')
    await expect(ready).resolves.toBeUndefined()
  })

  test('configure sends Skill Level when the profile has no UCI_Elo', () => {
    const f = fakeTransport()
    new EngineClient(f.transport).configure(profileFor(1))
    expect(f.sent).toContain('setoption name Skill Level value 0')
    expect(f.sent.some((c) => c.includes('UCI_Elo'))).toBe(false)
  })

  test('configure sends UCI_LimitStrength and UCI_Elo when the profile has one', () => {
    const f = fakeTransport()
    new EngineClient(f.transport).configure(profileFor(5))
    expect(f.sent).toContain('setoption name UCI_LimitStrength value true')
    expect(f.sent).toContain('setoption name UCI_Elo value 1800')
  })

  test('setPosition sends a fen with the move list appended', () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    client.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4'])
    expect(f.sent).toContain(
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4',
    )
  })

  test('search resolves with the best move and the collected lines', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    expect(f.sent.some((c) => c.startsWith('go '))).toBe(true)
    f.emit('info depth 4 multipv 1 score cp 39 nodes 512 time 4 pv g1f3 d7d5')
    f.emit('bestmove g1f3 ponder d7d5')
    const result = await pending
    expect(result.best).toBe('g1f3')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.scoreCp).toBe(39)
  })

  test('a search always passes an explicit limit, never a bare go', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    void client.search({ depth: 10, moveTimeMs: 500, multiPv: 1 })
    const go = f.sent.find((c) => c.startsWith('go '))
    expect(go).toMatch(/depth \d+/)
    expect(go).toMatch(/movetime \d+/)
    f.emit('bestmove e2e4')
  })

  test('a CRITICAL ERROR rejects the pending search', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    f.emit('info string CRITICAL ERROR: illegal move')
    await expect(pending).rejects.toThrow(/critical/i)
  })

  test('lines from an earlier search do not leak into the next one', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const first = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('info depth 2 multipv 1 score cp 10 pv e2e4')
    f.emit('bestmove e2e4')
    await first
    const second = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('bestmove d2d4')
    expect((await second).lines).toHaveLength(0)
  })

  test('after a CRITICAL ERROR, a subsequent search() rejects promptly instead of hanging', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    f.emit('info string CRITICAL ERROR: illegal move')
    await expect(pending).rejects.toThrow(/critical/i)

    // The worker is dead. A later search() must reject immediately rather
    // than posting `go` to a process that will never reply.
    await expect(client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })).rejects.toThrow(/dead/i)
  })

  test('a CRITICAL ERROR before readiness also rejects a pending waitReady() instead of hanging', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const ready = client.waitReady()
    f.emit('info string CRITICAL ERROR: malformed fen')
    await expect(ready).rejects.toThrow(/critical/i)
    await expect(client.waitReady()).rejects.toThrow(/dead/i)
  })

  test('search() while one is in flight settles the FIRST promise as superseded', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    const second = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })

    await expect(first).rejects.toThrow(/supersed/i)

    // The second search sends `stop` for the abandoned first search and
    // must NOT send its own `go` yet.
    expect(f.sent.filter((c) => c === 'stop')).toHaveLength(1)
    expect(f.sent.filter((c) => c === 'go depth 6 movetime 200')).toHaveLength(1)

    // Stockfish answers the stopped `go` with one `bestmove`; only then is
    // the new search's own `go` sent and answered.
    f.emit('bestmove g1f3')
    f.emit('bestmove e7e5')
    await expect(second).resolves.toMatchObject({ best: 'e7e5' })
  })

  test('a late bestmove for a superseded search does not resolve the new search with the stale move', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    first.catch(() => {
      // Expected: superseded below. Prevent an unhandled rejection warning.
    })
    const second = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    f.emit('bestmove g1f3') // stale reply for the abandoned search; releases the new `go`
    f.emit('bestmove e7e5') // real reply for the new search

    const result = await second
    expect(result.best).toBe('e7e5')
    expect(result.best).not.toBe('g1f3')
  })

  // Probed on the bundled stockfish-19-lite-single build: after
  // `go` + `stop` + `isready`, `readyok` sometimes arrives BEFORE the
  // stopped search's `bestmove`. A client that releases the next `go` on
  // that `readyok` lets the stale `bestmove` resolve the new search, and
  // every later search then runs one reply behind.
  test('a readyok that arrives before the stopped search\'s bestmove does not release the new search', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const analysis = client.search({ depth: 14, moveTimeMs: 300, multiPv: 1 })
    analysis.catch(() => {})

    // EngineLane pre-empting analysis for a move: stop, configure, position, search.
    client.stop()
    client.configure(profileFor(1))
    client.setPosition('rnbqkbnr/pppppppp/8/8/5P2/8/PPPPP1PP/RNBQKBNR b KQkq - 0 1')
    const move = client.search({ depth: 1, moveTimeMs: 50, multiPv: 1 })

    // Whatever `isready` is on the wire gets its `readyok` first...
    f.emit('readyok')
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual(['go depth 14 movetime 300'])
    // ...and only then does the stopped analysis report its `bestmove`.
    f.emit('bestmove d2d4 ponder d7d5')
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual([
      'go depth 14 movetime 300',
      'go depth 1 movetime 50',
    ])
    f.emit('bestmove e7e5')

    await expect(analysis).rejects.toThrow(/supersed/i)
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
  })

  test('after a supersede whose readyok came early, later searches are not one reply behind', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    client.search({ depth: 14, moveTimeMs: 300, multiPv: 1 }).catch(() => {})
    const second = client.search({ depth: 1, moveTimeMs: 50, multiPv: 1 })
    f.emit('readyok')
    f.emit('bestmove d2d4') // the stopped search's reply
    f.emit('bestmove e7e5') // the second search's own reply
    await expect(second).resolves.toMatchObject({ best: 'e7e5' })

    const third = client.search({ depth: 1, moveTimeMs: 50, multiPv: 1 })
    expect(f.sent.filter((c) => c.startsWith('go '))).toHaveLength(3)
    f.emit('bestmove g1f3')
    await expect(third).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('newGame()\'s readyok during an unwinding search does not release the next search', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    client.search({ depth: 14, moveTimeMs: 300, multiPv: 1 }).catch(() => {})
    client.stop()
    client.newGame()
    const next = client.search({ depth: 1, moveTimeMs: 50, multiPv: 1 })

    f.emit('readyok') // newGame()'s isready (probed: can precede the stopped search's bestmove)
    expect(f.sent.filter((c) => c.startsWith('go '))).toHaveLength(1)
    f.emit('bestmove d2d4')
    f.emit('bestmove e2e4')
    await expect(next).resolves.toMatchObject({ best: 'e2e4' })
  })

  test('several supersedes in a row stop the engine once and send only the latest go', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    const second = client.search({ depth: 7, moveTimeMs: 200, multiPv: 1 })
    const third = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    await expect(first).rejects.toThrow(/supersed/i)
    await expect(second).rejects.toThrow(/supersed/i)
    expect(f.sent.filter((c) => c === 'stop')).toHaveLength(1)

    f.emit('bestmove g1f3') // the first (stopped) search's only reply
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual([
      'go depth 6 movetime 200',
      'go depth 8 movetime 300',
    ])
    f.emit('bestmove e7e5')
    await expect(third).resolves.toMatchObject({ best: 'e7e5' })
  })

  test("the new search's go is not sent until the stopped search's bestmove arrives", async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    first.catch(() => {})
    void client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    // Only the first search's `go` has been sent so far.
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual(['go depth 6 movetime 200'])
    expect(f.sent).toContain('stop')

    f.emit('bestmove g1f3')
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual([
      'go depth 6 movetime 200',
      'go depth 8 movetime 300',
    ])
    f.emit('bestmove e7e5')
  })

  test('a stop() with no search running (e.g. from newGame) does not hold back the next search', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    client.stop()
    client.newGame()
    const next = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual(['go depth 4 movetime 100'])
    f.emit('readyok') // newGame()'s isready
    f.emit('bestmove e2e4')
    await expect(next).resolves.toMatchObject({ best: 'e2e4' })
  })

  test('a stray bestmove with no go outstanding resolves nothing', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok')
    const first = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('bestmove e2e4')
    await expect(first).resolves.toMatchObject({ best: 'e2e4' })
    f.emit('bestmove h2h4') // answers no `go` of ours
    const second = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('bestmove d2d4')
    await expect(second).resolves.toMatchObject({ best: 'd2d4' })
  })

  test('an extra stop() before a superseding search() (EngineLane pre-empting a move) does not hang', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake (its own isready)
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    first.catch(() => {
      // Expected: superseded below. Prevent an unhandled rejection warning.
    })

    // This mirrors EngineLane.move()'s fix: an explicit stop() sent before
    // configure/position/search, ahead of the supersede that search() itself
    // triggers because `first` is still pending.
    client.stop()
    client.configure(profileFor(5))
    client.setPosition('8/8/8/8/8/8/8/8 w - - 0 1')
    const second = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    // Two `stop`s reach the wire (the explicit one, then search()'s own for
    // the supersede); a second `stop` on a stopping engine is harmless and
    // produces no extra `bestmove`. No `isready` beyond the handshake's.
    expect(f.sent.filter((c) => c === 'stop')).toHaveLength(2)
    expect(f.sent.filter((c) => c === 'isready')).toHaveLength(1)
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual(['go depth 6 movetime 200'])

    f.emit('bestmove g1f3') // the stopped first search's reply
    expect(f.sent.filter((c) => c.startsWith('go '))).toEqual([
      'go depth 6 movetime 200',
      'go depth 8 movetime 300',
    ])
    f.emit('bestmove e7e5')

    await expect(first).rejects.toThrow(/supersed/i)
    await expect(second).resolves.toMatchObject({ best: 'e7e5' })
  })

  test('a CRITICAL ERROR while a superseding search is held back marks the client dead and rejects it', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    first.catch(() => {})
    const second = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    // The second search is held back (stop sent, no bestmove yet).
    f.emit('info string CRITICAL ERROR: illegal move')

    await expect(second).rejects.toThrow(/critical/i)
    // The client is now dead and rejects promptly rather than waiting
    // forever for a bestmove that will never come.
    await expect(client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })).rejects.toThrow(/dead/i)
  })

  test('a transport error while a superseding search is held back rejects it promptly', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok')
    client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 }).catch(() => {})
    const second = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })
    f.emitError({ message: 'worker crashed' })
    await expect(second).rejects.toThrow(/error/i)
    await expect(client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })).rejects.toThrow(/dead/i)
  })

  test("info lines from the stopped search do not appear in the new search's lines", async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the initial handshake
    const first = client.search({ depth: 6, moveTimeMs: 200, multiPv: 1 })
    first.catch(() => {})
    const second = client.search({ depth: 8, moveTimeMs: 300, multiPv: 1 })

    // An info line from the abandoned first search, still arriving while
    // it unwinds — must not contaminate the new search.
    f.emit('info depth 6 multipv 1 score cp 10 pv g1f3')
    f.emit('bestmove g1f3')
    // A legitimate info line for the new search, after its `go` was sent.
    f.emit('info depth 8 multipv 1 score cp -5 pv e7e5')
    f.emit('bestmove e7e5')

    const result = await second
    expect(result.best).toBe('e7e5')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.scoreCp).toBe(-5)
  })

  test('a transport error event marks the client dead and rejects waitReady()', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const ready = client.waitReady()

    // `new Worker(url)` never throws for a 404 on the engine asset or a
    // network failure — those only ever arrive asynchronously as the
    // worker's own `error` event, with no `readyok` ever following.
    f.emitError(new Error('Failed to load engine script'))

    await expect(ready).rejects.toThrow(/dead/i)
    await expect(client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })).rejects.toThrow(/dead/i)
  })

  test('a transport error event rejects a search already in flight', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    f.emit('readyok') // completes the handshake
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })

    f.emitError({ message: '404 Not Found' })

    await expect(pending).rejects.toThrow(/error/i)
  })

  test('a handshake that never answers times out and marks the client dead', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeTransport()
      const client = new EngineClient(f.transport)
      const ready = client.waitReady()

      // No 'readyok' ever arrives — the worker loaded but never speaks UCI.
      const assertion = expect(ready).rejects.toThrow(/dead/i)
      await vi.advanceTimersByTimeAsync(60_000)
      await assertion

      // The client is now dead and a later call rejects promptly instead of
      // hanging forever.
      await expect(client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })).rejects.toThrow(
        /dead/i,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  test('a handshake that answers before the timeout does not later mark the client dead', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeTransport()
      const client = new EngineClient(f.transport)
      const ready = client.waitReady()
      f.emit('readyok')
      await ready

      // Advance well past the handshake timeout window — a client that
      // already became ready must not spuriously die afterwards.
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(client.waitReady()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
