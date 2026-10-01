/**
 * The round-robin schedule and the rule for what to start next. Pure: the
 * runner (./runner) and the dry-run estimate (./estimate) both use it.
 */
import { CLAUDE_MODELS, type ClaudeModelKey } from '../../src/claude/models'

export interface GameSpec {
  /** Stable across restarts and model order: `<a>-<b>-<n>` with a, b in the model table's order. */
  id: string
  /** `<a>|<b>`, the unordered pairing. */
  pair: string
  /** The pairing's game number, 1-based. */
  round: number
  white: ClaudeModelKey
  black: ClaudeModelKey
}

const ORDER = Object.keys(CLAUDE_MODELS) as ClaudeModelKey[]
const rank = (m: ClaudeModelKey) => ORDER.indexOf(m)

/**
 * The pairings in circle-method rounds: each round pairs every model at most
 * once, so the first games of the order can run side by side.
 */
export function pairings(models: readonly ClaudeModelKey[]): Array<[ClaudeModelKey, ClaudeModelKey]> {
  const list: Array<ClaudeModelKey | null> = [...models].sort((a, b) => rank(a) - rank(b))
  if (list.length % 2 === 1) list.push(null)
  const n = list.length
  const out: Array<[ClaudeModelKey, ClaudeModelKey]> = []
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const x = list[i]
      const y = list[n - 1 - i]
      if (x && y) out.push(rank(x) < rank(y) ? [x, y] : [y, x])
    }
    // Keep the first fixed and rotate the rest one step.
    const last = list.pop()!
    list.splice(1, 0, last)
  }
  return out
}

/**
 * Every game of the trial, in the order they are started: game 1 of every
 * pairing, then game 2, and so on. Colours alternate within a pairing (2/2 over
 * four games) and start from alternate sides across pairings, so with an odd
 * game count no model is always White.
 */
export function buildSchedule(models: readonly ClaudeModelKey[], gamesPerPair: number): GameSpec[] {
  if (new Set(models).size !== models.length) throw new Error('a model is listed twice')
  if (models.length < 2) throw new Error('a round robin needs at least two models')
  if (!Number.isInteger(gamesPerPair) || gamesPerPair < 1) throw new Error('games per pair must be a positive integer')
  const pairs = pairings(models)
  const out: GameSpec[] = []
  for (let k = 0; k < gamesPerPair; k++) {
    pairs.forEach(([a, b], pi) => {
      const aWhite = (k + pi) % 2 === 0
      out.push({ id: `${a}-${b}-${k + 1}`, pair: `${a}|${b}`, round: k + 1, white: aWhite ? a : b, black: aWhite ? b : a })
    })
  }
  return out
}

export type NextAction = { kind: 'start'; spec: GameSpec } | { kind: 'wait' } | { kind: 'blocked'; spec: GameSpec } | { kind: 'done' }

/**
 * What the pool does next. The first pending game (in schedule order) whose
 * two models are both idle is the candidate: start it if the cap allows,
 * otherwise wait for running games to release their holds, and when none are
 * running the cap has blocked the trial. Later, cheaper games never jump the
 * queue, so the cap cannot tilt the field toward cheap models.
 */
export function nextAction(
  pending: readonly GameSpec[],
  busy: ReadonlySet<ClaudeModelKey>,
  running: number,
  affordable: (spec: GameSpec) => boolean,
): NextAction {
  if (pending.length === 0) return { kind: 'done' }
  const spec = pending.find((g) => !busy.has(g.white) && !busy.has(g.black))
  if (!spec) return { kind: 'wait' }
  if (affordable(spec)) return { kind: 'start', spec }
  return running > 0 ? { kind: 'wait' } : { kind: 'blocked', spec }
}
