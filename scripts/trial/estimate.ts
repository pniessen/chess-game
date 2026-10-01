/**
 * The dry run's cost and time estimate, from measured per-move numbers (the
 * spec's Phase 0 table and the 2026-09-30 / 2026-10-01 addenda) and the
 * models' reserves. An estimate, not a promise: real games vary in length,
 * and timeouts or retries add calls.
 */
import { CLAUDE_MODELS, type ClaudeModelKey } from '../../src/claude/models'
import { reserveFor } from './budget'
import { nextAction, type GameSpec } from './schedule'

export interface PerMove {
  /** Median seconds per move. */
  sec: number
  /** Cost of an opening move (USD). */
  openingUsd: number
  /** Whether the prompt carries the game so far (cost grows with it); Jev's does not. */
  grows: boolean
  source: string
}

/**
 * Measured per-move numbers. Claude: spec "Phase 0 results" (2026-09-29), the
 * median latency and the dearest opening move. Jev: the 2026-09-30 smoke game
 * (median 183 ms, about 1,070 input tokens a move at $0.042/M). Gemini: the
 * 2026-10-01 addenda (3.1 Pro's smoke-game median 3.5 s, dearest opening move
 * $0.00284; 3.6 Flash's 12 measured moves, median 1.2 s, $0.000708).
 */
export const PER_MOVE: Record<ClaudeModelKey, PerMove> = {
  fable: { sec: 3.9, openingUsd: 0.0086, grows: true, source: 'Phase 0' },
  opus: { sec: 3.5, openingUsd: 0.0036, grows: true, source: 'Phase 0' },
  sonnet: { sec: 2.4, openingUsd: 0.0018, grows: true, source: 'Phase 0' },
  haiku: { sec: 2.2, openingUsd: 0.0008, grows: true, source: 'Phase 0' },
  jev: { sec: 0.183, openingUsd: 0.000045, grows: false, source: 'Jev smoke game 2026-09-30' },
  'gemini-pro': { sec: 3.5, openingUsd: 0.00284, grows: true, source: 'Gemini smoke game 2026-10-01' },
  'gemini-flash': { sec: 1.2, openingUsd: 0.000708, grows: true, source: '3.6 Flash measurement 2026-10-01' },
}

/** Phase 0's Haiku game: a move at ply ~100 cost 1.7x an opening one, so +0.7% a ply. */
const GROWTH_PER_PLY = 0.007

/** One side's cost over a game of `plies` plies (White moves on odd plies). */
export function sideCostUsd(model: ClaudeModelKey, plies: number, white: boolean): number {
  const m = PER_MOVE[model]
  let sum = 0
  for (let p = white ? 1 : 2; p <= plies; p += 2) sum += m.openingUsd * (m.grows ? 1 + GROWTH_PER_PLY * (p - 1) : 1)
  return sum
}

/** Seconds of model time in a game of `plies` plies. */
export function gameSeconds(spec: GameSpec, plies: number): number {
  return Math.ceil(plies / 2) * PER_MOVE[spec.white].sec + Math.floor(plies / 2) * PER_MOVE[spec.black].sec
}

/**
 * Wall time for the schedule with `concurrency` slots and the same-model rule,
 * by simulating the pool's own `nextAction` with each game's estimated length.
 */
export function simulateWallSeconds(schedule: readonly GameSpec[], concurrency: number, seconds: (g: GameSpec) => number): number {
  const pending = [...schedule]
  const running: Array<{ spec: GameSpec; end: number }> = []
  let t = 0
  for (;;) {
    const busy = new Set(running.flatMap((r) => [r.spec.white, r.spec.black]))
    const a = running.length < concurrency ? nextAction(pending, busy, running.length, () => true) : { kind: 'wait' as const }
    if (a.kind === 'start') {
      pending.splice(pending.indexOf(a.spec), 1)
      running.push({ spec: a.spec, end: t + seconds(a.spec) })
      continue
    }
    if (running.length === 0) return t
    running.sort((x, y) => x.end - y.end)
    t = running.shift()!.end
  }
}

export interface Estimate {
  games: number
  /** Every game's reserves added up: the most the cap could be asked to hold if all ran at once. */
  reservesUsd: number
  /** The largest single game's hold. */
  maxHoldUsd: number
  scenarios: Array<{ label: string; plies: number; costUsd: number; wallSeconds: number }>
  perModel: Array<{ model: ClaudeModelKey; games: number; costUsd: number; source: string }>
}

export function estimateTrial(schedule: readonly GameSpec[], opts: { maxPlies: number; concurrency: number }): Estimate {
  const typical = Math.min(100, opts.maxPlies)
  const scenarios = [
    { label: `typical (${typical} plies a game)`, plies: typical },
    { label: `every game to the ${opts.maxPlies}-ply cap`, plies: opts.maxPlies },
  ].map((s) => ({
    ...s,
    costUsd: schedule.reduce((sum, g) => sum + sideCostUsd(g.white, s.plies, true) + sideCostUsd(g.black, s.plies, false), 0),
    wallSeconds: simulateWallSeconds(schedule, opts.concurrency, (g) => gameSeconds(g, s.plies)),
  }))
  const seated = new Set(schedule.flatMap((g) => [g.white, g.black]))
  const models = (Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]).filter((m) => seated.has(m))
  const perModel = models.map((model) => {
    const mine = schedule.filter((g) => g.white === model || g.black === model)
    return {
      model,
      games: mine.length,
      costUsd: mine.reduce((sum, g) => sum + sideCostUsd(model, typical, g.white === model), 0),
      source: PER_MOVE[model].source,
    }
  })
  const holds = schedule.map((g) => reserveFor(g.white, g.black, opts.maxPlies))
  return {
    games: schedule.length,
    reservesUsd: holds.reduce((a, b) => a + b, 0),
    maxHoldUsd: Math.max(0, ...holds),
    scenarios,
    perModel,
  }
}

export const hours = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`)
