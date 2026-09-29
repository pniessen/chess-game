/**
 * Spending and access controls for owner-only Claude-vs-Claude games.
 *
 * Every game spends real money, so the endpoints behind this module are
 * closed to everyone but the owner (`OWNER_TOKEN`), allow one game at a time
 * site-wide, and draw on a monthly dollar budget. Each game reserves its
 * worst-case cost when it starts; moves are charged as they happen and the
 * unused part of the reservation goes back when the game ends.
 *
 * Like `limits.ts`, nothing here knows about Netlify: the store is the same
 * two-method interface, and the budget lives under its own `games/` keys so
 * it never touches the coach's counters.
 *
 * Netlify Blobs has no compare-and-set, so two racing requests could both
 * read the same lock or total. For an owner-only feature that runs one game
 * at a time that race is accepted; building locking around it would cost
 * more than the overshoot it prevents.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { RESERVE_PER_GAME_USD, isClaudeModelKey, type ClaudeModelKey } from '../../src/claude/models'
import type { CoachStore } from './limits'

/** Every limit, in one place. */
export const GAMES_LIMITS = {
  /** Dollars the whole site may spend on Claude games per UTC month. */
  monthlyUsd: 20,
  /** How long a game holds the site-wide lock without a move. */
  lockTtlMs: 30 * 60_000,
  /** Plies after which a game is adjudicated a draw. */
  plyCap: 160,
} as const

type Env = Record<string, string | undefined>
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

/** Whether the request's token header is the owner's. Closed when no token is configured. */
export function checkOwner(header: string | null, env: Env): boolean {
  const token = env['OWNER_TOKEN']
  if (!token || header === null) return false
  return safeEqual(header, token)
}

/** The bearer for one game: an HMAC of its id under the owner token, so it cannot be forged or reused. */
function gameToken(gameId: string, env: Env): string {
  return createHmac('sha256', env['OWNER_TOKEN'] ?? '').update(gameId).digest('hex')
}

interface Budget {
  /** Dollars actually charged this month. */
  spent: number
  /** Dollars held for games in progress and not yet spent. */
  reserved: number
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
}

async function readBudget(store: CoachStore, month: string): Promise<Budget> {
  const v = await store.get(budgetKey(month), { type: 'json' }).catch(() => null)
  return isRecord(v) ? { spent: num(v['spent']), reserved: num(v['reserved']) } : { spent: 0, reserved: 0 }
}

async function writeBudget(store: CoachStore, month: string, b: Budget): Promise<void> {
  await store.setJSON(budgetKey(month), { spent: round(Math.max(0, b.spent)), reserved: round(Math.max(0, b.reserved)) })
}

async function readGame(store: CoachStore, gameId: string): Promise<Game | null> {
  const v = await store.get(`games/${gameId}`, { type: 'json' }).catch(() => null)
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
  }
}

async function readLock(store: CoachStore): Promise<{ gameId: string; until: number } | null> {
  const v = await store.get(LOCK_KEY, { type: 'json' }).catch(() => null)
  return isRecord(v) && typeof v['gameId'] === 'string' ? { gameId: v['gameId'], until: num(v['until']) } : null
}

/** Dollars still available this month: neither spent nor held for a game in progress. */
export async function budgetLeft(store: CoachStore, now: number): Promise<number> {
  const b = await readBudget(store, utcMonth(now))
  return round(Math.max(0, GAMES_LIMITS.monthlyUsd - b.spent - b.reserved))
}

/**
 * Begin a game: check the lock, reserve the worst-case cost, and mint the
 * token the browser sends with each move.
 */
export async function startGame(
  store: CoachStore,
  now: number,
  env: Env,
  sides: { white: string; black: string },
): Promise<
  | { ok: true; gameId: string; token: string; budgetLeftUsd: number }
  | { ok: false; kind: 'busy' | 'budget' | 'bad-request' }
