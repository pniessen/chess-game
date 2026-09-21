import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController } from './controller'
import type { MatchConfig } from './types'
import type { EngineInfo } from '../engine/uci'

/**
 * An engine we resolve by hand, so no Stockfish and no waiting.
 *
 * `rejectOnSupersede` mirrors the real EngineClient: starting a new search
 * while one is still pending REJECTS the old one ("search superseded").
 * Without it, a superseded search simply never settles unless the test
 * resolves it — which can never exercise the controller's catch path.
 */
function fakeEngine(opts: { rejectOnSupersede?: boolean } = {}) {
  const calls: Array<{
    resolve: (best: string, lines?: EngineInfo[]) => void
    reject: (e: Error) => void
    settled: boolean
  }> = []
  const setPosition = vi.fn<(fen: string, moves: string[]) => void>()
  return {
    calls,
    setPosition,
    client: {
      waitReady: () => Promise.resolve(),
      configure: vi.fn(),
      newGame: vi.fn(),
      setPosition,
      search: () =>
        new Promise<{ best: string; lines: EngineInfo[] }>((resolve, reject) => {
          if (opts.rejectOnSupersede) {
            for (const old of calls) {
              if (!old.settled) old.reject(new Error('search superseded by a newer search() call'))
            }
          }
          const call = {
            settled: false,
            resolve: (best: string, lines: EngineInfo[] = []) => {
              call.settled = true
              resolve({ best, lines })
            },
            reject: (e: Error) => {
              call.settled = true
              reject(e)
            },
          }
          calls.push(call)
        }),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  }
}

const ZERO_PLAYER: MatchConfig = {
  white: { kind: 'engine', level: 1 },
  black: { kind: 'engine', level: 1 },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

/** The FEN the fake engine was most recently asked to search. */
function lastSearchedFen(e: ReturnType<typeof fakeEngine>): string | undefined {
  return e.setPosition.mock.calls.at(-1)?.[0]
}

const HUMAN_VS_ENGINE: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'engine', level: 4 },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

describe('MatchController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a human move is applied and the engine is asked to reply', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    expect(c.submitHumanMove({ from: 'e2', to: 'e4' }).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a stale engine reply is ignored after a new game starts', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)

    c.start(HUMAN_VS_ENGINE) // new game while the engine is thinking
    e.calls[0]?.resolve('e7e5') // the old reply lands late
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a human move is refused while the engine is thinking', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.submitHumanMove({ from: 'd2', to: 'd4' }).ok).toBe(false)
  })

  test('undo in one-player mode takes back both plies', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)

    c.undo()
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('running out of time finishes the game as a flag loss, not a checkmate', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      ...HUMAN_VS_ENGINE,
      timeControl: { kind: 'timed', initialMs: 1_000, incrementMs: 0 },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('flag')
      // White (the human seat in HUMAN_VS_ENGINE) is to move and flags;
      // black is the winner. The rules never ended the game, so status
      // must NOT claim checkmate.
      expect(phase.winner).toBe('b')
      expect(phase.status.kind).not.toBe('checkmate')
    }
  })

  test('checkmate finishes the game normally with the mating side as winner', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    })
    c.submitHumanMove({ from: 'f3', to: 'f7' })
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('normal')
      expect(phase.status).toEqual({ kind: 'checkmate', winner: 'w' })
      expect(phase.winner).toBe('w')
    }
  })

  test('a draw reports winner null', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      // Black to move, stalemated.
      startFen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    })
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.status).toEqual({ kind: 'draw', reason: 'stalemate' })
      expect(phase.winner).toBeNull()
    }
  })

  test('resign reports the true rules status and the opponent as winner', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.resign('w')
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('resign')
      expect(phase.winner).toBe('b')
      // The rules did not end this game; a UI branching on 'checkmate'
      // must not show "Checkmate" for a resignation.
      expect(phase.status.kind).not.toBe('checkmate')
    }
  })

  test('a flag reports the true rules status and the opponent of the flagged side as winner', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'timed', initialMs: 1_000, incrementMs: 0 },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('flag')
      expect(phase.winner).toBe('b')
      expect(phase.status.kind).not.toBe('checkmate')
    }
  })

  test('a step interrupted by pause() before the engine replies does not leak into resume()', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const zeroPlayer: MatchConfig = {
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    }
    c.start(zeroPlayer)
    c.pause() // interrupt start()'s own engine request before it reaches search()
    expect(c.snapshot().phase.kind).toBe('paused')

    c.step()
    await vi.advanceTimersByTimeAsync(0) // let askEngine reach engine.search()
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    c.pause() // interrupt the step itself, BEFORE the engine replies
    expect(c.snapshot().phase.kind).toBe('paused')

    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    // The interrupted step's own request resolves late; it must be dropped
    // by the requestId check rather than applied.
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(0)

    // resume()'s own fresh request resolves.
    e.calls[1]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(1)
    // THE LEAK: with the stale flag, afterMove() would wrongly re-pause
    // here after exactly one move. Continuous zero-player play must
    // instead keep going and ask the engine for black's reply.
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[2]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(2)
    expect(c.snapshot().phase.kind).not.toBe('paused')
  })

  test('a step interrupted by undo() before the engine replies does not leak into resume()', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const zeroPlayer: MatchConfig = {
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    }
    c.start(zeroPlayer)
    c.pause()
    c.step()
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    c.undo() // interrupt the step via undo() instead of pause()
    // Both seats are engines and no move has been played yet, so undo()
    // lands directly back on 'paused' without issuing a new request.
    expect(c.snapshot().phase.kind).toBe('paused')

    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[0]?.resolve('e2e4') // the interrupted step's stale reply
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(0)

    e.calls[1]?.resolve('e2e4') // resume()'s fresh request
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(1)
    // Same leak, via undo() this time: must not re-pause after one move.
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[2]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(2)
    expect(c.snapshot().phase.kind).not.toBe('paused')
  })

  test('step plays exactly one engine move, then re-pauses', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    })
    c.pause()
    expect(c.snapshot().phase.kind).toBe('paused')

    c.step()
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(1)
    expect(c.snapshot().phase.kind).toBe('paused')
  })

  test('two illegal engine moves finish the game as an engine error', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('a1a8') // illegal
    await vi.advanceTimersByTimeAsync(0)
    e.calls[1]?.resolve('a1a8') // illegal again
    await vi.advanceTimersByTimeAsync(0)

    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('engine-error')
    // The position must survive intact for export.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
  })

  test('snapshot() returns the identical object when nothing has changed', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    const a = c.snapshot()
    const b = c.snapshot()
    expect(a).toBe(b)
  })

  test('subscribers are notified on every change', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const seen = vi.fn()
    c.subscribe(seen)
    c.start({
      white: { kind: 'human' }, black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test('dispose() disposes the engine', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.dispose()
    expect(e.client.dispose).toHaveBeenCalledTimes(1)
  })

  test('redo after undo from checkmate restores the finished phase, not a stale awaiting-human', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    })
    c.submitHumanMove({ from: 'f3', to: 'f7' }) // checkmate
    expect(c.snapshot().phase.kind).toBe('finished')

    c.undo()
    // undo() goes through the controller already, so this half already
    // worked before this fix: the phase correctly reverts.
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    // A version of redo() that only replayed the move on the live `Game`
    // object (e.g. `game.redo()` called directly, bypassing the
    // controller — the pre-fix behaviour) and forced a re-render without
    // re-deriving `phase` the way afterMove() does for a freshly played
    // move would leave `phase` exactly as undo() left it:
    // `{ kind: 'awaiting-human', side: 'w' }`. The board would show the
    // mated position again while the UI still thought it was White's turn
    // to move and the game resignable — which is precisely the bug. This
    // assertion fails under that behaviour and only passes once redo()
    // re-derives phase from the post-redo position, as implemented below.
    const redone = c.redo()
    expect(redone).toBe(true)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.status).toEqual({ kind: 'checkmate', winner: 'w' })
      expect(phase.reason).toBe('normal')
      expect(phase.winner).toBe('w')
    }
  })

  test('redo() is a no-op when there is nothing to redo', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    expect(c.redo()).toBe(false)
  })

  test('goTo(ply) browses without truncating, and emits', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    c.submitHumanMove({ from: 'e7', to: 'e5' })
    const before = c.snapshot()
    expect(before.game.moves).toHaveLength(2)

    c.goTo(0)
    const after = c.snapshot()
    // useSyncExternalStore compares by reference: browsing must still emit
    // a fresh snapshot object, or the board would never visually update.
    expect(after).not.toBe(before)
    expect(after.game.ply).toBe(0)
    // Browsing must not discard the live moves.
    expect(after.game.moves).toHaveLength(2)
  })

  test('one-player undo -> redo restores both plies with the ORIGINAL engine reply and starts no new search', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])

    c.undo()
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    const callsBeforeRedo = e.calls.length
    const redone = c.redo()
    await vi.advanceTimersByTimeAsync(0)

    expect(redone).toBe(true)
    // Both plies restored, and the engine's reply is the ORIGINAL e7e5 —
    // not a fresh search result.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    // Redo restores recorded history; it must never issue a new search.
    expect(e.calls.length).toBe(callsBeforeRedo)
  })

  test('zero-player undo -> redo restores one ply and stays paused, starting no new search', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const zeroPlayer: MatchConfig = {
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    }
    c.start(zeroPlayer)
    c.pause()
    c.step()
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(1)
    expect(c.snapshot().phase.kind).toBe('paused')

    c.undo()
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase.kind).toBe('paused')

    const callsBeforeRedo = e.calls.length
    const redone = c.redo()
    await vi.advanceTimersByTimeAsync(0)

    expect(redone).toBe(true)
    expect(c.snapshot().game.moves).toHaveLength(1)
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
    expect(e.calls.length).toBe(callsBeforeRedo)
  })

  test('one-player redo when the future holds only one ply restores it without throwing', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0) // engine now thinking, not yet resolved
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    c.undo() // only the human's move exists yet; the engine never replied
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    const redone = c.redo()
    expect(redone).toBe(true)
    // Only one ply was available to redo, and it must be restored cleanly.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
    // It is now the engine's turn, but redo() must never start a search.
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
  })

  test('goTo() is refused while the engine is thinking', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    const before = c.snapshot()
    c.goTo(0)
    expect(c.snapshot()).toBe(before) // refused: no emit, no browsing
  })
})

