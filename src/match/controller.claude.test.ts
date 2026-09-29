import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController } from './controller'
import { Game } from '../game-core/game'
import type { MatchConfig } from './types'
import { resultTagOf } from './result'
import { CLAUDE_MAX_PLIES } from '../claude/models'
import { Position } from '../game-core/position'
import { STARTING_FEN } from '../game-core/types'
import type { EngineInfo } from '../engine/uci'
import type { StrengthProfile } from '../engine/strength'
import type { ClaudeMover, ClaudeMoveResult } from '../claude/gameClient'

/** The same hand-resolved engine as controller.test.ts: no Stockfish, no waiting. */
function fakeEngine() {
  const calls: Array<{ resolve: (best: string, lines?: EngineInfo[]) => void; reject: (e: Error) => void }> = []
  const configure = vi.fn<(p: StrengthProfile) => void>()
  const setPosition = vi.fn<(fen: string, moves: string[]) => void>()
  return {
    calls,
    configure,
    setPosition,
    client: {
      waitReady: () => Promise.resolve(),
      configure,
      newGame: vi.fn(),
      setPosition,
      search: () =>
        new Promise<{ best: string; lines: EngineInfo[] }>((resolve, reject) => {
          calls.push({ resolve: (best, lines = []) => resolve({ best, lines }), reject })
        }),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  }
}

type MoveReq = { startFen?: string; history: string[] }

/**
 * A scriptable Claude. `respond` answers each move() call (n counts from 0);
 * returning undefined holds that call open until the test resolves it by hand
 * through `calls[n].resolve`.
 */
function fakeClaude(respond: (req: MoveReq, n: number) => ClaudeMoveResult | undefined = () => undefined) {
  const calls: Array<{ req: MoveReq; resolve: (r: ClaudeMoveResult) => void }> = []
  const move = vi.fn((req: MoveReq): Promise<ClaudeMoveResult> => {
    const n = calls.length
    return new Promise((resolve) => {
      calls.push({ req: { ...req, history: [...req.history] }, resolve })
      const scripted = respond(req, n)
      if (scripted) resolve(scripted)
    })
  })
  const mover: ClaudeMover = {
    begin: vi.fn(() => Promise.resolve({ ok: true as const, budgetLeftUsd: 20 })),
    move,
    end: vi.fn(() => Promise.resolve()),
  }
  return { calls, move, mover }
}

const ok = (san: string, gameSpentUsd = 0, why = `because ${san}`): ClaudeMoveResult => ({
  ok: true,
  san,
  why,
  costUsd: 0.01,
  gameSpentUsd,
})
const RETRY: ClaudeMoveResult = { ok: false, kind: 'retry' }

/** Answers from a fixed line of SANs, in ply order, whoever asks. */
const playLine = (line: string[]) => (req: MoveReq) => {
  const san = line[req.history.length]
  return san ? ok(san, (req.history.length + 1) / 100) : undefined
}

const CLAUDE_VS_CLAUDE: MatchConfig = {
  white: { kind: 'claude', model: 'opus' },
  black: { kind: 'claude', model: 'sonnet' },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

const HUMAN_VS_CLAUDE: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'claude', model: 'haiku' },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

/** Claude failures never touch the engine's illegal-move counter. */
function illegalEngineMovesOf(c: MatchController): number {
  return (c as unknown as { illegalEngineMoves: number }).illegalEngineMoves
}

const sans = (c: MatchController) => c.snapshot().game.moves.map((m) => m.san)

describe('MatchController: the claude seat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('two Claude seats play three moves, with notes and the server-reported spend', async () => {
    const e = fakeEngine()
    const cl = fakeClaude(playLine(['e4', 'e5', 'Nf3']))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    // Who is thinking comes from config[side]; the phase is the engine's.
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })
    await vi.advanceTimersByTimeAsync(0)

    expect(sans(c)).toEqual(['e4', 'e5', 'Nf3'])
    expect(cl.calls.map((x) => x.req)).toEqual([
      { history: [] },
      { history: ['e4'] },
      { history: ['e4', 'e5'] },
      { history: ['e4', 'e5', 'Nf3'] },
    ])
    // The fourth ask is held open: Black is still thinking.
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'b' })
    expect(c.snapshot().claude).toEqual({
      notes: {
        0: { why: 'because e4', fallback: false },
        1: { why: 'because e5', fallback: false },
        2: { why: 'because Nf3', fallback: false },
      },
      spentUsd: 0.03,
      fallbacks: { w: 0, b: 0 },
    })
    expect(e.calls).toHaveLength(0) // Stockfish was never asked
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('a non-standard start position is sent as startFen', async () => {
    const FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start({ ...CLAUDE_VS_CLAUDE, startFen: FEN })
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.calls[0]?.req).toEqual({ startFen: FEN, history: [] })
  })

  test('a retry is asked once more, and the second answer is played', async () => {
    const cl = fakeClaude((_req, n) => (n === 0 ? RETRY : n === 1 ? ok('d4') : undefined))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['d4'])
    expect(cl.calls[1]?.req).toEqual({ history: [] })
    expect(c.snapshot().claude.fallbacks).toEqual({ w: 0, b: 0 })
    expect(c.snapshot().claude.notes[0]).toEqual({ why: 'because d4', fallback: false })
  })

  test('two failures in a row fall back to full-strength Stockfish, marked as such', async () => {
    const e = fakeEngine()
    const cl = fakeClaude((_req, n) => (n < 2 ? RETRY : undefined))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.move).toHaveBeenCalledTimes(2)
    expect(e.calls).toHaveLength(1)
    expect(e.configure.mock.calls[0]?.[0].level).toBe(8)
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })

    e.calls[0]?.resolve('g1f3')
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['Nf3'])
    expect(c.snapshot().claude.notes[0]).toEqual({ why: '', fallback: true })
    expect(c.snapshot().claude.fallbacks).toEqual({ w: 1, b: 0 })
    // Black (Claude) is asked next, as usual.
    expect(cl.calls[2]?.req).toEqual({ history: ['Nf3'] })
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('a SAN the live position refuses goes straight to the fallback', async () => {
    const e = fakeEngine()
    const cl = fakeClaude((_req, n) => (n === 0 ? ok('Qh5') : undefined))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.move).toHaveBeenCalledTimes(1)
    expect(e.calls).toHaveLength(1)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4'])
    expect(c.snapshot().claude.fallbacks).toEqual({ w: 1, b: 0 })
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('the fifth fallback on one side ends the game as claude-unavailable', async () => {
    const e = fakeEngine()
    // White's Claude always fails; Black's plays pawn moves (no repetition draw on the way).
    const black = ['a6', 'h6', 'a5', 'h5']
    const cl = fakeClaude((req) => (req.history.length % 2 === 0 ? RETRY : ok(black[(req.history.length - 1) / 2]!)))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    const white = ['e2e3', 'd2d3', 'g2g3', 'b2b3', 'h2h3']
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(0)
      e.calls[i]?.resolve(white[i]!)
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().claude.fallbacks).toEqual({ w: 5, b: 0 })
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable', winner: null })
    expect(sans(c)).toEqual(['e3', 'a6', 'd3', 'h6', 'g3', 'a5', 'b3', 'h5', 'h3'])
    expect(e.calls).toHaveLength(5)
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test.each(['budget', 'fatal'] as const)('%s ends the game as claude-unavailable, with no fallback', async (kind) => {
    const e = fakeEngine()
    const cl = fakeClaude(() => ({ ok: false, kind }))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable', winner: null })
    expect(cl.move).toHaveBeenCalledTimes(1)
    expect(e.calls).toHaveLength(0)
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('when even the Stockfish fallback fails, the game ends as claude-unavailable (not engine-error)', async () => {
    const e = fakeEngine()
    const cl = fakeClaude(() => RETRY)
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.reject(new Error('worker died'))
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable' })
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('an illegal fallback move also ends the game as claude-unavailable, never counted as an engine move', async () => {
    const e = fakeEngine()
    const cl = fakeClaude(() => RETRY)
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable' })
    expect(sans(c)).toEqual([])
    expect(e.calls).toHaveLength(1) // not re-requested like an engine move
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('without a ClaudeMover a Claude seat cannot move: claude-unavailable', async () => {
    const c = new MatchController({ engine: fakeEngine().client })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable' })
  })

  test('pause during an in-flight move, then resume: the held reply is played without a second move() call', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    c.pause()
    cl.calls[0]?.resolve(ok('c4', 0.02))
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual([]) // held, not played while paused
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })

    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['c4'])
    expect(c.snapshot().claude.notes[0]).toEqual({ why: 'because c4', fallback: false })
    expect(c.snapshot().claude.spentUsd).toBe(0.02)
    // One call for White's move, then Black's own ask.
    expect(cl.calls.map((x) => x.req.history)).toEqual([[], ['c4']])
  })

  test('resume before the in-flight reply lands waits for that reply instead of asking again', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    c.pause()
    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.move).toHaveBeenCalledTimes(1)
    cl.calls[0]?.resolve(ok('e4'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4'])
    expect(cl.calls.map((x) => x.req.history)).toEqual([[], ['e4']])
  })

  test('undo during an in-flight move drops that reply', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    cl.calls[0]?.resolve(ok('e4'))
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.calls).toHaveLength(2) // Black is thinking about 1.e4

    c.undo() // zero-player: one ply, then paused
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
    cl.calls[1]?.resolve(ok('e5'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual([])

    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(cl.calls).toHaveLength(3)
    expect(cl.calls[2]?.req).toEqual({ history: [] })
    expect(sans(c)).toEqual([])
    expect(illegalEngineMovesOf(c)).toBe(0)
  })

  test('a held reply is discarded by undo: the next ask calls move() again', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    cl.calls[0]?.resolve(ok('e4'))
    await vi.advanceTimersByTimeAsync(0)
    c.pause()
    cl.calls[1]?.resolve(ok('e5')) // held for the position after 1.e4
    await vi.advanceTimersByTimeAsync(0)

    c.undo() // back to the start: the held reply no longer answers anything
    c.redo() // ...and forward again to the very same FEN: still discarded
    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4'])
    expect(cl.calls).toHaveLength(3)
    expect(cl.calls[2]?.req).toEqual({ history: ['e4'] })
  })

  test('an undo with nothing to take back keeps the held reply: the live position did not change', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    c.pause()
    c.undo() // ply 0: nothing to undo; zero-player stays paused
    cl.calls[0]?.resolve(ok('e4'))
    await vi.advanceTimersByTimeAsync(0)
    c.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4'])
    expect(cl.calls.map((x) => x.req.history)).toEqual([[], ['e4']])
  })

  test('a reply from the previous game never lands in, or bills, the new one', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    c.start(CLAUDE_VS_CLAUDE) // same start FEN as the old ask
    await vi.advanceTimersByTimeAsync(0)
    cl.calls[0]?.resolve(ok('e4', 0.5))
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual([])
    expect(c.snapshot().claude.spentUsd).toBe(0)
    cl.calls[1]?.resolve(ok('d4', 0.01))
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['d4'])
    expect(c.snapshot().claude.spentUsd).toBe(0.01)
  })

  test('a new game resets notes, spend and fallback counts', async () => {
    const e = fakeEngine()
    const cl = fakeClaude((_req, n) => (n < 2 ? RETRY : n === 2 ? ok('e5', 0.1) : undefined))
    const c = new MatchController({ engine: e.client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().claude).toMatchObject({ spentUsd: 0.1, fallbacks: { w: 1, b: 0 } })

    c.start(CLAUDE_VS_CLAUDE)
    expect(c.snapshot().claude).toEqual({ notes: {}, spentUsd: 0, fallbacks: { w: 0, b: 0 } })
  })

  test('step() on a Claude turn lets exactly one Claude move through', async () => {
    const cl = fakeClaude(playLine(['e4', 'e5', 'Nf3', 'Nc6']))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(CLAUDE_VS_CLAUDE)
    c.pause()
    await vi.advanceTimersByTimeAsync(0) // the dropped first ask is now held
    expect(sans(c)).toEqual([])

    c.step()
    expect(c.snapshot().phase).toMatchObject({ kind: 'engine-thinking', side: 'w' })
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4'])
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
    expect(cl.move).toHaveBeenCalledTimes(1) // the step consumed the held reply

    c.step()
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
    expect(cl.move).toHaveBeenCalledTimes(2)
  })

  test('speed pacing (engineDelayMs) applies to Claude moves', async () => {
    const cl = fakeClaude(playLine(['e4']))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start({ ...CLAUDE_VS_CLAUDE, engineDelayMs: 500 })
    await vi.advanceTimersByTimeAsync(499)
    expect(sans(c)).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(sans(c)).toEqual(['e4'])
  })

  test('a reply that lands during the pacing delay after a pause is still held for resume', async () => {
    const cl = fakeClaude(playLine(['e4']))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start({ ...CLAUDE_VS_CLAUDE, engineDelayMs: 500 })
    await vi.advanceTimersByTimeAsync(100)
    c.pause()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sans(c)).toEqual([])
    c.resume()
    await vi.advanceTimersByTimeAsync(500)
    expect(sans(c)).toEqual(['e4'])
    expect(cl.calls.map((x) => x.req.history)).toEqual([[], ['e4']])
  })

  test('human vs Claude: undo pops back to the human\'s turn (Claude counts as a bot seat)', async () => {
    const cl = fakeClaude(playLine(['e4', 'e5']))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(HUMAN_VS_CLAUDE)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['e4', 'e5'])
    expect(c.snapshot().claude.notes).toEqual({ 1: { why: 'because e5', fallback: false } })

    c.undo()
    expect(sans(c)).toEqual([])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
    // Redo restores the recorded plies, and with them Claude's note.
    c.redo()
    expect(sans(c)).toEqual(['e4', 'e5'])
    expect(c.snapshot().claude.notes).toEqual({ 1: { why: 'because e5', fallback: false } })
  })

  test('a different move played over an undone Claude ply drops that ply\'s stale note', async () => {
    const cl = fakeClaude((req) => (req.history.length === 1 && req.history[0] === 'e4' ? ok('e5') : undefined))
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(HUMAN_VS_CLAUDE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().claude.notes).toEqual({ 1: { why: 'because e5', fallback: false } })
    c.undo()
    c.submitHumanMove({ from: 'd2', to: 'd4' })
    c.redo() // nothing to redo: the new move replaced that future
    await vi.advanceTimersByTimeAsync(0)
    expect(sans(c)).toEqual(['d4'])
    expect(c.snapshot().claude.notes).toEqual({})
  })

  test('the claude snapshot keeps its identity until it changes, and snapshot() between emits', async () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
    c.start(HUMAN_VS_CLAUDE)
    const before = c.snapshot()
    expect(c.snapshot()).toBe(before)
    c.submitHumanMove({ from: 'e2', to: 'e4' }) // a human move: nothing Claude-side changed
    expect(c.snapshot()).not.toBe(before)
    expect(c.snapshot().claude).toBe(before.claude)

    await vi.advanceTimersByTimeAsync(0)
    cl.calls[0]?.resolve(ok('e5', 0.01))
    await vi.advanceTimersByTimeAsync(0)
    const after = c.snapshot()
    expect(after.claude).not.toBe(before.claude)
    expect(c.snapshot()).toBe(after)
    c.pause()
    expect(c.snapshot().claude).toBe(after.claude)
  })
})

