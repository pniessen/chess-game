/**
 * Spending and access controls for the local-only Claude-vs-Claude games.
 *
 * Every game spends real money, so the endpoints behind this module are
 * only served by the local relay on the owner's machine, allow one game at
 * a time, and draw on a monthly dollar budget. Each game reserves its
 * worst-case cost when it starts; moves are charged as they happen and the
 * unused part of the reservation goes back when the game ends.
 *
 * The store is a two-method interface (`./store`), and the budget lives under
 * its own `games/` keys.
 *
 * The store has no compare-and-set, so two racing requests could both
 * read the same lock or total. For a single-user feature that runs one game
 * at a time that race is accepted; building locking around it would cost
 * more than the overshoot it prevents.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  CLAUDE_MAX_PLIES,
  RESERVE_PER_GAME_USD,
  ZERO_USAGE,
  isClaudeModelKey,
  parseSideUsage,
  parseUsageByModel,
  type ClaudeModelKey,
  type SideUsage,
  type Usage,
  type UsageByModel,
} from '../src/claude/models'
import type { GameStore } from './store'

/** Every limit, in one place. */
export const GAMES_LIMITS = {
  /** Dollars the whole site may spend on Claude games per UTC month. */
  monthlyUsd: 20,
  /** How long a game holds the site-wide lock without a move. */
  lockTtlMs: 30 * 60_000,
  /**
   * Plies after which a game is adjudicated a draw. The browser adjudicates
   * first; a move request at the cap is refused here as a backstop.
   */
  plyCap: CLAUDE_MAX_PLIES,
} as const

type Side = 'white' | 'black'

/** Dollars are floats; storing them rounded to 1e-6 keeps sums from drifting. */
const round = (usd: number): number => Math.round(usd * 1e6) / 1e6

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The UTC month a timestamp falls in, as `YYYY-MM`. The budget resets on it. */
export const utcMonth = (now: number): string => new Date(now).toISOString().slice(0, 7)

const LOCK_KEY = 'games/lock'
const budgetKey = (month: string): string => `games/budget/${month}`

/** Equal-length digests make `timingSafeEqual` applicable to strings of any length. */
function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest()
  const db = createHash('sha256').update(b).digest()
  return timingSafeEqual(da, db)
}

/** The bearer for one game: an HMAC of its id under the per-process secret, so it cannot be forged or reused. */
function gameToken(gameId: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(gameId).digest('hex')
}

/** Whether `token` is the bearer minted for `gameId` under `secret`. Compared in constant time. */
export function checkGameToken(secret: Buffer, gameId: string, token: string): boolean {
  return safeEqual(token, gameToken(gameId, secret))
}

/** One call to Anthropic made for `side`, as measured around it on the server. */
export interface MoveCall {
  side: Side
  costUsd: number
  ms: number
  inputTokens: number
  /** Includes thinking; for a timeout the estimate the ledger charges for. */
  outputTokens: number
}

function addCall(u: Usage, c: MoveCall): Usage {
  return {
    costUsd: round(u.costUsd + Math.max(0, c.costUsd)),
    ms: u.ms + Math.max(0, Math.round(c.ms)),
    inputTokens: u.inputTokens + Math.max(0, Math.round(c.inputTokens)),
    outputTokens: u.outputTokens + Math.max(0, Math.round(c.outputTokens)),
    calls: u.calls + 1,
  }
}

interface Budget {
  /** Dollars actually charged this month. */
  spent: number
  /** Dollars held for games in progress and not yet spent. */
  reserved: number
  /**
   * What each model's calls added up to this month. Absent in records written
   * before it existed: their dollars are in `spent` only (see monthUsage).
   */
  byModel: UsageByModel
}

interface Game {
  white: ClaudeModelKey
  black: ClaudeModelKey
  reserved: number
  spent: number
  plies: number
  startedAt: number
  /** The month whose budget holds this game's reservation. */
  month: string
  ended?: boolean
  /** Per side; absent in records written before it existed, which read as zero. */
  usage: SideUsage
}

async function readBudget(store: GameStore, month: string): Promise<Budget> {
  // Read errors propagate on purpose: a failed read must not look like an empty ledger (fail closed).
  const v = await store.get(budgetKey(month), { type: 'json' })
  if (!isRecord(v)) return { spent: 0, reserved: 0, byModel: {} }
  return { spent: num(v['spent']), reserved: num(v['reserved']), byModel: parseUsageByModel(v['byModel']) }
}

