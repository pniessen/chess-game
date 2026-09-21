import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController, chooseBookMove, chooseEngineMove } from './controller'
import type { MatchConfig } from './types'
import type { EngineInfo } from '../engine/uci'
import { Game } from '../game-core/game'

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
    expect(e.calls).toHaveLength(1)

    // New game while the engine is thinking. It starts from the SAME
    // position the old search was about (after 1.e4, Black to move), so the
    // stale reply e7e5 is perfectly LEGAL here: the rules cannot reject it,
    // only the requestId guard can.
    const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      startFen: AFTER_E4,
    })
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'b' })

    e.calls[0]?.resolve('e7e5') // the old reply lands late
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().game.current().fen()).toBe(AFTER_E4)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'b' })
    // No retry search was started on the stale reply's behalf either.
    expect(e.calls).toHaveLength(1)
  })

  test('New Game while the engine is thinking does NOT end the new game as engine-error', async () => {
    // Mirrors the real EngineClient: the new game's search() REJECTS the
    // old, still-pending one as superseded. That rejection lands in the old
    // askEngine()'s catch, which must recognise it as stale by requestId.
    const e = fakeEngine({ rejectOnSupersede: true })
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    // The new game has the engine as White, so it searches immediately —
    // superseding (and rejecting) the old game's search.
    c.start({
      white: { kind: 'engine', level: 4 },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(2)

    const phase = c.snapshot().phase
    expect(phase.kind).not.toBe('finished')
    expect(phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })

    // ...and the new game's own search still lands normally.
    e.calls[1]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'b' })
  })

  test('a genuine engine failure still ends the game as engine-error', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.reject(new Error('worker crashed'))
    await vi.advanceTimersByTimeAsync(0)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('engine-error')
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

    const searchesBeforeRedo = e.calls.length
    const redone = c.redo()
    expect(redone).toBe(true)
    // Only one ply was available to redo, and it must be restored cleanly.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
    // Redo is undo's exact inverse: undo interrupted the engine while it was
    // thinking, so redo lands back there. No engine reply was ever recorded,
    // so asking again substitutes nothing — and leaving the game 'paused' on
    // the engine's turn would strand a one-player game (finding I5).
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'b' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls.length).toBe(searchesBeforeRedo + 1)
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

  test('analysis requested while the engine is choosing a move waits for the move', async () => {
    const e = fakeEngine({ rejectOnSupersede: true })
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // the engine's move search

    const analysis = c.analyze({ fen: c.snapshot().game.current().fen(), depth: 10, moveTimeMs: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // not raced

    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(e.calls).toHaveLength(2) // now the analysis
    e.calls[1]?.resolve('g1f3')
    await expect(analysis).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('an engine move pre-empts running analysis and still lands', async () => {
    const e = fakeEngine({ rejectOnSupersede: true })
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    void c.analyze({ fen: c.snapshot().game.current().fen(), depth: 10, moveTimeMs: 100 }).catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // analysis running

    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.client.stop).toHaveBeenCalled()
    expect(e.calls).toHaveLength(2) // the move search superseded it
    e.calls[1]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
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

describe('MatchController: one-player undo pops to the human\'s turn (I5)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** 1.e4 e5 2.Nf3 with the engine (Black) now thinking about its reply. */
  async function thinkingAfterNf3() {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    c.submitHumanMove({ from: 'g1', to: 'f3' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'b' })
    return { e, c }
  }

  test('undo while the engine is thinking removes ONLY the human move, keeping the engine\'s previous reply', async () => {
    const { e, c } = await thinkingAfterNf3()
    const searches = e.calls.length

    c.undo()
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    // The engine is NOT sent off to replay e5.
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls.length).toBe(searches)

    // The interrupted search's reply lands late and must be dropped.
    e.calls.at(-1)?.resolve('b8c6')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('redo after that undo restores the move and puts the engine back to thinking — never stranded paused', async () => {
    const { e, c } = await thinkingAfterNf3()
    c.undo()
    const searches = e.calls.length

    expect(c.redo()).toBe(true)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3'])
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'b' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls.length).toBe(searches + 1)

    e.calls.at(-1)?.resolve('b8c6')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('undo after the engine has replied still takes back both plies', async () => {
    const { e, c } = await thinkingAfterNf3()
    e.calls.at(-1)?.resolve('b8c6')
    await vi.advanceTimersByTimeAsync(0)
    c.undo()
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('the clock follows undo onto the human\'s side', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({ ...HUMAN_VS_ENGINE, timeControl: { kind: 'timed', initialMs: 60_000, incrementMs: 0 } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.clockState().running).toBe('b')
    c.undo()
    expect(c.clockState().running).toBe('w')
  })
})

describe('blunder injection (I3)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** A random source that returns the given values in order, then repeats the last. */
  const seq = (...values: number[]) => {
    let i = 0
    return () => values[Math.min(i++, values.length - 1)] ?? 0
  }

  // Black's candidate replies to 1.e4, as MultiPV would report them over two
  // iterations. Rank 3's depth-1 report (a7a6) is superseded by its deeper
  // depth-2 report (e7e6): the pool must use the deepest line per rank.
  const LINES: EngineInfo[] = [
    { depth: 1, multipv: 1, scoreCp: 30, pv: ['e7e5'] },
    { depth: 1, multipv: 2, scoreCp: 20, pv: ['c7c5'] },
    { depth: 1, multipv: 3, scoreCp: 10, pv: ['a7a6'] },
    { depth: 1, multipv: 4, scoreCp: 0, pv: ['d7d6'] },
    { depth: 2, multipv: 1, scoreCp: 35, pv: ['e7e5', 'g1f3'] },
    { depth: 2, multipv: 2, scoreCp: 25, pv: ['c7c5', 'g1f3'] },
    { depth: 2, multipv: 3, scoreCp: 5, pv: ['e7e6', 'd2d4'] },
    { depth: 2, multipv: 4, scoreCp: -10, pv: ['d7d6', 'd2d4'] },
  ]

  async function replyTo(e4With: { level: 1 | 8; random: () => number }) {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: e4With.random })
    c.start({ ...HUMAN_VS_ENGINE, black: { kind: 'engine', level: e4With.level } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5', LINES)
    await vi.advanceTimersByTimeAsync(0)
    return c.snapshot().game.moves.map((m) => m.san)
  }

  test('a forced hit plays a lower-ranked line from the engine\'s own MultiPV, not best', async () => {
    // First draw 0 < 0.55 => blunder; second draw 0 => first of the weaker half.
    const moves = await replyTo({ level: 1, random: seq(0, 0) })
    expect(moves).toEqual(['e4', 'e6']) // rank 3 at its DEEPEST report, not a6
    expect(moves[1]).not.toBe('e5')
  })

  test('a forced hit picks only from the weaker half of the ranking', async () => {
    const moves = await replyTo({ level: 1, random: seq(0, 0.999) })
    expect(moves).toEqual(['e4', 'd6']) // rank 4, the weakest
  })

  test('a forced miss plays best', async () => {
    const moves = await replyTo({ level: 1, random: seq(0.99) })
    expect(moves).toEqual(['e4', 'e5'])
  })

  test('blunderChance 0 (level 8) never blunders, even with a source that always returns 0', async () => {
    const random = vi.fn(() => 0)
    const moves = await replyTo({ level: 8, random })
    expect(moves).toEqual(['e4', 'e5'])
    expect(random).not.toHaveBeenCalled()
  })

  test('the default random source is Math.random', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client }) // no random injected
    c.start({ ...HUMAN_VS_ENGINE, black: { kind: 'engine', level: 1 } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5', LINES)
    await vi.advanceTimersByTimeAsync(0)
    expect(spy).toHaveBeenCalled()
    expect(c.snapshot().game.moves[1]?.san).toBe('e6')
    spy.mockRestore()
  })

  test('with too few lines to choose from, a hit still plays best', () => {
    expect(chooseEngineMove({ best: 'e7e5', lines: [] }, { blunderChance: 1 }, () => 0)).toBe('e7e5')
    expect(
      chooseEngineMove(
        { best: 'e7e5', lines: [{ depth: 3, multipv: 1, pv: ['e7e5'] }] },
        { blunderChance: 1 },
        () => 0,
      ),
    ).toBe('e7e5')
  })

  test('with two lines, a hit plays the second', () => {
    const lines: EngineInfo[] = [
      { depth: 3, multipv: 1, pv: ['e7e5'] },
      { depth: 3, multipv: 2, pv: ['c7c5'] },
    ]
    expect(chooseEngineMove({ best: 'e7e5', lines }, { blunderChance: 1 }, () => 0)).toBe('c7c5')
  })
})

describe('load(): starting from existing history (I6)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const SIX_PLIES = new Game()
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']] as const) {
    SIX_PLIES.play({ from, to })
  }
  const BLITZ = { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 } as const

  test('credits NO increment for historical moves, and starts the clock for the side to move', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const emits = vi.fn()
    c.subscribe(emits)
    expect(c.load({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: BLITZ }, SIX_PLIES)).toBe(true)

    expect(c.snapshot().game.moves).toHaveLength(6)
    expect(c.clockState()).toEqual({ whiteMs: 180_000, blackMs: 180_000, running: 'w', flagged: null })
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    expect(emits).toHaveBeenCalledTimes(1) // one emit, not one per move
  })

  test('asks the engine to move when it is the engine\'s turn after loading', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.load({ ...HUMAN_VS_ENGINE, white: { kind: 'engine', level: 4 }, black: { kind: 'human' } }, SIX_PLIES)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })
    expect(e.calls).toHaveLength(1)
    expect(lastSearchedFen(e)).toBe(SIX_PLIES.current().fen())
  })

  test('a finished history loads straight into finished, with no clock running', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const mate = new Game()
    for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']] as const) {
      mate.play({ from, to })
    }
    c.load({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: BLITZ }, mate)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', winner: 'w' })
    expect(c.clockState().running).toBeNull()
  })

  test('the loaded Game is the controller\'s own copy, not the caller\'s object', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.load({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }, SIX_PLIES)
    expect(c.snapshot().game).not.toBe(SIX_PLIES)
    c.submitHumanMove({ from: 'b5', to: 'a4' })
    expect(SIX_PLIES.moves).toHaveLength(6)
  })
})

