/**
 * The report's numbers, computed from the saved games and their analysis.
 * Pure: no engine, no network. Every figure here is a count or an average
 * over the games; the style commentary (./commentary) is given only these.
 */
import { CLAUDE_MODELS, type ClaudeModelKey } from '../../src/claude/models'
import { Position } from '../../src/game-core/position'
import type { OpeningBook } from '../../src/openings/book'
import { BLUNDER, INACCURACY, MISTAKE, type GameAnalysis, type Phase } from './analyze'
import type { GameRecord, Termination } from './types'

/** A mover's score of at least this (centipawns) before the move counts as ahead; minus it, behind. */
export const AHEAD_CP = 150
/** Queens both off the board by this ply counts as an early queen trade. */
export const EARLY_QUEEN_TRADE_PLY = 40

export interface Record3 {
  games: number
  wins: number
  draws: number
  losses: number
  /** Wins plus half the draws. */
  points: number
}

export interface Accuracy {
  /** Model moves analysed (fallbacks excluded: those were Stockfish's). */
  moves: number
  avgCpl: number | null
  blunders: number
  mistakes: number
  inaccuracies: number
  /** Share of moves that were Stockfish's own first choice. */
  bestMoveShare: number | null
}

export interface ModelStats {
  model: ClaudeModelKey
  label: string
  record: Record3 & { unfinished: number; scorePct: number | null }
  asWhite: Record3
  asBlack: Record3
  vs: Partial<Record<ClaudeModelKey, Record3>>
  speed: { meanSec: number | null; medianSec: number | null; p90Sec: number | null; maxSec: number | null; moves: number }
  /** `ownSecPerGame`: its own (non-fallback) move time, summed per game and averaged; `gameMinutes`: its games' mean wall time. */
  time: { ownSecPerGame: number | null; gameMinutes: number | null }
  cost: { totalUsd: number; perGameUsd: number | null; perMoveUsd: number | null; inputTokens: number; outputTokens: number; calls: number }
  reliability: { fallbacks: number; timeouts: number; rateLimited: number; illegalReplies: number; unavailableGames: number }
  avgGamePlies: number | null
  endings: {
    matesGiven: number
    matesReceived: number
    adjudicatedWins: number
    adjudicatedLosses: number
    adjudicatedDraws: number
    repetitions: number
    stalemates: number
    fiftyMove: number
    insufficientMaterial: number
    unfinished: number
  }
  openings: { white: Array<{ name: string; count: number }>; black: Array<{ name: string; count: number }> }
  accuracy: Accuracy & { byPhase: Record<Phase, Accuracy>; whenAhead: Accuracy; whenLevel: Accuracy; whenBehind: Accuracy }
  style: {
    /** Per own move (fallbacks included: they are on the board in its name). */
    captureRate: number | null
    checkRate: number | null
    pawnMoveShare: number | null
    castledGames: number
    castledRate: number | null
    avgCastleMoveNumber: number | null
    kingsideCastles: number
    queensideCastles: number
    earlyQueenTradeGames: number
    earlyQueenTradeRate: number | null
    /** Early queen trades where this model took the first queen. */
    queenTradesStarted: number
    /** Own moves that recreated a position already seen in the game. */
    repeatingMoves: number
    repeatingMoveShare: number | null
    repetitionDraws: number
  }
}

export interface TrialStats {
  models: ClaudeModelKey[]
  games: number
  finishedGames: number
  perModel: ModelStats[]
  /** Points of row vs column, and games. */
  cross: Partial<Record<ClaudeModelKey, Partial<Record<ClaudeModelKey, Record3>>>>
  leaderboard: Array<{ rank: number; model: ClaudeModelKey; scorePct: number | null; points: number; games: number; avgCpl: number | null }>
  terminations: Partial<Record<Termination, number>>
  field: { avgCpl: number | null; medianSec: number | null; captureRate: number | null; checkRate: number | null; pawnMoveShare: number | null; castledRate: number | null }
}