async function writeBudget(store: GameStore, month: string, b: Budget): Promise<void> {
  await store.setJSON(budgetKey(month), {
    spent: round(Math.max(0, b.spent)),
    reserved: round(Math.max(0, b.reserved)),
    byModel: b.byModel,
  })
}

async function readGame(store: GameStore, gameId: string): Promise<Game | null> {
  // Like the budget and the lock, a failed read propagates: it must not look like "no such game".
  const v = await store.get(`games/${gameId}`, { type: 'json' })
  if (!isRecord(v) || !isClaudeModelKey(v['white']) || !isClaudeModelKey(v['black'])) return null
  return {
    white: v['white'],
    black: v['black'],
    reserved: num(v['reserved']),
    spent: num(v['spent']),
    plies: num(v['plies']),
    startedAt: num(v['startedAt']),
    month: typeof v['month'] === 'string' ? v['month'] : '',
    ended: v['ended'] === true,
    usage: parseSideUsage(v['usage']),
  }
}

/**
 * The one-game lock. `boot` is the id of the server process that took it; a
 * lock from another boot belongs to a game whose token no longer verifies
 * (the secret died with that process), so that game can never end itself.
 */
interface Lock {
  gameId: string
  until: number
  /** Absent in locks written before boot ids existed: such a lock counts as another boot. */
  boot?: string
}

async function readLock(store: GameStore): Promise<Lock | null> {
  // As with the budget, a failed read must not look like "no lock".
  const v = await store.get(LOCK_KEY, { type: 'json' })
  if (!isRecord(v) || typeof v['gameId'] !== 'string') return null
  const lock: Lock = { gameId: v['gameId'], until: num(v['until']) }
  if (typeof v['boot'] === 'string') lock.boot = v['boot']
  return lock
}

/** Dollars still available this month: neither spent nor held for a game in progress. */
export async function budgetLeft(store: GameStore, now: number): Promise<number> {
  const b = await readBudget(store, utcMonth(now))
  return round(Math.max(0, GAMES_LIMITS.monthlyUsd - b.spent - b.reserved))
}

/**
 * This month's usage per model, and `earlierUsd`: dollars spent before usage
 * was tracked per model (spent minus the per-model costs), or 0 when that
 * remainder is under half a cent.
 */
export async function monthUsage(store: GameStore, now: number): Promise<{ byModel: UsageByModel; earlierUsd: number }> {
  const b = await readBudget(store, utcMonth(now))
  const tracked = Object.values(b.byModel).reduce((sum, u) => sum + u.costUsd, 0)
  const earlier = round(b.spent - tracked)
  return { byModel: b.byModel, earlierUsd: earlier > 0.005 ? earlier : 0 }
}

/**
 * Begin a game: check the lock, reserve the worst-case cost, and mint the
 * token the browser sends with each move. `boot` is this server process's id;
 * a lock taken under any other boot is treated as expired.
 */
export async function startGame(
  store: GameStore,
  now: number,
  secret: Buffer,
  sides: { white: string; black: string },
  boot: string,
): Promise<
  | { ok: true; gameId: string; token: string; budgetLeftUsd: number }
  | { ok: false; kind: 'busy' | 'budget' | 'bad-request' }
> {
  const { white, black } = sides
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return { ok: false, kind: 'bad-request' }

  const lock = await readLock(store)
  if (lock && lock.until > now && lock.boot === boot) return { ok: false, kind: 'busy' }
  // An expired lock means that game was abandoned (crash, closed tab); a lock from an earlier
  // boot means the server restarted, so that game's token is dead and its /end can never come.
  // Either way settle it so its reservation is not held until the month rolls over. Saved as a
  // minimal `abandoned` record.
  if (lock) await settleGame(store, now, lock.gameId, { abandoned: true })

  const month = utcMonth(now)
  const reserve = round(RESERVE_PER_GAME_USD[white] + RESERVE_PER_GAME_USD[black])
  const budget = await readBudget(store, month)
  if (round(budget.spent + budget.reserved + reserve) > GAMES_LIMITS.monthlyUsd) return { ok: false, kind: 'budget' }

  const gameId = randomUUID()
  await writeBudget(store, month, { ...budget, reserved: budget.reserved + reserve })
  const usage: SideUsage = { w: { ...ZERO_USAGE }, b: { ...ZERO_USAGE } }
  const game: Game = { white, black, reserved: reserve, spent: 0, plies: 0, startedAt: now, month, usage }
  await store.setJSON(`games/${gameId}`, game)
  await store.setJSON(LOCK_KEY, { gameId, until: now + GAMES_LIMITS.lockTtlMs, boot } satisfies Lock)
  return { ok: true, gameId, token: gameToken(gameId, secret), budgetLeftUsd: await budgetLeft(store, now) }
}