describe('MatchController: browsing never changes the live game (C2)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

  /** Zero-player: play 1.e4 e5 through the fake engine, then pause. */
  async function zeroPlayerAfterE4E5() {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(ZERO_PLAYER)
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    e.calls[1]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    c.pause()
    return { e, c }
  }

  test('pause -> browse to an earlier ply -> resume searches the LIVE position and keeps playing', async () => {
    const { e, c } = await zeroPlayerAfterE4E5()
    c.goTo(1) // browse to after 1.e4 (Black to move in the VIEWED position)
    expect(c.snapshot().game.ply).toBe(1)

    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    // The engine must be asked about the live position (White to move after
    // 1...e5), for White — not the browsed one.
    expect(lastSearchedFen(e)).toBe(AFTER_E4_E5)
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })
    // The view snaps back to live so the user sees the move being made.
    expect(c.snapshot().game.ply).toBe(2)

    e.calls.at(-1)?.resolve('g1f3') // legal for White in the LIVE position only
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3'])
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'b' })
  })

  test('pause -> browse -> step plays exactly one move on the LIVE position', async () => {
    const { e, c } = await zeroPlayerAfterE4E5()
    c.goTo(1)

    c.step()
    await vi.advanceTimersByTimeAsync(0)
    expect(lastSearchedFen(e)).toBe(AFTER_E4_E5)

    e.calls.at(-1)?.resolve('g1f3')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3'])
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
  })

  test('one-player: pause -> browse -> resume returns to the human, not an engine search', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    const searches = e.calls.length

    c.pause()
    c.goTo(1) // Black (the engine) to move in the VIEWED position
    c.resume()
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    expect(e.calls.length).toBe(searches)
    expect(c.submitHumanMove({ from: 'g1', to: 'f3' }).ok).toBe(true)
  })

  test('browsing while paused is non-destructive', async () => {
    const { c } = await zeroPlayerAfterE4E5()
    c.goTo(0)
    expect(c.snapshot().game.moves).toHaveLength(2)
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
  })
})
