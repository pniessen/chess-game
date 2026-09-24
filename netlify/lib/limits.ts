/**
 * Spending controls for the public coach endpoints.
 *
 * The deployed site is an open door onto somebody's personal Anthropic
 * credits, so every request has to get past four gates before it can cost
 * anything: it must come from this site, it must be within a per-visitor
 * rate limit, it must miss the answer cache, and there must be budget left
 * in the day. The numbers live in `COACH_LIMITS` and are documented in the
 * README; the storage is Netlify Blobs, so the counts survive the fact that
 * every invocation is a fresh, isolated process.
 *
 * Nothing here knows about Netlify specifically: the store is an interface
 * with two methods, which is also what the unit tests pass in.
 */
import { createHash } from 'node:crypto'
import type { CoachEndpoint } from '../../server/coach'

/**
 * Every limit, in one place.
 *
 * The budget is expressed in "units" rather than requests because a review
 * costs several times what a hint costs. At claude-sonnet-5's $2/MTok in,
 * $10/MTok out, one unit — a capped hint — is worth at most about $0.003,
 * so 50 units a day is roughly $0.14 a day, or ~$4/month: under the $5
 * ceiling this deployment is designed around, with the cache making the
 * realistic figure lower still.
 */
export const COACH_LIMITS = {
  /** Units the whole site may spend per UTC day, across all visitors. */
  dailyUnits: 50,
  /** What each kind of request costs against the budgets above. */
  unitCost: { hint: 1, review: 4 } satisfies Record<CoachEndpoint, number>,
  /** Units a single visitor may spend per UTC day — one person cannot drain the day. */
  perIpDailyUnits: 20,
  /** Sliding-window rate limit per visitor: at most this many requests… */
  perIpBurst: 12,
  /** …within this window. */
  perIpWindowMs: 10 * 60_000,
  /** `max_tokens` for each kind of reply. A hint is three sentences; a review is 150 words. */
  maxTokens: { hint: 200, review: 400 } satisfies Record<CoachEndpoint, number>,
  /** How long a cached answer stays servable. */
  cacheTtlMs: 30 * 24 * 60 * 60_000,
} as const

/** The two-method slice of a Netlify Blobs store that this module needs. */
export interface CoachStore {
  get(key: string, opts: { type: 'json' }): Promise<unknown>
  setJSON(key: string, value: unknown): Promise<void>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The UTC day a timestamp falls in, as `YYYY-MM-DD`. Budgets reset on it. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)

/**
 * Visitor identity for rate-limiting purposes: a salted-by-nothing SHA-256
 * of the client IP, truncated. Raw addresses are never written down — the
 * counters only ever need "is this the same visitor as a moment ago".
 */
export const visitorKey = (ip: string): string => createHash('sha256').update(ip).digest('hex').slice(0, 32)

/**
 * The cache key for an answer: the endpoint plus the exact request body.
 * Identical positions at identical levels therefore share one answer, which
 * is the single biggest saving here — a popular opening position is paid
 * for once, ever.
 */
export function answerKey(endpoint: CoachEndpoint, body: unknown): string {
  const digest = createHash('sha256').update(`${endpoint}\u0000${stableStringify(body)}`).digest('hex')
  return `answer/${digest}`
}

/** JSON with object keys in a fixed order, so key order in the request cannot split the cache. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** A previously produced answer, if one is stored and still fresh. */
export async function readAnswer(store: CoachStore, key: string, now: number): Promise<string | null> {
  const entry = await store.get(key, { type: 'json' }).catch(() => null)
  if (!isRecord(entry)) return null
  const { text, at } = entry
  if (typeof text !== 'string' || !text) return null
  if (typeof at !== 'number' || now - at > COACH_LIMITS.cacheTtlMs) return null
  return text
}

/** Remember an answer so the next identical request costs nothing. */
export async function writeAnswer(store: CoachStore, key: string, text: string, now: number): Promise<void> {
  await store.setJSON(key, { text, at: now }).catch(() => undefined)
}

