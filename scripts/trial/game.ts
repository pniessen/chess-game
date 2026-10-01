/**
 * One trial game, start to finish, with the app's rules for a model seat:
 * ask, retry once on a retryable failure, then Stockfish plays the move at
 * CLAUDE_FALLBACK_LEVEL and it counts as a fallback against the model; five
 * fallbacks, a missing or rejected key, or an unusable reply from Stockfish
 * itself end the game with no winner ('model-unavailable'). Rate limits are
 * backed off and asked again before that retry is spent.
 *
 * Everything outside (the move dispatcher, Stockfish, the ledger, the cap,
 * the clock) is injected, so the tests run whole games without a network.
 */
import { CLAUDE_MODELS, shortModelLabel, type ClaudeModelKey } from '../../src/claude/models'
import { Game } from '../../src/game-core/game'
import { exportPgn } from '../../src/game-core/io'
import { STARTING_FEN, type Color, type MoveIntent } from '../../src/game-core/types'
import { CLAUDE_FALLBACK_LIMIT } from '../../src/match/claudeFallback'
import type { MoveOutcome } from '../../server/claudeMove'
import type { MissingKey, MoveRequest } from '../../server/moveDispatch'
import { ADJUDICATION_DEPTH, adjudicate } from './adjudicate'
import type { GameSpec } from './schedule'
import type { TrialEngine } from './stockfish'
import type { CallRecord, GameRecord, GameResult, MoveRecord, SideTotals, Termination } from './types'

/** Waits before asking again after a rate limit: 5 s, 15 s, 30 s, 60 s. After the last, it counts as a failure. */
export const BACKOFF_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000]

/** Failures no retry can fix: the game ends, as the app's 'fatal' does. */
const FATAL = new Set(['auth', 'bad-request'])

export interface PlayDeps {
  trialId: string
  maxPlies: number
  move(req: MoveRequest): Promise<{ outcome: MoveOutcome } | { missing: MissingKey }>
  /** This game's own Stockfish, asked for only when needed. */
  engine(): Promise<TrialEngine>
  /** Record one charged call (the trial ledger and its running spend). */
  charge(model: ClaudeModelKey, gameId: string, call: CallRecord): Promise<void>
  /**
   * The hard cap: may `model` make one more call? If so, its worst case is held against the cap
   * until the returned release is called (right after the call is charged); null if it does not fit.
   */
  mayCall(model: ClaudeModelKey): (() => void) | null
  sleep(ms: number): Promise<void>
  /** One line per move and per game end. */
  log(line: string): void
  /** The trial's spend so far, for the log line. */
  spentUsd(): number
  /** After each ply, with the moves so far (for progress.json). */
  onPly?(moves: readonly MoveRecord[]): void
  now?: () => number
  /** Tests only: a start position other than the standard one. */
  startFen?: string
}

const emptyTotals = (): SideTotals => ({
  costUsd: 0,
  ms: 0,
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  moves: 0,
  fallbacks: 0,
  timeouts: 0,
  rateLimited: 0,
  illegalReplies: 0,
})

const uciToIntent = (uci: string | null): MoveIntent | null => {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null
  const promotion = uci[4] as MoveIntent['promotion'] | undefined
  return { from: uci.slice(0, 2) as MoveIntent['from'], to: uci.slice(2, 4) as MoveIntent['to'], ...(promotion ? { promotion } : {}) }
}

