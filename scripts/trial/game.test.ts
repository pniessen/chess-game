// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { ClaudeModelKey } from '../../src/claude/models'
import type { MoveOutcome } from '../../server/claudeMove'
import type { MissingKey, MoveRequest } from '../../server/moveDispatch'
import { Position } from '../../src/game-core/position'
import { STARTING_FEN } from '../../src/game-core/types'
import { BACKOFF_MS, playGame, type PlayDeps } from './game'
import type { CallRecord, Score } from './types'
import type { TrialEngine } from './stockfish'

const ok = (san: string, cost = 0.001): MoveOutcome => ({
  ok: true,
  san,
  why: `Plays ${san}.`,
  costUsd: cost,
  ms: 1000,
  tokens: { inputTokens: 300, outputTokens: 20 },
})
const failed = (kind: Extract<MoveOutcome, { ok: false }>['kind'], cost = 0): MoveOutcome => ({
  ok: false,
  kind,
  costUsd: cost,
  ms: 45_000,
  tokens: { inputTokens: kind === 'timeout' ? 400 : 0, outputTokens: kind === 'timeout' ? 8000 : 0 },
})

/** Plays `script` in order (one entry per call); after it runs out, the first legal move. */
function scripted(script: Array<MoveOutcome | { missing: MissingKey }> = []) {
  const reqs: MoveRequest[] = []
  const move = async (req: MoveRequest) => {
    reqs.push(req)
    const next = script.shift()
    if (next && 'missing' in next) return next
    if (next) return { outcome: next }
    const pos = new Position(req.startFen ?? STARTING_FEN)
    for (const s of req.history) pos.trySan(s)
    return { outcome: ok(pos.legalSans()[0]!) }
  }
  return { move, reqs }
}

function fakeEngine(score: Score = { cp: 0 }) {
  const calls = { evaluate: 0, fallback: 0 }
  const engine: TrialEngine = {
    async evaluate() {
      calls.evaluate++
      return { score, best: null }
    },
    async fallbackMove(fen) {
      calls.fallback++
      const m = new Position(fen).legalMoves()[0]!
      return `${m.from}${m.to}${m.promotion ?? ''}`
    },
  }
  return { engine, calls }
}

function deps(over: Partial<PlayDeps> & Pick<PlayDeps, 'move'>, engine = fakeEngine().engine) {
  const charged: CallRecord[] = []
  const slept: number[] = []
  const d: PlayDeps = {
    trialId: 't',
    maxPlies: 160,
    engine: async () => engine,
    charge: async (_m, _g, call) => {
      charged.push(call)
    },
    mayCall: () => true,
    sleep: async (ms) => {
      slept.push(ms)
    },
    log: () => {},
    spentUsd: () => 0,
    ...over,
  }
  return { d, charged, slept }
}

const spec = (white: ClaudeModelKey = 'haiku', black: ClaudeModelKey = 'jev') => ({
  id: `${white}-${black}-1`,
  pair: `${white}|${black}`,
  round: 1,
  white,
  black,
})

describe('playGame: the ending rules', () => {
  test('checkmate ends the game for the side that mates (fool\'s mate)', async () => {
    const { move, reqs } = scripted(['f3', 'e5', 'g4', 'Qh4#'].map((s) => ok(s)))
    const { d } = deps({ move })
    const g = await playGame(spec(), d)
    expect(g).toMatchObject({ result: '0-1', winner: 'b', termination: 'checkmate', plies: 4 })
    expect(g.moves.map((m) => [m.side, m.model])).toEqual([['w', 'haiku'], ['b', 'jev'], ['w', 'haiku'], ['b', 'jev']])
    expect(reqs.map((r) => r.history.length)).toEqual([0, 1, 2, 3])
    expect(g.pgn).toContain('[Result "0-1"]')
    expect(g.pgn).toContain('Qh4#')
  })

  test('threefold repetition is a draw', async () => {
    const { move } = scripted(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].map((s) => ok(s)))
    const g = await playGame(spec(), deps({ move }).d)
    expect(g).toMatchObject({ result: '1/2-1/2', winner: null, termination: 'threefold-repetition', plies: 8 })
  })

  test('stalemate, insufficient material and the fifty-move rule are draws', async () => {
    const cases: Array<[string, string, string]> = [
      ['k7/8/8/1Q6/8/8/8/7K w - - 0 1', 'Qb6', 'stalemate'],
      ['k7/8/8/8/8/8/1r6/K6N w - - 0 1', 'Kxb2', 'insufficient-material'],
      ['k7/8/8/8/8/8/8/K6R w - - 99 80', 'Rh2', 'fifty-move-rule'],
    ]
    for (const [fen, san, termination] of cases) {
      const { move } = scripted([ok(san)])
      const g = await playGame(spec(), deps({ move, startFen: fen }).d)
      expect(g).toMatchObject({ result: '1/2-1/2', termination, plies: 1 })
    }
  })

  test('at the ply cap Stockfish adjudicates: 300 cp or more wins, less is a draw', async () => {
    for (const [score, result] of [
      [{ cp: 350 }, '1-0'],
      [{ cp: -299 }, '1/2-1/2'],
      [{ mate: -4 }, '0-1'],
    ] as Array<[Score, string]>) {
      const { engine, calls } = fakeEngine(score)
      const { move } = scripted()
      const g = await playGame(spec(), deps({ move, maxPlies: 6 }, engine).d)
      // After 6 plies White is to move, so the engine's score is White's.
      expect(g).toMatchObject({ result, termination: 'adjudicated', plies: 6 })
      expect(g.adjudication?.depth).toBe(18)
      expect(calls.evaluate).toBe(1)
    }
  })
})