const zero3 = (): Record3 => ({ games: 0, wins: 0, draws: 0, losses: 0, points: 0 })
const add3 = (r: Record3, outcome: 'w' | 'd' | 'l') => {
  r.games++
  if (outcome === 'w') (r.wins++, (r.points += 1))
  else if (outcome === 'd') (r.draws++, (r.points += 0.5))
  else r.losses++
}
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length / 2
  return s.length % 2 ? s[Math.floor(mid)]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Nearest-rank percentile. */
export function percentile(xs: readonly number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!
}

function accuracyOf(cpls: readonly { cpl: number; best: boolean }[]): Accuracy {
  return {
    moves: cpls.length,
    avgCpl: mean(cpls.map((c) => c.cpl)),
    blunders: cpls.filter((c) => c.cpl >= BLUNDER).length,
    mistakes: cpls.filter((c) => c.cpl >= MISTAKE && c.cpl < BLUNDER).length,
    inaccuracies: cpls.filter((c) => c.cpl >= INACCURACY && c.cpl < MISTAKE).length,
    bestMoveShare: ratio(cpls.filter((c) => c.best).length, cpls.length),
  }
}

/** The replayed game with what the style signals need per ply. */
function replay(g: GameRecord) {
  const pos = new Position()
  const seen = new Map<string, number>([[pos.epd(), 1]])
  let queensOffAt: number | null = null
  let firstQueenTakenBy: 'w' | 'b' | null = null
  const plies: Array<{ side: 'w' | 'b'; capture: boolean; check: boolean; pawn: boolean; castle: 'k' | 'q' | null; repeats: boolean; uci: string }> = []
  for (const m of g.moves) {
    const r = pos.trySan(m.san)
    if (!r.ok) break
    const mv = r.move
    if (mv.captured === 'q' && firstQueenTakenBy === null) firstQueenTakenBy = mv.color
    const epd = pos.epd()
    const n = (seen.get(epd) ?? 0) + 1
    seen.set(epd, n)
    const placement = pos.fen().split(' ')[0]!
    if (queensOffAt === null && !placement.includes('Q') && !placement.includes('q')) queensOffAt = m.ply
    plies.push({
      side: mv.color,
      capture: mv.isCapture,
      check: /[+#]$/.test(mv.san),
      pawn: mv.piece === 'p',
      castle: mv.isCastle ? (mv.san.startsWith('O-O-O') ? 'q' : 'k') : null,
      repeats: n > 1,
      uci: `${mv.from}${mv.to}${mv.promotion ?? ''}`,
    })
  }
  return { plies, queensOffAt, firstQueenTakenBy }
}

function outcomeFor(g: GameRecord, side: 'w' | 'b'): 'w' | 'd' | 'l' | null {
  if (g.result === '*') return null
  if (g.result === '1/2-1/2') return 'd'
  return (g.result === '1-0') === (side === 'w') ? 'w' : 'l'
}

/** "B20 Sicilian Defense" for the deepest named position the game reached, or "(unnamed)". */
function openingName(g: GameRecord, book: OpeningBook | null): string {
  if (!book) return '(no opening data)'
  const pos = new Position()
  const epds = [pos.epd()]
  for (const m of g.moves.slice(0, book.maxPly)) {
    if (!pos.trySan(m.san).ok) break
    epds.push(pos.epd())
  }
  const hit = book.identify(epds)
  return hit ? `${hit.eco} ${hit.name}` : '(unnamed)'
}

const tally = (names: string[]) =>
  [...names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>())]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

