/**
 * The report's "playing style" bullets: one Claude Opus 5.5 call per model,
 * given only that model's computed statistics, the field's averages and a few
 * short PGN excerpts, and told to claim nothing they do not support. Each
 * call is charged to the trial ledger as a "commentary" line and cached in
 * commentary/, keyed by its exact prompt, so a re-run of the report is free.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { CLAUDE_MODELS, costUsd } from '../../src/claude/models'
import { Position } from '../../src/game-core/position'
import type { PieceSymbol, Square } from '../../src/game-core/types'
import { moveLabel } from '../../src/review/moveNumber'
import type { MessagesClient } from '../../server/claude'
import { appendLedger } from './budget'
import type { GameAnalysis } from './analyze'
import type { ModelStats, TrialStats } from './stats'
import { readJson, writeJsonAtomic } from './store'
import type { GameRecord } from './types'

export const COMMENTARY_MODEL = 'opus' as const

const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100)
const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10)

/** The statistics the writer sees, rounded and labelled; nothing else about the games. */
export function styleFacts(m: ModelStats, field: TrialStats['field']) {
  const acc = (a: { moves: number; avgCpl: number | null; blunders: number; mistakes: number; inaccuracies: number }) => ({
    moves: a.moves,
    avgCpl: r2(a.avgCpl),
    blunders: a.blunders,
    mistakes: a.mistakes,
    inaccuracies: a.inaccuracies,
  })
  return {
    model: m.label,
    record: { games: m.record.games, wins: m.record.wins, draws: m.record.draws, losses: m.record.losses, unfinished: m.record.unfinished, scorePct: r2(m.record.scorePct) },
    asWhite: m.asWhite,
    asBlack: m.asBlack,
    secondsPerMove: { median: r2(m.speed.medianSec), p90: r2(m.speed.p90Sec) },
    reliability: m.reliability,
    averageGamePlies: r2(m.avgGamePlies),
    endings: m.endings,
    openingsAsWhite: m.openings.white.slice(0, 5),
    openingsAsBlack: m.openings.black.slice(0, 5),
    accuracy: {
      overall: { ...acc(m.accuracy), bestMovePct: pct(m.accuracy.bestMoveShare) },
      opening: acc(m.accuracy.byPhase.opening),
      middlegame: acc(m.accuracy.byPhase.middlegame),
      endgame: acc(m.accuracy.byPhase.endgame),
      whenAhead: acc(m.accuracy.whenAhead),
      whenLevel: acc(m.accuracy.whenLevel),
      whenBehind: acc(m.accuracy.whenBehind),
    },
    style: {
      capturePctOfMoves: pct(m.style.captureRate),
      checkPctOfMoves: pct(m.style.checkRate),
      pawnMovePctOfMoves: pct(m.style.pawnMoveShare),
      castledInPctOfGames: pct(m.style.castledRate),
      averageCastlingMoveNumber: r2(m.style.avgCastleMoveNumber),
      kingsideCastles: m.style.kingsideCastles,
      queensideCastles: m.style.queensideCastles,
      gamesWithQueensOffByPly40: m.style.earlyQueenTradeGames,
      ofThoseItTookTheFirstQueen: m.style.queenTradesStarted,
      movesRepeatingAnEarlierPosition: m.style.repeatingMoves,
      repetitionDraws: m.style.repetitionDraws,
    },
    fieldAverages: {
      avgCpl: r2(field.avgCpl),
      medianSecondsPerMove: r2(field.medianSec),
      capturePctOfMoves: pct(field.captureRate),
      checkPctOfMoves: pct(field.checkRate),
      pawnMovePctOfMoves: pct(field.pawnMoveShare),
      castledInPctOfGames: pct(field.castledRate),
    },
  }
}

const label = (ply: number, san: string) => moveLabel(ply, san, 'w')