describe('chooseBookMove', () => {
  // RED if randomness is drawn before checking there is a book move to make
  // (it would shift every later blunder draw at levels/positions with no book).
  test('no continuations or no chance: null, and no randomness consumed', () => {
    const random = vi.fn(() => 0)
    expect(chooseBookMove([], 0.9, random)).toBeNull()
    expect(chooseBookMove(['e2e4'], 0, random)).toBeNull()
    expect(random).not.toHaveBeenCalled()
  })
  // RED if the comparison is `>` (0.9 would take the book) or the index is drawn anyway.
  test('a draw at or above the chance declines the book (one draw only)', () => {
    const random = vi.fn(() => 0.9)
    expect(chooseBookMove(['e2e4', 'd2d4'], 0.9, random)).toBeNull()
    expect(random).toHaveBeenCalledTimes(1)
  })
  // RED if the index reuses the first draw (0.1 -> index 0, 'e2e4') or is not floor(r * n).
  // (The brief expected 'c2c4' for 0.75, but floor(0.75 * 4) = 3 is 'g1f3'; 0.6 gives index 2.)
  test('otherwise a second draw picks uniformly among the continuations', () => {
    const seq = [0.1, 0.6]
    expect(chooseBookMove(['e2e4', 'd2d4', 'c2c4', 'g1f3'], 0.9, () => seq.shift() ?? 0)).toBe('c2c4')
    expect(seq).toHaveLength(0)
    expect(chooseBookMove(['e2e4', 'd2d4', 'c2c4', 'g1f3'], 0.9, () => 0.1)).toBe('e2e4')
    const last = [0.1, 0.99]
    expect(chooseBookMove(['e2e4', 'd2d4', 'c2c4', 'g1f3'], 0.9, () => last.shift() ?? 0)).toBe('g1f3')
  })
})