> {
  const { white, black } = sides
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return { ok: false, kind: 'bad-request' }

  const lock = await readLock(store)
  if (lock && lock.until > now) return { ok: false, kind: 'busy' }

  const month = utcMonth(now)
  const reserve = round(RESERVE_PER_GAME_USD[white] + RESERVE_PER_GAME_USD[black])
  const budget = await readBudget(store, month)
  if (round(budget.spent + budget.reserved + reserve) > GAMES_LIMITS.monthlyUsd) return { ok: false, kind: 'budget' }

  const gameId = randomUUID()
  await writeBudget(store, month, { spent: budget.spent, reserved: budget.reserved + reserve })
  const game: Game = { white, black, reserved: reserve, spent: 0, plies: 0, startedAt: now, month }
  await store.setJSON(`games/${gameId}`, game)
  await store.setJSON(LOCK_KEY, { gameId, until: now + GAMES_LIMITS.lockTtlMs })
  return { ok: true, gameId, token: gameToken(gameId, env), budgetLeftUsd: await budgetLeft(store, now) }
}

/**
 * Whether the next move of `side` may be requested from Claude: the token
 * is this game's, this game still holds the lock, the game is under the ply
 * cap and its reservation is not used up. Each authorised move extends the
 * lock, so a long game keeps it for as long as it keeps moving.
 */
export async function authorizeMove(
  store: CoachStore,
  now: number,
  env: Env,
  req: { gameId: string; token: string; side: Side; plies: number },
): Promise<{ ok: true; model: ClaudeModelKey } | { ok: false; kind: 'forbidden' | 'budget' | 'over' }> {
  const forbidden = { ok: false, kind: 'forbidden' } as const
  if (!env['OWNER_TOKEN'] || !safeEqual(req.token, gameToken(req.gameId, env))) return forbidden

  const game = await readGame(store, req.gameId)
  if (!game || game.ended) return forbidden
  const lock = await readLock(store)
  if (!lock || lock.gameId !== req.gameId || lock.until <= now) return forbidden

  if (req.plies >= GAMES_LIMITS.plyCap) return { ok: false, kind: 'over' }
  if (round(game.spent) >= round(game.reserved)) return { ok: false, kind: 'budget' }

  await store.setJSON(LOCK_KEY, { gameId: req.gameId, until: now + GAMES_LIMITS.lockTtlMs })
  return { ok: true, model: game[req.side] }
}

/**
 * Record what a move cost. It counts against the game's reservation first,
 * so the month's "left" only moves when a game ends or overspends.
 */
export async function chargeMove(store: CoachStore, _now: number, gameId: string, costUsd: number): Promise<void> {
  const game = await readGame(store, gameId)
  if (!game || game.ended || !(costUsd > 0)) return
  const held = Math.max(0, game.reserved - game.spent)
  const fromReservation = Math.min(costUsd, held)
  const budget = await readBudget(store, game.month)
  await writeBudget(store, game.month, { spent: budget.spent + costUsd, reserved: budget.reserved - fromReservation })
  await store.setJSON(`games/${gameId}`, { ...game, spent: round(game.spent + costUsd) })
}

/**
 * Finish a game: free the lock (if it is still this game's), give back the
 * unused reservation, and keep the record. Ending twice is harmless.
 */
export async function endGame(
  store: CoachStore,
  now: number,
  gameId: string,
  record: Record<string, unknown>,
): Promise<void> {
  const game = await readGame(store, gameId)
  if (game && !game.ended) {
    const unused = Math.max(0, game.reserved - game.spent)
    const budget = await readBudget(store, game.month)
    await writeBudget(store, game.month, { spent: budget.spent, reserved: budget.reserved - unused })
    await store.setJSON(`games/${gameId}`, { ...game, ended: true })
    await store.setJSON(`games/saved/${gameId}`, { ...record, gameId, white: game.white, black: game.black, endedAt: now })
  }
  const lock = await readLock(store)
  if (lock?.gameId === gameId) await store.setJSON(LOCK_KEY, { gameId, until: 0 })
}