interface VisitorRecord {
  /** Timestamps of recent requests, for the sliding window. */
  times: number[]
  /** The UTC day `units` is counted against; a new day resets it. */
  day: string
  units: number
}

function readVisitor(value: unknown, day: string): VisitorRecord {
  if (!isRecord(value)) return { times: [], day, units: 0 }
  const times = Array.isArray(value['times']) ? value['times'].filter((t): t is number => typeof t === 'number') : []
  const sameDay = value['day'] === day
  const units = sameDay && typeof value['units'] === 'number' ? value['units'] : 0
  return { times, day, units }
}

/**
 * Charge a request against the sliding-window rate limit.
 *
 * Returns false when this visitor has been asking too fast. The window is
 * about abuse and runaway clients, not about money — it is checked before
 * the cache, so even a cached answer cannot be fetched in a tight loop.
 */
export async function takeRateLimit(store: CoachStore, visitor: string, now: number): Promise<boolean> {
  const key = `visitor/${visitor}`
  const record = readVisitor(await store.get(key, { type: 'json' }).catch(() => null), utcDay(now))
  const recent = record.times.filter((t) => now - t < COACH_LIMITS.perIpWindowMs)
  if (recent.length >= COACH_LIMITS.perIpBurst) {
    // Still record nothing: a blocked request must not extend its own ban.
    return false
  }
  recent.push(now)
  await store.setJSON(key, { ...record, times: recent.slice(-COACH_LIMITS.perIpBurst) })
  return true
}

/**
 * Reserve budget for a request that is about to be sent to Claude.
 *
 * Both ledgers are checked: the site's day and this visitor's day. Netlify
 * Blobs has no compare-and-set, so two invocations landing in the same
 * millisecond can both read the same total and overshoot by one request —
 * a few cents a year at these prices, and the alternative (a lock) would
 * cost more in latency than it saves.
 */
export async function reserveBudget(
  store: CoachStore,
  visitor: string,
  endpoint: CoachEndpoint,
  now: number,
): Promise<boolean> {
  const cost = COACH_LIMITS.unitCost[endpoint]
  const day = utcDay(now)

  const dayKey = `budget/${day}`
  const dayEntry = await store.get(dayKey, { type: 'json' }).catch(() => null)
  const spent = isRecord(dayEntry) && typeof dayEntry['units'] === 'number' ? dayEntry['units'] : 0
  if (spent + cost > COACH_LIMITS.dailyUnits) return false

  const visitorKeyName = `visitor/${visitor}`
  const record = readVisitor(await store.get(visitorKeyName, { type: 'json' }).catch(() => null), day)
  if (record.units + cost > COACH_LIMITS.perIpDailyUnits) return false

  await store.setJSON(dayKey, { units: spent + cost })
  await store.setJSON(visitorKeyName, { ...record, units: record.units + cost })
  return true
}

/**
 * Whether a browser at `origin` may use these endpoints.
 *
 * Only this site and a developer's own machine: the point is that somebody
 * else's page cannot embed a script that spends this key. Netlify sets
 * `URL`, `DEPLOY_PRIME_URL` and `DEPLOY_URL` on every build, which covers
 * production, branch deploys and deploy previews without hard-coding a
 * hostname; `COACH_ALLOWED_ORIGINS` is there for a custom domain.
 */
export function isAllowedOrigin(origin: string | null | undefined, env: Record<string, string | undefined>): boolean {
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true

  const allowed = new Set<string>()
  for (const name of ['URL', 'DEPLOY_PRIME_URL', 'DEPLOY_URL']) {
    const value = env[name]
    if (value) addOrigin(allowed, value)
  }
  for (const value of (env['COACH_ALLOWED_ORIGINS'] ?? '').split(',')) {
    if (value.trim()) addOrigin(allowed, value.trim())
  }
  return allowed.has(parsed.origin.toLowerCase())
}

function addOrigin(set: Set<string>, value: string): void {
  try {
    set.add(new URL(value).origin.toLowerCase())
  } catch {
    // A malformed env value narrows what is allowed; it must never widen it.
  }
}