describe('book moves in the controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
  const AFTER_E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
  const book = {
    continuations: (epd: string) =>
      epd === AFTER_E4_EPD ? ['c7c5'] : epd === START_EPD ? ['d2d4'] : [],
  }
  const LEVEL_1_BLACK: MatchConfig = {
    white: { kind: 'human' },
    black: { kind: 'engine', level: 1 },
    timeControl: { kind: 'untimed' },
    engineDelayMs: 0,
  }
  const LEVEL_1_WHITE: MatchConfig = {
    white: { kind: 'engine', level: 1 },
    black: { kind: 'human' },
    timeControl: { kind: 'untimed' },
    engineDelayMs: 0,
  }
  const TWO_HUMANS: MatchConfig = {
    white: { kind: 'human' },
    black: { kind: 'human' },
    timeControl: { kind: 'untimed' },
  }

  // RED if askEngine never consults the book (a search is issued), or if the
  // book move is applied synchronously (the phase would already be awaiting-human).
  test('an in-book position at a low level plays the book without searching', async () => {
    const e = fakeEngine()
    const seq = [0.1, 0]
    const c = new MatchController({ engine: e.client, random: () => seq.shift() ?? 0.99 })
    c.setBook(book)
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    expect(c.snapshot().phase.kind).toBe('engine-thinking') // still asynchronous
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'c5'])
    expect(e.calls).toHaveLength(0)
  })

  // RED if a declined draw still plays the book (the answer would be c5, with no search).
  test('a declined draw searches as usual', async () => {
    const e = fakeEngine()
    const seq = [0.95] // >= 0.9: no book; then 0.99s: no blunder
    const c = new MatchController({ engine: e.client, random: () => seq.shift() ?? 0.99 })
    c.setBook(book)
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
  })

  // RED if level 8 has a non-zero bookChance, or chooseBookMove draws before checking it.
  test('level 8 never uses the book and draws no randomness for it', async () => {
    const e = fakeEngine()
    const random = vi.fn(() => 0)
    const c = new MatchController({ engine: e.client, random })
    c.setBook(book)
    c.start({ ...LEVEL_1_BLACK, black: { kind: 'engine', level: 8 } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
    expect(random).not.toHaveBeenCalled()
  })

  // Ruling P3: the stale book move (d2d4 from the start position) is LEGAL in
  // the new game, which also starts from the start position with White to
  // move. RED if the `id !== this.requestId` check after the delay is removed:
  // 1.d4 would be played into the new two-player game.
  test('a book move pending behind the speed delay is dropped by a new game', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: () => 0 })
    c.setBook(book)
    c.start({ ...LEVEL_1_WHITE, engineDelayMs: 500 })
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    c.start(TWO_HUMANS)
    await vi.advanceTimersByTimeAsync(600)
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase.kind).toBe('awaiting-human')
    expect(e.calls).toHaveLength(0)
  })

  // RED if the staleness check is removed: c5 is legal in the paused position
  // and would be played while paused.
  test('a book move pending behind the speed delay is dropped by pause', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: () => 0 })
    c.setBook(book)
    c.start({ ...LEVEL_1_BLACK, engineDelayMs: 500 })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    c.pause()
    await vi.advanceTimersByTimeAsync(600)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
    expect(c.snapshot().phase.kind).toBe('paused')
  })

  // RED if the book move is applied without its request id (afterMove() would
  // not recognise the step's completion and zero-player play would continue).
  test('a step that resolves from the book plays one move and pauses again', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: () => 0 })
    c.setBook(book)
    c.start(ZERO_PLAYER)
    c.pause()
    c.step()
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['d4'])
    expect(c.snapshot().phase.kind).toBe('paused')
    expect(e.calls).toHaveLength(0)
  })

  // RED if continuations are not validated through game-core before choosing:
  // the illegal e2e4 (Black to move) would go down the illegal-engine-move
  // path twice and end the game with 'engine-error'.
  test('an illegal dataset move never reaches the game: the engine searches instead', async () => {
    const e = fakeEngine()
    const random = vi.fn(() => 0.99)
    const c = new MatchController({ engine: e.client, random })
    c.setBook({ continuations: (epd) => (epd === AFTER_E4_EPD ? ['e2e4', 'e7e8q', 'zz'] : []) })
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase.kind).toBe('awaiting-human')
    // No book draw was spent on a position with no legal continuation: only the blunder draw.
    expect(random).toHaveBeenCalledTimes(1)
  })

  // RED if setBook(null) does not clear the book (e.g. `this.book ??= book`).
  test('without a book (not loaded yet, failed, or cleared) the engine searches', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: () => 0 })
    c.setBook(book)
    c.setBook(null)
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
  })
})