describe('load(..., { paused: true })', () => {
  test('a Claude game loaded paused makes no move() call until resume()', async () => {
    const eng = fakeEngine()
    const { move, mover } = fakeClaude()
    const c = new MatchController({ engine: eng.client, claude: mover })
    const game = new Game()
    game.play({ from: 'e2', to: 'e4' })
    expect(c.load(HUMAN_VS_CLAUDE, game, { paused: true })).toBe(true)
    await Promise.resolve()
    expect(c.snapshot().phase).toEqual({ kind: 'paused' })
    expect(move).not.toHaveBeenCalled()
    expect(mover.begin).not.toHaveBeenCalled()

    c.resume()
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    expect(move).toHaveBeenCalledTimes(1)
  })

  test('loading without the option still asks Claude at once', () => {
    const eng = fakeEngine()
    const { move, mover } = fakeClaude()
    const c = new MatchController({ engine: eng.client, claude: mover })
    const game = new Game()
    game.play({ from: 'e2', to: 'e4' })
    c.load(HUMAN_VS_CLAUDE, game)
    expect(move).toHaveBeenCalledTimes(1)
  })
})

/**
 * A legal line of `n` plies that never ends the game by the rules: at each
 * ply, the first move (from a rotating start) that leaves it in progress.
 */
function longLine(n: number): string[] {
  const pos = new Position(STARTING_FEN)
  const line: string[] = []
  for (let ply = 0; ply < n; ply++) {
    const legal = pos.legalSans()
    let played = false
    for (let i = 0; i < legal.length && !played; i++) {
      const san = legal[(ply * 7 + i) % legal.length]!
      if (!pos.trySan(san).ok) continue
      if (pos.status().kind === 'in-progress') {
        line.push(san)
        played = true
      } else {
        pos.undo()
      }
    }
    if (!played) throw new Error(`longLine: stuck at ply ${ply}`)
  }
  return line
}