export function computeStats(
  models: readonly ClaudeModelKey[],
  games: readonly GameRecord[],
  analyses: ReadonlyMap<string, GameAnalysis>,
  book: OpeningBook | null = null,
): TrialStats {
  const replays = new Map(games.map((g) => [g.gameId, replay(g)]))
  const cross: TrialStats['cross'] = {}
  const terminations: TrialStats['terminations'] = {}
  for (const g of games) terminations[g.termination] = (terminations[g.termination] ?? 0) + 1

  const perModel = models.map((model): ModelStats => {
    const mine = games.filter((g) => g.white === model || g.black === model)
    const record = { ...zero3(), unfinished: 0, scorePct: null as number | null }
    const asWhite = zero3()
    const asBlack = zero3()
    const vs: ModelStats['vs'] = {}
    const endings: ModelStats['endings'] = {
      matesGiven: 0,
      matesReceived: 0,
      adjudicatedWins: 0,
      adjudicatedLosses: 0,
      adjudicatedDraws: 0,
      repetitions: 0,
      stalemates: 0,
      fiftyMove: 0,
      insufficientMaterial: 0,
      unfinished: 0,
    }
    const reliability = { fallbacks: 0, timeouts: 0, rateLimited: 0, illegalReplies: 0, unavailableGames: 0 }
    const cost = { totalUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 }
    const msPerMove: number[] = []
    const ownMsPerGame: number[] = []
    let ownMoves = 0
    const cpls: Array<{ cpl: number; best: boolean; phase: Phase; before: number }> = []
    const style = { captures: 0, checks: 0, pawns: 0, castled: 0, castleMoves: [] as number[], k: 0, q: 0, early: 0, started: 0, repeating: 0 }
    const openingsW: string[] = []
    const openingsB: string[] = []

    for (const g of mine) {
      const side = g.white === model ? 'w' : 'b'
      const opp = side === 'w' ? g.black : g.white
      const t = g.totals[side]
      cost.totalUsd += t.costUsd
      cost.inputTokens += t.inputTokens
      cost.outputTokens += t.outputTokens
      cost.calls += t.calls
      reliability.fallbacks += t.fallbacks
      reliability.timeouts += t.timeouts
      reliability.rateLimited += t.rateLimited
      reliability.illegalReplies += t.illegalReplies
      if (g.termination === 'model-unavailable' && g.unavailable?.side === side) reliability.unavailableGames++

      const o = outcomeFor(g, side)
      if (o === null) {
        record.unfinished++
        endings.unfinished++
      } else {
        add3(record, o)
        add3(side === 'w' ? asWhite : asBlack, o)
        add3((vs[opp] ??= zero3()), o)
        add3(((cross[model] ??= {})[opp] ??= zero3()), o)
        if (g.termination === 'checkmate') o === 'w' ? endings.matesGiven++ : endings.matesReceived++
        if (g.termination === 'adjudicated') {
          if (o === 'w') endings.adjudicatedWins++
          else if (o === 'l') endings.adjudicatedLosses++
          else endings.adjudicatedDraws++
        }
        if (g.termination === 'threefold-repetition') endings.repetitions++
        if (g.termination === 'stalemate') endings.stalemates++
        if (g.termination === 'fifty-move-rule') endings.fiftyMove++
        if (g.termination === 'insufficient-material') endings.insufficientMaterial++
      }
      ;(side === 'w' ? openingsW : openingsB).push(openingName(g, book))

      let ownMs = 0
      for (const m of g.moves) {
        if (m.side !== side) continue
        ownMoves++
        if (!m.fallback) {
          msPerMove.push(m.ms)
          ownMs += m.ms
        }
      }
      ownMsPerGame.push(ownMs)
      const rp = replays.get(g.gameId)!
      let castledHere = false
      rp.plies.forEach((p, i) => {
        if (p.side !== side) return
        if (p.capture) style.captures++
        if (p.check) style.checks++
        if (p.pawn) style.pawns++
        if (p.repeats) style.repeating++
        if (p.castle && !castledHere) {
          castledHere = true
          style.castleMoves.push(Math.ceil((i + 1) / 2))
          p.castle === 'k' ? style.k++ : style.q++
        }
      })
      if (castledHere) style.castled++
      if (rp.queensOffAt !== null && rp.queensOffAt <= EARLY_QUEEN_TRADE_PLY) {
        style.early++
        if (rp.firstQueenTakenBy === side) style.started++
      }
      const a = analyses.get(g.gameId)
      for (const p of a?.plies ?? []) {
        if (p.side !== side || p.fallback) continue
        const played = rp.plies[p.ply - 1]?.uci
        cpls.push({ cpl: p.cpl, best: p.best !== null && p.best === played, phase: p.phase, before: p.before })
      }
    }

    const finished = record.games
    record.scorePct = finished ? (100 * record.points) / finished : null
    const phases: Phase[] = ['opening', 'middlegame', 'endgame']
    const byPhase = Object.fromEntries(phases.map((ph) => [ph, accuracyOf(cpls.filter((c) => c.phase === ph))])) as Record<Phase, Accuracy>
    return {
      model,
      label: CLAUDE_MODELS[model].label,
      record,
      asWhite,
      asBlack,
      vs,
      speed: {
        meanSec: mean(msPerMove) === null ? null : mean(msPerMove)! / 1000,
        medianSec: median(msPerMove) === null ? null : median(msPerMove)! / 1000,
        p90Sec: percentile(msPerMove, 0.9) === null ? null : percentile(msPerMove, 0.9)! / 1000,
        maxSec: msPerMove.length ? Math.max(...msPerMove) / 1000 : null,
        moves: msPerMove.length,
      },
      time: {
        ownSecPerGame: mean(ownMsPerGame) === null ? null : mean(ownMsPerGame)! / 1000,
        gameMinutes: mean(mine.map((g) => g.wallMs)) === null ? null : mean(mine.map((g) => g.wallMs))! / 60_000,
      },
      cost: { ...cost, perGameUsd: ratio(cost.totalUsd, mine.length), perMoveUsd: ratio(cost.totalUsd, ownMoves) },
      reliability,
      avgGamePlies: mean(mine.map((g) => g.plies)),
      endings,
      openings: { white: tally(openingsW), black: tally(openingsB) },
      accuracy: {
        ...accuracyOf(cpls),
        byPhase,
        whenAhead: accuracyOf(cpls.filter((c) => c.before >= AHEAD_CP)),
        whenLevel: accuracyOf(cpls.filter((c) => c.before > -AHEAD_CP && c.before < AHEAD_CP)),
        whenBehind: accuracyOf(cpls.filter((c) => c.before <= -AHEAD_CP)),
      },
      style: {
        captureRate: ratio(style.captures, ownMoves),
        checkRate: ratio(style.checks, ownMoves),
        pawnMoveShare: ratio(style.pawns, ownMoves),
        castledGames: style.castled,
        castledRate: ratio(style.castled, mine.length),
        avgCastleMoveNumber: mean(style.castleMoves),
        kingsideCastles: style.k,
        queensideCastles: style.q,
        earlyQueenTradeGames: style.early,
        earlyQueenTradeRate: ratio(style.early, mine.length),
        queenTradesStarted: style.started,
        repeatingMoves: style.repeating,
        repeatingMoveShare: ratio(style.repeating, ownMoves),
        repetitionDraws: endings.repetitions,
      },
    }
  })

  const leaderboard = [...perModel]
    .sort(
      (a, b) =>
        (b.record.scorePct ?? -1) - (a.record.scorePct ?? -1) ||
        (a.accuracy.avgCpl ?? Infinity) - (b.accuracy.avgCpl ?? Infinity) ||
        a.model.localeCompare(b.model),
    )
    .map((m, i) => ({ rank: i + 1, model: m.model, scorePct: m.record.scorePct, points: m.record.points, games: m.record.games, avgCpl: m.accuracy.avgCpl }))

  const allMs = games.flatMap((g) => g.moves.filter((m) => !m.fallback).map((m) => m.ms))
  const allCpl = [...analyses.values()].flatMap((a) => a.plies.filter((p) => !p.fallback).map((p) => p.cpl))
  const fieldRate = (pick: (s: ModelStats['style']) => number | null) => mean(perModel.map((m) => pick(m.style)).filter((x): x is number => x !== null))
  return {
    models: [...models],
    games: games.length,
    finishedGames: games.filter((g) => g.result !== '*').length,
    perModel,
    cross,
    leaderboard,
    terminations,
    field: {
      avgCpl: mean(allCpl),
      medianSec: median(allMs) === null ? null : median(allMs)! / 1000,
      captureRate: fieldRate((s) => s.captureRate),
      checkRate: fieldRate((s) => s.checkRate),
      pawnMoveShare: fieldRate((s) => s.pawnMoveShare),
      castledRate: fieldRate((s) => s.castledRate),
    },
  }
}