describe('playGame: retries, fallbacks and the cap, as in the app', () => {
  test('one retry after a failure, then the model\'s move is played', async () => {
    const { move, reqs } = scripted([failed('illegal-reply', 0.002), ok('e4')])
    const { d, charged } = deps({ move, maxPlies: 1 })
    const g = await playGame(spec(), d)
    expect(reqs).toHaveLength(2)
    expect(g.moves[0]).toMatchObject({ san: 'e4', fallback: false, costUsd: 0.003 })
    expect(g.moves[0]!.calls.map((c) => c.kind)).toEqual(['illegal-reply', 'ok'])
    expect(charged).toHaveLength(2)
    expect(g.totals.w).toMatchObject({ calls: 2, illegalReplies: 1, fallbacks: 0, moves: 1 })
  })

  test('a second failure hands the move to Stockfish at the fallback level, counted against the model', async () => {
    const { move, reqs } = scripted([failed('timeout', 0.04), failed('upstream')])
    const { engine, calls } = fakeEngine()
    const g = await playGame(spec('opus', 'haiku'), deps({ move, maxPlies: 1 }, engine).d)
    expect(reqs).toHaveLength(2)
    expect(calls.fallback).toBe(1)
    expect(g.moves[0]).toMatchObject({ model: 'opus', fallback: true, why: '' })
    expect(g.totals.w).toMatchObject({ fallbacks: 1, timeouts: 1, calls: 2 })
    expect(g.totals.w.costUsd).toBeCloseTo(0.04)
  })

  test('five fallbacks by one side end the game with no winner (model-unavailable)', async () => {
    // White fails every time; Black plays its first legal move.
    let n = 0
    const move = async (req: MoveRequest) => {
      const white = req.history.length % 2 === 0
      n++
      if (white) return { outcome: failed('upstream') }
      const pos = new Position()
      for (const s of req.history) pos.trySan(s)
      return { outcome: ok(pos.legalSans()[0]!) }
    }
    const g = await playGame(spec(), deps({ move }).d)
    expect(n).toBeGreaterThan(0)
    expect(g).toMatchObject({ result: '*', winner: null, termination: 'model-unavailable', plies: 9 })
    expect(g.unavailable).toEqual({ side: 'w', reason: '5 fallbacks' })
    expect(g.totals.w.fallbacks).toBe(5)
  })

  test('rate limits back off and ask again without spending the one retry', async () => {
    const { move, reqs } = scripted([failed('rate-limited'), failed('rate-limited'), failed('timeout'), ok('d4')])
    const { d, slept } = deps({ move, maxPlies: 1 })
    const g = await playGame(spec(), d)
    expect(reqs).toHaveLength(4)
    expect(slept).toEqual([BACKOFF_MS[0], BACKOFF_MS[1]])
    expect(g.moves[0]).toMatchObject({ san: 'd4', fallback: false })
    expect(g.totals.w).toMatchObject({ rateLimited: 2, timeouts: 1 })
  })

  test('a missing or rejected key ends the game at once, as the app does', async () => {
    for (const first of [{ missing: 'no-gemini-auth' as const }, failed('auth')]) {
      const { move } = scripted([first])
      const g = await playGame(spec('gemini-pro', 'haiku'), deps({ move }).d)
      expect(g).toMatchObject({ result: '*', termination: 'model-unavailable', plies: 0 })
      expect(g.unavailable?.side).toBe('w')
    }
  })

  test('the hard cap stops the game before a call that might not fit', async () => {
    const { move, reqs } = scripted()
    let calls = 0
    const g = await playGame(spec(), deps({ move, mayCall: () => calls++ < 3 }).d)
    expect(reqs).toHaveLength(3)
    expect(g).toMatchObject({ result: '*', termination: 'cap', plies: 3 })
  })
})