/**
 * Whether the next move of `side` may be requested from Claude: the token
 * is this game's, this game still holds the lock, the game is under the ply
 * cap and its reservation is not used up. Each authorised move extends the
 * lock, so a long game keeps it for as long as it keeps moving.
 */
export async function authorizeMove(
  store: GameStore,
  now: number,
  secret: Buffer,
  req: { gameId: string; token: string; side: Side; plies: number },
): Promise<{ ok: true; model: ClaudeModelKey } | { ok: false; kind: 'forbidden' | 'budget' | 'over' }> {
  const forbidden = { ok: false, kind: 'forbidden' } as const
  if (!checkGameToken(secret, req.gameId, req.token)) return forbidden

  const game = await readGame(store, req.gameId)
  if (!game || game.ended) return forbidden
  const lock = await readLock(store)
  if (!lock || lock.gameId !== req.gameId || lock.until <= now) return forbidden

  if (req.plies >= GAMES_LIMITS.plyCap) return { ok: false, kind: 'over' }
  if (round(game.spent) >= round(game.reserved)) return { ok: false, kind: 'budget' }

  // Keeps the boot that took the lock: only the process whose secret verified the token gets here.
  await store.setJSON(LOCK_KEY, { ...lock, until: now + GAMES_LIMITS.lockTtlMs } satisfies Lock)
  return { ok: true, model: game[req.side] }
}

/**
 * Record one call to Anthropic made for `call.side`: its cost counts against
 * the game's reservation first, so the month's "left" only moves when a game
 * ends or overspends, and its usage adds to the side's totals and to its
 * model's for the month. The model is the game record's, never the caller's.
 * Every call counts, a free one (an SDK error) included.
 * Returns what the game has spent so far and its per-side usage.
 */
export async function chargeMove(
  store: GameStore,
  _now: number,
  gameId: string,
  call: MoveCall,
): Promise<{ spent: number; usage: SideUsage }> {
  const game = await readGame(store, gameId)
  if (!game) return { spent: 0, usage: { w: { ...ZERO_USAGE }, b: { ...ZERO_USAGE } } }
  const costUsd = Math.max(0, call.costUsd)
  const key = call.side === 'white' ? 'w' : 'b'
  const model = game[call.side]
  // The game was settled while this reply was in flight: its reservation is already
  // released, so the money is simply spent. The saved record is not rewritten.
  const held = game.ended ? 0 : Math.max(0, game.reserved - game.spent)
  const fromReservation = Math.min(costUsd, held)
  const budget = await readBudget(store, game.month)
  await writeBudget(store, game.month, {
    spent: budget.spent + costUsd,
    reserved: budget.reserved - fromReservation,
    byModel: { ...budget.byModel, [model]: addCall(budget.byModel[model] ?? { ...ZERO_USAGE }, call) },
  })
  const spent = round(game.spent + costUsd)
  const usage: SideUsage = { ...game.usage, [key]: addCall(game.usage[key], call) }
  await store.setJSON(`games/${gameId}`, { ...game, spent, usage })
  return { spent, usage }
}

/**
 * Finish a game: free the lock (if it is still this game's), give back the
 * unused reservation, and keep the record. Ending twice is harmless.
 */
export async function endGame(
  store: GameStore,
  now: number,
  gameId: string,
  record: Record<string, unknown>,
): Promise<void> {
  await settleGame(store, now, gameId, record)
  const lock = await readLock(store)
  if (lock?.gameId === gameId) await store.setJSON(LOCK_KEY, { ...lock, until: 0 } satisfies Lock)
}

/** Mark a game ended and return its unused reservation to its own month. No-op if already ended. */
async function settleGame(store: GameStore, now: number, gameId: string, record: Record<string, unknown>): Promise<void> {
  const game = await readGame(store, gameId)
  if (!game || game.ended) return
  const unused = Math.max(0, game.reserved - game.spent)
  const budget = await readBudget(store, game.month)
  await writeBudget(store, game.month, { ...budget, reserved: budget.reserved - unused })
  await store.setJSON(`games/${gameId}`, { ...game, ended: true })
  await store.setJSON(`games/saved/${gameId}`, {
    ...record,
    gameId,
    white: game.white,
    black: game.black,
    // Money and usage come from the server-tracked game; whatever the caller put in the record is overwritten.
    spent: round(game.spent),
    reserved: round(game.reserved),
    usage: game.usage,
    endedAt: now,
  })
}