const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`

/** Play one game. A 'cap' game is returned unfinished (result '*'); the runner does not save it as done. */
export async function playGame(spec: GameSpec, deps: PlayDeps): Promise<GameRecord> {
  const now = deps.now ?? Date.now
  const started = now()
  const startFen = deps.startFen ?? STARTING_FEN
  const game = new Game(startFen === STARTING_FEN ? undefined : { fen: startFen })
  const moves: MoveRecord[] = []
  const totals = { w: emptyTotals(), b: emptyTotals() }
  let engine: TrialEngine | null = null
  const getEngine = async () => (engine ??= await deps.engine())

  let result: GameResult = '*'
  let winner: Color | null = null
  let termination: Termination | null = null
  let adjudication: GameRecord['adjudication']
  let unavailable: GameRecord['unavailable']

  const stop = (t: Termination, side?: Color, reason?: string) => {
    termination = t
    if (side && reason) unavailable = { side, reason }
  }

  while (termination === null) {
    const status = game.status()
    if (status.kind === 'checkmate') {
      winner = status.winner
      result = winner === 'w' ? '1-0' : '0-1'
      termination = 'checkmate'
      break
    }
    if (status.kind === 'draw') {
      result = '1/2-1/2'
      termination = status.reason
      break
    }
    const pos = game.current()
    if (moves.length >= deps.maxPlies) {
      const { score } = await (await getEngine()).evaluate(pos.fen(), ADJUDICATION_DEPTH)
      const a = adjudicate(score, pos.turn())
      result = a.result
      winner = a.winner
      adjudication = { depth: ADJUDICATION_DEPTH, evalCp: a.evalCp, mate: a.mate }
      termination = 'adjudicated'
      break
    }

    const side = pos.turn()
    const model = side === 'w' ? spec.white : spec.black
    const t = totals[side]
    const calls: CallRecord[] = []
    const history = game.moves.map((m) => m.san)
    let played: { san: string; why: string; fallback: boolean } | null = null
    let retried = false
    let backoffs = 0

    for (;;) {
      // The cap holds this call's worst case until it is charged, so concurrent calls cannot overrun it.
      const release = deps.mayCall(model)
      if (!release) {
        stop('cap')
        break
      }
      let routed: Awaited<ReturnType<PlayDeps['move']>>
      try {
        routed = await deps.move({ model, ...(startFen !== STARTING_FEN ? { startFen } : {}), history })
      } catch (err) {
        release()
        throw err
      }
      if ('missing' in routed) {
        release()
        stop('model-unavailable', side, routed.missing)
        break
      }
      const o = routed.outcome
      const call: CallRecord = {
        kind: o.ok ? 'ok' : o.kind,
        ms: o.ms,
        costUsd: o.costUsd,
        inputTokens: o.tokens?.inputTokens ?? 0,
        outputTokens: o.tokens?.outputTokens ?? 0,
      }
      // A call was made whenever tokens are reported (a bad request makes none), as the server counts it.
      // charge() adds to the spend before its first await, so releasing after it leaves no gap.
      const charged = o.tokens ? deps.charge(model, spec.id, call) : null
      release()
      if (charged) {
        calls.push(call)
        await charged
        t.calls++
        t.costUsd += call.costUsd
        t.ms += call.ms
        t.inputTokens += call.inputTokens
        t.outputTokens += call.outputTokens
      }
      if (o.ok) {
        // The dispatcher already checked the SAN against the legal list; the board checks it again.
        const r = pos.clone().trySan(o.san)
        if (r.ok && game.play({ from: r.move.from, to: r.move.to, ...(r.move.promotion ? { promotion: r.move.promotion } : {}) }).ok) {
          played = { san: r.move.san, why: o.why, fallback: false }
        }
        break
      }
      if (o.kind === 'timeout') t.timeouts++
      if (o.kind === 'illegal-reply') t.illegalReplies++
      if (o.kind === 'rate-limited') t.rateLimited++
      if (FATAL.has(o.kind)) {
        stop('model-unavailable', side, o.kind)
        break
      }
      if (o.kind === 'rate-limited' && backoffs < BACKOFF_MS.length) {
        const wait = BACKOFF_MS[backoffs++]!
        deps.log(`[${spec.id}] ${model} rate-limited; asking again in ${wait / 1000}s`)
        await deps.sleep(wait)
        continue
      }
      if (!retried) {
        retried = true
        continue
      }
      break
    }
    if (termination !== null) break

    if (!played) {
      // Stockfish stands in, and the move counts against the model.
      const intent = uciToIntent(await (await getEngine()).fallbackMove(pos.fen()))
      const r = intent ? game.play(intent) : null
      if (!r?.ok) {
        stop('model-unavailable', side, 'fallback failed')
        break
      }
      played = { san: r.move.san, why: '', fallback: true }
      t.fallbacks++
    }

    t.moves++
    const rec: MoveRecord = {
      ply: moves.length + 1,
      side,
      model,
      san: played.san,
      fallback: played.fallback,
      why: played.why,
      ms: calls.reduce((s, c) => s + c.ms, 0),
      costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
      inputTokens: calls.reduce((s, c) => s + c.inputTokens, 0),
      outputTokens: calls.reduce((s, c) => s + c.outputTokens, 0),
      calls,
    }
    moves.push(rec)
    deps.onPly?.(moves)
    const n = Math.ceil(rec.ply / 2)
    deps.log(
      `[${spec.id}] ${n}${side === 'w' ? '.' : '...'} ${played.san}${played.fallback ? ' (fallback)' : ''} ` +
        `${shortModelLabel(model)} ${(rec.ms / 1000).toFixed(1)}s ${usd(rec.costUsd)}` +
        `${calls.length > 1 ? ` ${calls.length} calls` : ''} · trial ${usd(deps.spentUsd())}`,
    )

    if (played.fallback && t.fallbacks >= CLAUDE_FALLBACK_LIMIT && game.status().kind === 'in-progress') {
      stop('model-unavailable', side, `${CLAUDE_FALLBACK_LIMIT} fallbacks`)
    }
  }

  const finished = now()
  const label = (m: ClaudeModelKey) => CLAUDE_MODELS[m].label
  const comments: Record<number, string> = {}
  moves.forEach((m, i) => {
    comments[i] = m.fallback ? '[fallback: Stockfish]' : m.why
  })
  if (adjudication && moves.length > 0) {
    const ev = adjudication.mate !== null ? `mate in ${Math.abs(adjudication.mate)} for ${adjudication.mate > 0 ? 'White' : 'Black'}` : `${(adjudication.evalCp! / 100).toFixed(2)}`
    comments[moves.length - 1] = `${comments[moves.length - 1] ?? ''} [adjudicated at the ${deps.maxPlies}-ply cap: Stockfish depth ${adjudication.depth} ${ev}]`.trim()
  }
  const pgn = exportPgn(
    game,
    {
      Event: `Round-robin trial ${deps.trialId}`,
      Site: 'Local',
      Date: new Date(started).toISOString().slice(0, 10).replace(/-/g, '.'),
      Round: String(spec.round),
      White: label(spec.white),
      Black: label(spec.black),
      Result: result,
    },
    comments,
  )
  const record: GameRecord = {
    v: 1,
    trialId: deps.trialId,
    gameId: spec.id,
    round: spec.round,
    white: spec.white,
    black: spec.black,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    wallMs: finished - started,
    maxPlies: deps.maxPlies,
    result,
    winner,
    termination: termination!,
    ...(adjudication ? { adjudication } : {}),
    ...(unavailable ? { unavailable } : {}),
    plies: moves.length,
    moves,
    pgn,
    totals,
  }
  deps.log(
    `[${spec.id}] game over: ${label(spec.white)} vs ${label(spec.black)} ${result} by ${termination}` +
      `${unavailable ? ` (${unavailable.side === 'w' ? 'White' : 'Black'}: ${unavailable.reason})` : ''}, ${moves.length} plies, ` +
      `${usd(totals.w.costUsd + totals.b.costUsd)} · trial ${usd(deps.spentUsd())}`,
  )
  return record
}