/** A Game holding `line` from the standard start. */
function gameOf(line: string[]): Game {
  const game = new Game()
  const pos = new Position(STARTING_FEN)
  for (const san of line) {
    const r = pos.trySan(san)
    if (!r.ok) throw new Error(san)
    game.play({ from: r.move.from, to: r.move.to, ...(r.move.promotion ? { promotion: r.move.promotion } : {}) })
  }
  return game
}

describe('adjudication at the ply cap (Q12: 160)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  // Replaying 160 plies through Game is seconds of chess.js work per test,
  // so the behaviour is driven at a small injected cap; the default is
  // asserted to be the shared 160 separately.
  const CAP = 8

  test('the default cap is the shared CLAUDE_MAX_PLIES, 160 (the server backstop uses the same constant)', () => {
    expect(CLAUDE_MAX_PLIES).toBe(160)
    const c = new MatchController({ engine: fakeEngine().client })
    expect((c as unknown as { claudePlyCap: number }).claudePlyCap).toBe(CLAUDE_MAX_PLIES)
  })

  test('a Claude game that reaches the cap is drawn by adjudication; Claude is never asked for the next ply', async () => {
    const e = fakeEngine()
    const cl = fakeClaude(playLine(longLine(CAP + 10)))
    const c = new MatchController({ engine: e.client, claude: cl.mover, claudePlyCap: CAP })
    c.start(CLAUDE_VS_CLAUDE)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves).toHaveLength(CAP)
    expect(cl.move).toHaveBeenCalledTimes(CAP)
    const phase = c.snapshot().phase
    expect(phase).toMatchObject({ kind: 'finished', reason: 'adjudicated', winner: null })
    expect(resultTagOf(phase)).toBe('1/2-1/2')
    expect(e.calls).toHaveLength(0)
  })

  test('loading a Claude game already at the cap adjudicates it at once, asking nothing', () => {
    const cl = fakeClaude()
    const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover, claudePlyCap: CAP })
    c.load(CLAUDE_VS_CLAUDE, gameOf(longLine(CAP)))
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'adjudicated', winner: null })
    expect(cl.move).not.toHaveBeenCalled()
  })

  test('a paused Claude game at the cap is adjudicated on Resume, and on Step', () => {
    for (const act of ['resume', 'step'] as const) {
      const cl = fakeClaude()
      const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover, claudePlyCap: CAP })
      c.load(CLAUDE_VS_CLAUDE, gameOf(longLine(CAP)), { paused: true })
      expect(c.snapshot().phase).toMatchObject({ kind: 'paused' })
      c[act]()
      expect(c.snapshot().phase, act).toMatchObject({ kind: 'finished', reason: 'adjudicated', winner: null })
      expect(cl.move).not.toHaveBeenCalled()
    }
  })

  test('finishAs replays a stored adjudication (no winner)', () => {
    const c = new MatchController({ engine: fakeEngine().client })
    c.load({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }, gameOf(['e4', 'e5']))
    c.finishAs('adjudicated', null)
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'adjudicated', winner: null })
  })

  test('a game with no Claude seat is not adjudicated at the cap', () => {
    const c = new MatchController({ engine: fakeEngine().client, claudePlyCap: CAP })
    c.load({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }, gameOf(longLine(CAP)))
    expect(c.snapshot().phase).toMatchObject({ kind: 'awaiting-human' })
  })
})

describe('why a Claude game stopped', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a budget reply finishes claude-unavailable with detail budget; fatal has no detail', async () => {
    for (const kind of ['budget', 'fatal'] as const) {
      const cl = fakeClaude(() => ({ ok: false, kind }))
      const c = new MatchController({ engine: fakeEngine().client, claude: cl.mover })
      c.start(CLAUDE_VS_CLAUDE)
      await vi.advanceTimersByTimeAsync(0)
      const phase = c.snapshot().phase
      expect(phase).toMatchObject({ kind: 'finished', reason: 'claude-unavailable' })
      expect(phase.kind === 'finished' && phase.detail).toBe(kind === 'budget' ? 'budget' : undefined)
    }
  })
})
