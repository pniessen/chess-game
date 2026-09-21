import { describe, expect, test, vi } from 'vitest'
import { EngineClient, type EngineTransport } from './client'
import { profileFor } from './strength'

/** A transport we drive by hand; no Stockfish involved. */
function fakeTransport() {
  const sent: string[] = []
  let handler: ((line: string) => void) | null = null
  const transport: EngineTransport = {
    post: (cmd) => { sent.push(cmd) },
    onMessage: (cb) => { handler = cb },
    terminate: vi.fn(),
  }
  return {
    transport,
    sent,
    emit: (line: string) => handler?.(line),
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
})
