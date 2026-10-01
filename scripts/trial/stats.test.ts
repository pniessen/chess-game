// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { OpeningBook } from '../../src/openings/book'
import { parseOpeningsData } from '../../src/openings/data'
import type { GameAnalysis, PlyAnalysis } from './analyze'
import { computeStats, median, percentile } from './stats'
import { recordOf } from './testFixtures'
import type { GameRecord } from './types'

const FOOLS = ['f3', 'e5', 'g4', 'Qh4#']
const REPEAT = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']
// Queens off by ply 11 (Black took the first queen), both sides castle kingside on move 8.
const QGA = ['d4', 'd5', 'c4', 'dxc4', 'e3', 'e5', 'Bxc4', 'exd4', 'Qxd4', 'Qxd4', 'exd4', 'Nf6', 'Nf3', 'Bd6', 'O-O', 'O-O']

const games: GameRecord[] = [
  recordOf(FOOLS, { gameId: 'g1', white: 'haiku', black: 'jev', result: '0-1', winner: 'b', termination: 'checkmate' }),
  recordOf(REPEAT, { gameId: 'g2', white: 'jev', black: 'haiku', result: '1/2-1/2', termination: 'threefold-repetition' }),
  recordOf(QGA, {
    gameId: 'g3',
    white: 'haiku',
    black: 'gemini-flash',
    result: '1-0',
    winner: 'w',
    termination: 'adjudicated',
    adjudication: { depth: 18, evalCp: 420, mate: null },
  }),
  recordOf(['e4'], { gameId: 'g4', white: 'jev', black: 'gemini-flash', result: '*', termination: 'model-unavailable', unavailable: { side: 'b', reason: '5 fallbacks' } }),
]
// g4's Black never moved because it failed; and one of haiku's g3 moves was a fallback.
games[2]!.moves[14] = { ...games[2]!.moves[14]!, fallback: true }
games[2]!.totals.w = { ...games[2]!.totals.w, costUsd: 0.05, calls: 9, fallbacks: 1, timeouts: 2, inputTokens: 900, outputTokens: 90, moves: 8 }

/** An analysis whose CPLs (and scores before) are given per ply; best move = the move played where `best` says so. */
function analysis(g: GameRecord, cpl: Record<number, number>, before: Record<number, number> = {}): GameAnalysis {
  const plies: PlyAnalysis[] = g.moves.map((m) => ({
    ply: m.ply,
    side: m.side,
    model: m.model,
    san: m.san,
    fallback: m.fallback,
    phase: 'opening',
    best: cpl[m.ply] === 0 ? 'same' : null,
    before: before[m.ply] ?? 0,
    after: 0,
    cpl: cpl[m.ply] ?? 0,
  }))
  return { v: 1, gameId: g.gameId, depth: 14, movesKey: '', plies }
}

const analyses = new Map<string, GameAnalysis>([
  ['g1', analysis(games[0]!, { 1: 0, 2: 140, 3: 1000, 4: 0 })],
  // Haiku's g3 moves: plies 1..15 odd. Ply 15 was a fallback and is left out.
  ['g3', analysis(games[2]!, { 1: 300, 3: 299, 5: 100, 7: 99, 9: 50, 11: 49, 13: 0, 15: 999 }, { 1: 200, 3: 200, 5: -200, 7: -200 })],
])

const book = new OpeningBook(parseOpeningsData(JSON.parse(readFileSync('public/openings/openings.json', 'utf8')))!)
const s = computeStats(['haiku', 'jev', 'gemini-flash'], games, analyses, book)
const by = (m: string) => s.perModel.find((x) => x.model === m)!

