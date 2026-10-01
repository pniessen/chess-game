/**
 * report.md: a cross-table, a leaderboard and one section per model,
 * written for a reader who does not play chess seriously.
 */
import { CLAUDE_MODELS, type ClaudeModelKey } from '../../src/claude/models'
import { ADJUDICATION_CP } from './adjudicate'
import { BLUNDER, ENDGAME_MATERIAL, INACCURACY, MISTAKE, OPENING_PLIES } from './analyze'
import { AHEAD_CP, EARLY_QUEEN_TRADE_PLY, type Accuracy, type ModelStats, type Record3, type TrialStats } from './stats'
import type { GameRecord, TrialConfig } from './types'

export interface ReportInput {
  config: TrialConfig
  stats: TrialStats
  games: readonly GameRecord[]
  ledger: { spentUsd: number; moveUsd: number; commentaryUsd: number }
  depth: number
  commentary: ReadonlyMap<ClaudeModelKey, string[]>
  generatedAt: string
}

const label = (m: ClaudeModelKey) => CLAUDE_MODELS[m].label
const short = (m: ClaudeModelKey) => CLAUDE_MODELS[m].label.replace(/^Claude /, '')
const usd = (n: number | null) => (n === null ? 'n/a' : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`)
const num = (n: number | null, digits = 1) => (n === null ? 'n/a' : n.toFixed(digits))
const pct = (n: number | null) => (n === null ? 'n/a' : `${(100 * n).toFixed(0)}%`)
const sec = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(1)} s`)
/** m:ss from milliseconds. */
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`
const points = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1))
const wdl = (r: Record3) => `${r.wins}-${r.draws}-${r.losses}`
const row = (cells: readonly (string | number)[]) => `| ${cells.join(' | ')} |`
const table = (head: readonly string[], rows: ReadonlyArray<readonly (string | number)[]>) =>
  [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')

const TERMINATION: Record<string, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  'insufficient-material': 'insufficient material',
  'threefold-repetition': 'threefold repetition',
  'fifty-move-rule': 'fifty-move rule',
  adjudicated: 'adjudicated at the ply cap',
  'model-unavailable': 'abandoned (model unavailable)',
}

function accuracyRow(name: string, a: Accuracy): (string | number)[] {
  return [name, a.moves, num(a.avgCpl, 0), a.blunders, a.mistakes, a.inaccuracies]
}

function modelSection(m: ModelStats, input: ReportInput): string {
  const { stats } = input
  const opponents = stats.models.filter((o) => o !== m.model)
  const e = m.endings
  const s = m.style
  const bullets = input.commentary.get(m.model)
  const out: string[] = [
    `## ${m.label}`,
    '',
    `**Record:** ${wdl(m.record)} (wins-draws-losses) from ${m.record.games} finished games, ` +
      `${points(m.record.points)} points, a ${num(m.record.scorePct, 0)}% score` +
      `${m.record.unfinished ? `; ${m.record.unfinished} more game(s) ended unfinished` : ''}. ` +
      `As White ${wdl(m.asWhite)}, as Black ${wdl(m.asBlack)}.`,
    '',
    table(
      ['Opponent', 'Games', 'W-D-L', 'Points'],
      opponents.map((o) => {
        const r = m.vs[o]
        return [label(o), r?.games ?? 0, r ? wdl(r) : '-', r ? `${points(r.points)}/${r.games}` : '-']
      }),
    ),
    '',
    '**Playing style**' + (bullets?.length ? ' (written by Claude Opus 5.5 from the numbers below and a few excerpts):' : ':'),
    '',
    ...(bullets?.length ? bullets.map((b) => `- ${b}`) : ['- (no commentary: run the report without --no-commentary)']),
    '',
    '**Speed and cost**',
    '',
    `- Seconds per move: mean ${sec(m.speed.meanSec)}, median ${sec(m.speed.medianSec)}, 90th percentile ${sec(m.speed.p90Sec)}, slowest ${sec(m.speed.maxSec)} (over ${m.speed.moves} moves; retries included, Stockfish fallbacks left out).`,
    `- Time per game: its own moves took ${sec(m.time.ownSecPerGame)} of thinking a game on average; its games lasted ${num(m.time.gameMinutes)} min of wall time on average (both sides, retries and rate-limit waits included).`,
    `- Cost: ${usd(m.cost.totalUsd)} in all, ${usd(m.cost.perGameUsd)} a game, ${usd(m.cost.perMoveUsd)} a move; ` +
      `${m.cost.inputTokens.toLocaleString('en-US')} input and ${m.cost.outputTokens.toLocaleString('en-US')} output tokens over ${m.cost.calls} calls.`,
    `- Reliability: ${m.reliability.fallbacks} fallback move(s) (Stockfish moved for it after two failed tries), ` +
      `${m.reliability.timeouts} timeout(s), ${m.reliability.illegalReplies} unusable repl(ies), ${m.reliability.rateLimited} rate-limit wait(s)` +
      `${m.reliability.unavailableGames ? `; ${m.reliability.unavailableGames} game(s) abandoned because it could not go on` : ''}.`,
    '',
    '**How its games went**',
    '',
    `- Average game length: ${num(m.avgGamePlies, 0)} plies (half-moves).`,
    `- Checkmates: gave ${e.matesGiven}, received ${e.matesReceived}. Adjudicated at the cap: ${e.adjudicatedWins} won, ${e.adjudicatedLosses} lost, ${e.adjudicatedDraws} drawn. ` +
      `Draws by repetition ${e.repetitions}, stalemate ${e.stalemates}, fifty-move rule ${e.fiftyMove}, insufficient material ${e.insufficientMaterial}.`,
    `- Openings as White: ${m.openings.white.map((o) => `${o.name} (${o.count})`).join('; ') || 'none'}.`,
    `- Openings as Black: ${m.openings.black.map((o) => `${o.name} (${o.count})`).join('; ') || 'none'}.`,
    '',
    '**Accuracy** (centipawn loss against Stockfish; lower is better)',
    '',
    table(
      ['', 'Moves', 'Avg CPL', 'Blunders', 'Mistakes', 'Inaccuracies'],
      [
        accuracyRow('All moves', m.accuracy),
        accuracyRow('Opening', m.accuracy.byPhase.opening),
        accuracyRow('Middlegame', m.accuracy.byPhase.middlegame),
        accuracyRow('Endgame', m.accuracy.byPhase.endgame),
        accuracyRow(`When ahead (+${AHEAD_CP / 100} or more)`, m.accuracy.whenAhead),
        accuracyRow('When level', m.accuracy.whenLevel),
        accuracyRow(`When behind (-${AHEAD_CP / 100} or worse)`, m.accuracy.whenBehind),
      ],
    ),
    '',
    `Stockfish's own first choice: ${pct(m.accuracy.bestMoveShare)} of its moves.`,
    '',
    '**Style signals** (field average in brackets)',
    '',
    `- Captures: ${pct(s.captureRate)} of its moves (${pct(stats.field.captureRate)}). Checks: ${pct(s.checkRate)} (${pct(stats.field.checkRate)}). Pawn moves: ${pct(s.pawnMoveShare)} (${pct(stats.field.pawnMoveShare)}).`,
    `- Castled in ${s.castledGames} of its games (${pct(s.castledRate)}; field ${pct(stats.field.castledRate)}), on average on move ${num(s.avgCastleMoveNumber)}; kingside ${s.kingsideCastles}, queenside ${s.queensideCastles}.`,
    `- Queens off the board by ply ${EARLY_QUEEN_TRADE_PLY}: ${s.earlyQueenTradeGames} game(s) (${pct(s.earlyQueenTradeRate)}); it took the first queen in ${s.queenTradesStarted}.`,
    `- Repetition: ${s.repeatingMoves} of its moves (${pct(s.repeatingMoveShare)}) went back to a position already seen in the game; ${s.repetitionDraws} game(s) drawn by threefold repetition.`,
  ]
  return out.join('\n')
}