/** Up to three short excerpts: the openings of one game per colour, and its costliest move in context. */
export function excerptsFor(m: ModelStats, games: readonly GameRecord[], analyses: ReadonlyMap<string, GameAnalysis>): string[] {
  const out: string[] = []
  for (const colour of ['white', 'black'] as const) {
    const g = games.find((x) => x[colour] === m.model && x.result !== '*')
    if (!g) continue
    const opp = CLAUDE_MODELS[colour === 'white' ? g.black : g.white].label
    out.push(
      `As ${colour === 'white' ? 'White' : 'Black'} vs ${opp} (${g.result}, ${g.termination}, ${g.plies} plies), first moves: ` +
        g.moves.slice(0, 12).map((x) => label(x.ply, x.san)).join(' '),
    )
  }
  let worst: { g: GameRecord; ply: number; cpl: number; best: string | null } | null = null
  for (const g of games) {
    for (const p of analyses.get(g.gameId)?.plies ?? []) {
      if (p.model !== m.model || p.fallback || (g.white !== m.model && g.black !== m.model)) continue
      if (!worst || p.cpl > worst.cpl) worst = { g, ply: p.ply, cpl: p.cpl, best: p.best }
    }
  }
  if (worst && worst.cpl >= 100) {
    const { g, ply } = worst
    const pos = new Position()
    for (const x of g.moves.slice(0, ply - 1)) pos.trySan(x.san)
    let bestSan: string | null = null
    if (worst.best) {
      const b = worst.best
      const r = pos.clone().tryMove({ from: b.slice(0, 2) as Square, to: b.slice(2, 4) as Square, ...(b[4] ? { promotion: b[4] as PieceSymbol } : {}) })
      if (r.ok) bestSan = r.move.san
    }
    const from = Math.max(1, ply - 4)
    const ctx = g.moves
      .slice(from - 1, ply + 2)
      .map((x) => (x.ply === ply ? `${label(x.ply, x.san)} {loses ${worst!.cpl} cp${bestSan ? `; Stockfish preferred ${bestSan}` : ''}}` : label(x.ply, x.san)))
      .join(' ')
    out.push(`Its costliest move (${CLAUDE_MODELS[g.white].label} vs ${CLAUDE_MODELS[g.black].label}): ${ctx}`)
  }
  return out
}

export function commentaryPrompt(facts: ReturnType<typeof styleFacts>, excerpts: readonly string[]): { system: string; user: string } {
  const system = [
    'You describe how a chess-playing AI model played in a round-robin trial, for a reader who is not a chess expert.',
    'Write 3 to 5 bullets on its playing style.',
    'Claim nothing the statistics or excerpts below do not support. Every bullet must rest on a number given here; cite it.',
    'Compare only with the field averages given. Do not guess at causes, training, intentions or strength beyond these numbers.',
    'If a figure comes from few games or moves, say the sample is small. Plain words; explain a chess term the first time you use it.',
    'Each bullet is one or two sentences.',
  ].join(' ')
  const user = [
    'Statistics (CPL = centipawn loss against Stockfish\'s best move: 100 cp is about a pawn; blunder >= 300, mistake 100-299, inaccuracy 50-99):',
    JSON.stringify(facts, null, 1),
    '',
    'PGN excerpts:',
    ...excerpts.map((e) => `- ${e}`),
  ].join('\n')
  return { system, user }
}

const FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: { bullets: { type: 'array', items: { type: 'string' } } },
    required: ['bullets'],
    additionalProperties: false,
  },
} as const

export interface Commentary {
  bullets: string[]
  costUsd: number
  cached: boolean
}

/** One model's bullets: from the cache when the prompt is unchanged, else one Opus call charged to the trial ledger. */
export async function writeCommentary(
  client: MessagesClient,
  dir: string,
  m: ModelStats,
  prompt: { system: string; user: string },
): Promise<Commentary> {
  const hash = createHash('sha256').update(prompt.system).update('\n').update(prompt.user).digest('hex')
  const file = join(dir, 'commentary', `${m.model}.json`)
  const cached = await readJson<{ hash: string; bullets: string[]; costUsd: number }>(file)
  if (cached?.hash === hash && Array.isArray(cached.bullets)) return { bullets: cached.bullets, costUsd: cached.costUsd, cached: true }

  const started = Date.now()
  const res = await client.messages.create({
    model: CLAUDE_MODELS[COMMENTARY_MODEL].id,
    max_tokens: 4000,
    output_config: { effort: 'medium', format: FORMAT },
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })
  const cost = costUsd(COMMENTARY_MODEL, res.usage)
  await appendLedger(dir, {
    kind: 'commentary',
    model: COMMENTARY_MODEL,
    about: m.model,
    costUsd: cost,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    ms: Date.now() - started,
  })
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  let bullets: string[] = []
  try {
    const v = JSON.parse(text) as { bullets?: unknown }
    if (Array.isArray(v.bullets)) bullets = v.bullets.filter((b): b is string => typeof b === 'string' && b.trim() !== '').map((b) => b.trim())
  } catch {
    // An unusable reply: no bullets, but it was paid for (and is in the ledger).
  }
  bullets = bullets.slice(0, 5)
  if (bullets.length) await writeJsonAtomic(file, { hash, bullets, costUsd: cost })
  return { bullets, costUsd: cost, cached: false }
}
