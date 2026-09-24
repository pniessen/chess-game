// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest'
import {
  COACH_LIMITS,
  answerKey,
  isAllowedOrigin,
  isProductionHost,
  readAnswer,
  reserveBudget,
  takeRateLimit,
  utcDay,
  visitorKey,
  writeAnswer,
  type CoachStore,
} from './limits'

/** An in-memory stand-in for Netlify Blobs, with the same two methods. */
export function fakeStore(): CoachStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    setJSON: async (key, value) => {
      // Round-trip through JSON, as the real store does.
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
  }
}

const NOW = Date.UTC(2026, 8, 23, 12, 0, 0)
const VISITOR = visitorKey('203.0.113.7')

let store: ReturnType<typeof fakeStore>
beforeEach(() => {
  store = fakeStore()
})

describe('visitor keys', () => {
  test('the raw IP is never stored, and the same IP maps to the same key', () => {
    const key = visitorKey('203.0.113.7')
    expect(key).not.toContain('203.0.113.7')
    expect(key).toBe(visitorKey('203.0.113.7'))
    expect(key).not.toBe(visitorKey('203.0.113.8'))
  })
})

describe('the answer cache', () => {
  test('key order in the request body does not split the cache', () => {
    expect(answerKey('hint', { a: 1, b: 2 })).toBe(answerKey('hint', { b: 2, a: 1 }))
  })

  test('the endpoint, the position and the line are all part of the key', () => {
    expect(answerKey('hint', { fen: 'x' })).not.toBe(answerKey('review', { fen: 'x' }))
    expect(answerKey('hint', { fen: 'x' })).not.toBe(answerKey('hint', { fen: 'y' }))
  })

  test('an answer is served back, and expires after the TTL', async () => {
    const key = answerKey('hint', { fen: 'x' })
    await writeAnswer(store, key, 'Take the centre.', NOW)
    expect(await readAnswer(store, key, NOW)).toBe('Take the centre.')
    expect(await readAnswer(store, key, NOW + COACH_LIMITS.cacheTtlMs - 1)).toBe('Take the centre.')
    expect(await readAnswer(store, key, NOW + COACH_LIMITS.cacheTtlMs + 1)).toBeNull()
  })

  test('a miss, and a garbled entry, both read as no answer', async () => {
    expect(await readAnswer(store, 'answer/nothing', NOW)).toBeNull()
    await store.setJSON('answer/junk', { text: 42 })
    expect(await readAnswer(store, 'answer/junk', NOW)).toBeNull()
  })
})

describe('the per-visitor rate limit', () => {
  test('a burst is allowed up to the limit and then refused', async () => {
    for (let i = 0; i < COACH_LIMITS.perIpBurst; i++) {
      expect(await takeRateLimit(store, VISITOR, NOW + i)).toBe(true)
    }
    expect(await takeRateLimit(store, VISITOR, NOW + COACH_LIMITS.perIpBurst)).toBe(false)
  })

  test('the window slides: once the oldest request ages out, requests flow again', async () => {
    for (let i = 0; i < COACH_LIMITS.perIpBurst; i++) {
      await takeRateLimit(store, VISITOR, NOW + i)
    }
    expect(await takeRateLimit(store, VISITOR, NOW + COACH_LIMITS.perIpWindowMs)).toBe(true)
  })

  test('a refused request does not extend its own ban', async () => {
    for (let i = 0; i < COACH_LIMITS.perIpBurst; i++) {
      await takeRateLimit(store, VISITOR, NOW)
    }
    const before = JSON.stringify(store.data.get(`visitor/${VISITOR}`))
    expect(await takeRateLimit(store, VISITOR, NOW + 1)).toBe(false)
    expect(JSON.stringify(store.data.get(`visitor/${VISITOR}`))).toBe(before)
  })

  test('visitors are limited independently', async () => {
    const other = visitorKey('198.51.100.4')
    for (let i = 0; i < COACH_LIMITS.perIpBurst; i++) {
      await takeRateLimit(store, VISITOR, NOW)
    }
    expect(await takeRateLimit(store, VISITOR, NOW)).toBe(false)
    expect(await takeRateLimit(store, other, NOW)).toBe(true)
  })
})