export function buildMarkdown(input: ReportInput): string {
  const { config, stats, games, ledger } = input
  const models = stats.models
  const cross = table(
    ['', ...models.map(short), 'Score'],
    models.map((r) => [
      `**${short(r)}**`,
      ...models.map((c) => {
        if (c === r) return '—'
        const x = stats.cross[r]?.[c]
        return x ? `${points(x.points)}/${x.games}` : '-'
      }),
      (() => {
        const m = stats.perModel.find((p) => p.model === r)!
        return `${points(m.record.points)}/${m.record.games}`
      })(),
    ]),
  )
  const leaderboard = table(
    ['#', 'Model', 'Score', 'Points', 'W-D-L', 'Avg CPL', 'Blunders a game', 'Avg s/move', 'Median s/move', 'Avg game min', 'Cost a game', 'Fallbacks'],
    stats.leaderboard.map((l) => {
      const m = stats.perModel.find((p) => p.model === l.model)!
      const allGames = m.record.games + m.record.unfinished
      return [
        l.rank,
        m.label,
        l.scorePct === null ? 'n/a' : `${l.scorePct.toFixed(0)}%`,
        `${points(l.points)}/${l.games}`,
        wdl(m.record),
        num(l.avgCpl, 0),
        allGames ? num(m.accuracy.blunders / allGames) : 'n/a',
        num(m.speed.meanSec),
        num(m.speed.medianSec),
        num(m.time.gameMinutes),
        usd(m.cost.perGameUsd),
        m.reliability.fallbacks,
      ]
    }),
  )
  const ends = Object.entries(stats.terminations)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${TERMINATION[t] ?? t} ${n}`)
    .join(', ')
  const list = table(
    ['Game', 'White', 'Black', 'Result', 'How it ended', 'Plies', 'Duration', 'White time', 'Black time', 'Cost'],
    [...games]
      .sort((a, b) => a.gameId.localeCompare(b.gameId))
      .map((g) => [
        g.gameId,
        short(g.white),
        short(g.black),
        g.result,
        (TERMINATION[g.termination] ?? g.termination) +
          (g.adjudication ? ` (${g.adjudication.mate !== null ? `mate in ${Math.abs(g.adjudication.mate)}` : `${((g.adjudication.evalCp ?? 0) / 100).toFixed(2)}`})` : '') +
          (g.unavailable ? ` (${g.unavailable.side === 'w' ? 'White' : 'Black'}: ${g.unavailable.reason})` : ''),
        g.plies,
        clock(g.wallMs),
        clock(g.moves.filter((m) => m.side === 'w').reduce((t, m) => t + m.ms, 0)),
        clock(g.moves.filter((m) => m.side === 'b').reduce((t, m) => t + m.ms, 0)),
        usd(g.totals.w.costUsd + g.totals.b.costUsd),
      ]),
  )

  return [
    `# Round-robin trial ${config.trialId}`,
    '',
    `${stats.games} of ${(models.length * (models.length - 1) * config.gamesPerPair) / 2} scheduled games played (${stats.finishedGames} with a result) between ${models.length} models, ` +
      `${config.gamesPerPair} per pairing, colours alternating. Games stop at ${config.maxPlies} plies. ` +
      `Spent ${usd(ledger.spentUsd)} of the ${usd(config.capUsd)} cap: ${usd(ledger.moveUsd)} on moves, ${usd(ledger.commentaryUsd)} on this report's commentary. ` +
      (() => {
        // The ledger also holds calls of games not in this report: stopped by the cap, crashed, or replayed.
        const inGames = games.reduce((sum, g) => sum + g.totals.w.costUsd + g.totals.b.costUsd, 0)
        const other = ledger.moveUsd - inGames
        return other > 0.00005 ? `Of the move spend, ${usd(other)} went on games not in this report (stopped by the cap, crashed or replayed). ` : ''
      })() +
      `Generated ${input.generatedAt}.`,
    '',
    '## How to read this',
    '',
    '- **Score** is wins plus half the draws, over games with a result. A game abandoned because a model could not go on has no result and is not scored.',
    `- **CPL** (centipawn loss) is how much worse a move was than Stockfish's best move, judged by Stockfish at depth ${input.depth}. 100 centipawns is about one pawn. ` +
      `A **blunder** loses ${BLUNDER} or more, a **mistake** ${MISTAKE}–${BLUNDER - 1}, an **inaccuracy** ${INACCURACY}–${MISTAKE - 1}; a single move's loss is capped at 1000. ` +
      'A forced mate scores 10,000, so a move that lets a forced mate slip to a merely winning position counts as a large loss (up to that cap) even though it still wins.',
    `- **Opening** is the first ${OPENING_PLIES} plies; after that a move is in the **endgame** once the pieces other than pawns and kings add up to ${ENDGAME_MATERIAL} points or less (knight or bishop 3, rook 5, queen 9), and in the **middlegame** before that.`,
    `- **Adjudicated**: at the ${config.maxPlies}-ply cap Stockfish (depth 18) judges the final position; a lead of ${ADJUDICATION_CP} centipawns or a forced mate wins, anything less is a draw.`,
    '- **Time**: a model\'s seconds a move count its own answers, retries included and Stockfish fallbacks left out. A game\'s **Duration** is its wall-clock time from first move to last, including rate-limit waits; **White time** and **Black time** add up each side\'s moves. Several games run at once, so a busy provider can make a game slower than its moves alone explain.',
    '- **Fallback**: when a model fails twice on one move (timeout, unusable reply), Stockfish at full strength plays that move for it, as in the app. It counts against the model (5 in one game and the game is abandoned) and is left out of its accuracy and speed.',
    '- The style bullets were written by Claude Opus 5.5 from these numbers only and were told to claim nothing they do not support; the tables are the evidence.',
    '',
    '## Leaderboard',
    '',
    leaderboard,
    '',
    '## Cross-table',
    '',
    'Points scored by the row model against the column model (points / games).',
    '',
    cross,
    '',
    `How games ended: ${ends || 'none yet'}.`,
    '',
    ...stats.perModel.map((m) => modelSection(m, input) + '\n'),
    '## All games',
    '',
    list,
    '',
  ].join('\n')
}