describe('computeStats: results', () => {
  test('W/D/L and score, overall, by colour and against each opponent; unfinished games are not scored', () => {
    expect(by('haiku').record).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1, points: 1.5, unfinished: 0 })
    expect(by('haiku').record.scorePct).toBeCloseTo(50)
    expect(by('haiku').asWhite).toMatchObject({ games: 2, wins: 1, losses: 1 })
    expect(by('haiku').asBlack).toMatchObject({ games: 1, draws: 1 })
    expect(by('haiku').vs.jev).toMatchObject({ games: 2, wins: 0, draws: 1, losses: 1, points: 0.5 })
    expect(by('haiku').vs['gemini-flash']).toMatchObject({ games: 1, wins: 1, points: 1 })
    expect(by('jev').record).toMatchObject({ games: 2, wins: 1, draws: 1, unfinished: 1 })
    expect(by('gemini-flash').record).toMatchObject({ games: 1, losses: 1, unfinished: 1 })
    expect(s.cross.haiku?.jev).toMatchObject({ points: 0.5, games: 2 })
    expect(s.cross.jev?.haiku).toMatchObject({ points: 1.5, games: 2 })
    expect(s.leaderboard.map((l) => l.model)).toEqual(['jev', 'haiku', 'gemini-flash'])
    expect(s.finishedGames).toBe(3)
  })

  test('how games ended, from each side', () => {
    expect(by('jev').endings).toMatchObject({ matesGiven: 1, matesReceived: 0, repetitions: 1, unfinished: 1 })
    expect(by('haiku').endings).toMatchObject({ matesReceived: 1, adjudicatedWins: 1, repetitions: 1 })
    expect(by('gemini-flash').endings).toMatchObject({ adjudicatedLosses: 1, unfinished: 1 })
    expect(by('gemini-flash').reliability.unavailableGames).toBe(1)
    expect(by('jev').reliability.unavailableGames).toBe(0)
    expect(s.terminations).toEqual({ checkmate: 1, 'threefold-repetition': 1, adjudicated: 1, 'model-unavailable': 1 })
  })

  test('average game length, cost and reliability come from the saved totals', () => {
    expect(by('haiku').avgGamePlies).toBeCloseTo((4 + 8 + 16) / 3)
    expect(by('haiku').cost.totalUsd).toBeCloseTo(0.05)
    expect(by('haiku').cost.perGameUsd).toBeCloseTo(0.05 / 3)
    // Own moves: 2 + 4 + 8.
    expect(by('haiku').cost.perMoveUsd).toBeCloseTo(0.05 / 14)
    expect(by('haiku').reliability).toMatchObject({ fallbacks: 1, timeouts: 2 })
  })

  test('speed: per model move, fallbacks left out', () => {
    // Haiku's moves are timed 1000 x ply: g1 plies 1,3; g2 plies 2,4,6,8; g3 plies 1..13 odd (15 was a fallback).
    expect(by('haiku').speed.moves).toBe(13)
    expect(by('haiku').speed.maxSec).toBe(13)
  })

  test('openings by colour, by name from the repo\'s data', () => {
    expect(by('haiku').openings.white.map((o) => o.count).reduce((a, b) => a + b)).toBe(2)
    expect(by('haiku').openings.white.some((o) => /Queen's Gambit Accepted/.test(o.name))).toBe(true)
    expect(by('jev').openings.white.length).toBeGreaterThan(0)
  })
})

describe('computeStats: accuracy', () => {
  test('blunders >= 300, mistakes 100-299, inaccuracies 50-99; fallback moves are not the model\'s', () => {
    const a = by('haiku').accuracy
    // g1: 0, 1000; g3: 300, 299, 100, 99, 50, 49, 0 (999 at ply 15 was a fallback).
    expect(a.moves).toBe(9)
    expect(a.blunders).toBe(2)
    expect(a.mistakes).toBe(2)
    expect(a.inaccuracies).toBe(2)
    expect(a.avgCpl).toBeCloseTo((0 + 1000 + 300 + 299 + 100 + 99 + 50 + 49 + 0) / 9)
    expect(a.byPhase.opening.moves).toBe(9)
    expect(a.byPhase.middlegame.moves).toBe(0)
  })

  test('CPL when ahead (>= +150 before the move), level and behind', () => {
    const a = by('haiku').accuracy
    expect(a.whenAhead).toMatchObject({ moves: 2, avgCpl: 299.5 })
    expect(a.whenBehind).toMatchObject({ moves: 2, avgCpl: 99.5 })
    expect(a.whenLevel.moves).toBe(5)
  })
})

describe('computeStats: style signals', () => {
  test('captures, checks and pawn moves per own move', () => {
    const h = by('haiku').style
    // Haiku's 14 own moves: g1 f3 g4; g2 Nf6 Ng8 Nf6 Ng8; g3 d4 c4 e3 Bxc4 Qxd4 exd4 Nf3 O-O.
    expect(h.captureRate).toBeCloseTo(3 / 14)
    expect(h.pawnMoveShare).toBeCloseTo(6 / 14)
    expect(h.checkRate).toBe(0)
    // Jev's 7 own moves: g1 e5 Qh4#; g2 four knight moves; g4 e4.
    expect(by('jev').style.checkRate).toBeCloseTo(1 / 7)
  })

  test('castling rate and timing; early queen trades and who started them', () => {
    expect(by('haiku').style).toMatchObject({ castledGames: 1, kingsideCastles: 1, queensideCastles: 0, avgCastleMoveNumber: 8 })
    expect(by('haiku').style.castledRate).toBeCloseTo(1 / 3)
    expect(by('haiku').style).toMatchObject({ earlyQueenTradeGames: 1, queenTradesStarted: 0 })
    expect(by('gemini-flash').style).toMatchObject({ earlyQueenTradeGames: 1, queenTradesStarted: 1, castledGames: 1 })
  })

  test('repetition: moves that recreate an earlier position, and repetition draws', () => {
    // g2: Black's Ng8 (ply 4), Nf6 (6), Ng8 (8) repeat; White's Nf3 (5), Ng1 (7) do.
    expect(by('haiku').style).toMatchObject({ repeatingMoves: 3, repetitionDraws: 1 })
    expect(by('jev').style.repeatingMoves).toBe(2)
  })
})

describe('median and p90', () => {
  test('median averages the middle pair; p90 is nearest-rank', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
    expect(percentile([5], 0.9)).toBe(5)
  })
})