describe('the daily budget', () => {
  test('a review costs more units than a hint', () => {
    expect(COACH_LIMITS.unitCost.review).toBeGreaterThan(COACH_LIMITS.unitCost.hint)
  })

  test('the site-wide day is capped, and refusals do not spend', async () => {
    await store.setJSON(`budget/${utcDay(NOW)}`, { units: COACH_LIMITS.dailyUnits })
    expect(await reserveBudget(store, VISITOR, 'hint', NOW)).toBe(false)
    expect(store.data.get(`budget/${utcDay(NOW)}`)).toEqual({ units: COACH_LIMITS.dailyUnits })
  })

  test('a review is refused when only a hint would still fit', async () => {
    await store.setJSON(`budget/${utcDay(NOW)}`, { units: COACH_LIMITS.dailyUnits - 1 })
    expect(await reserveBudget(store, VISITOR, 'review', NOW)).toBe(false)
    expect(await reserveBudget(store, VISITOR, 'hint', NOW)).toBe(true)
  })

  test('the budget resets on the next UTC day', async () => {
    await store.setJSON(`budget/${utcDay(NOW)}`, { units: COACH_LIMITS.dailyUnits })
    expect(await reserveBudget(store, VISITOR, 'hint', NOW + 24 * 60 * 60_000)).toBe(true)
  })

  test('one visitor cannot drain the whole day', async () => {
    let allowed = 0
    for (let i = 0; i < COACH_LIMITS.dailyUnits; i++) {
      if (await reserveBudget(store, VISITOR, 'hint', NOW)) allowed++
    }
    expect(allowed).toBe(COACH_LIMITS.perIpDailyUnits)
    expect(COACH_LIMITS.perIpDailyUnits).toBeLessThan(COACH_LIMITS.dailyUnits)
    // …and the site still has budget left for everyone else.
    expect(await reserveBudget(store, visitorKey('198.51.100.4'), 'hint', NOW)).toBe(true)
  })

  test("a visitor's daily units reset with the day, while the sliding window is untouched", async () => {
    await takeRateLimit(store, VISITOR, NOW)
    for (let i = 0; i < COACH_LIMITS.perIpDailyUnits; i++) {
      await reserveBudget(store, VISITOR, 'hint', NOW)
    }
    expect(await reserveBudget(store, VISITOR, 'hint', NOW)).toBe(false)
    const tomorrow = NOW + 24 * 60 * 60_000
    expect(await reserveBudget(store, VISITOR, 'hint', tomorrow)).toBe(true)
  })
})

describe('telling the live site from a preview', () => {
  test('the live host counts as production; every deploy host does not', () => {
    expect(isProductionHost('https://chess-with-claude.netlify.app/api/hint')).toBe(true)
    expect(isProductionHost('https://chess.example/api/hint')).toBe(true)
    expect(isProductionHost('https://6ab4--chess-with-claude.netlify.app/api/hint')).toBe(false)
    expect(isProductionHost('https://netlify-coach--chess-with-claude.netlify.app/api/hint')).toBe(false)
  })

  test('with nothing to go on it is never treated as production', () => {
    expect(isProductionHost(undefined)).toBe(false)
    expect(isProductionHost('not a url')).toBe(false)
  })
})

describe('the origin allow-list', () => {
  const env = {
    URL: 'https://chess-coach.netlify.app',
    DEPLOY_PRIME_URL: 'https://netlify-coach--chess-coach.netlify.app',
    DEPLOY_URL: 'https://68d0--chess-coach.netlify.app',
  }

  test("the site's own origins are allowed", () => {
    expect(isAllowedOrigin('https://chess-coach.netlify.app', env)).toBe(true)
    expect(isAllowedOrigin('https://netlify-coach--chess-coach.netlify.app', env)).toBe(true)
    expect(isAllowedOrigin('https://68d0--chess-coach.netlify.app', env)).toBe(true)
  })

  test('a developer machine is allowed on any port', () => {
    expect(isAllowedOrigin('http://localhost:5173', env)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:8888', env)).toBe(true)
  })

  test('anything else is refused, including a lookalike hostname', () => {
    expect(isAllowedOrigin('https://evil.example', env)).toBe(false)
    expect(isAllowedOrigin('https://chess-coach.netlify.app.evil.example', env)).toBe(false)
    expect(isAllowedOrigin('https://localhost.evil.example', env)).toBe(false)
    expect(isAllowedOrigin('http://chess-coach.netlify.app', env)).toBe(false) // scheme matters
    expect(isAllowedOrigin(null, env)).toBe(false)
    expect(isAllowedOrigin('not a url', env)).toBe(false)
  })

  test('a custom domain can be added, and a malformed one never widens the list', () => {
    expect(isAllowedOrigin('https://chess.example', { ...env, COACH_ALLOWED_ORIGINS: 'https://chess.example' })).toBe(
      true,
    )
    expect(isAllowedOrigin('https://evil.example', { ...env, COACH_ALLOWED_ORIGINS: '???, ' })).toBe(false)
  })

  test('with no deploy URLs configured at all, only localhost gets in', () => {
    expect(isAllowedOrigin('https://chess-coach.netlify.app', {})).toBe(false)
    expect(isAllowedOrigin('http://localhost:5173', {})).toBe(true)
  })

  test("the page served by this very deploy is allowed even with no env at all", () => {
    const here = 'https://deploy-preview--chess-coach.netlify.app/api/hint'
    expect(isAllowedOrigin('https://deploy-preview--chess-coach.netlify.app', {}, here)).toBe(true)
    expect(isAllowedOrigin('https://evil.example', {}, here)).toBe(false)
  })
})
