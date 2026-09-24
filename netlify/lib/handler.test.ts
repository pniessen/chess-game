// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest'
import type { CoachErrorResponse } from '../../src/coach/protocol'
import type { Claude, ClaudeRequest, ClaudeResult } from '../../server/claude'
import { LIMIT_MESSAGE, handleCoach, handleHealth, type CoachDeps } from './handler'
import { COACH_LIMITS, utcDay, visitorKey } from './limits'
import { fakeStore } from './limits.test'

const SITE = 'https://chess-coach.netlify.app'
const ENV = { URL: SITE, ANTHROPIC_API_KEY: 'sk-test-not-a-real-key' }
const IP = '203.0.113.7'
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0)

const HINT = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  bestMoveSan: 'e4',
  line: ['e4', 'e5'],
  evaluation: '+0.3',
}
const REVIEW = {
  moves: ['e4', 'e5'],
  firstMover: 'w',
  result: '*',
  opening: null,
  accuracy: { w: 100, b: 100 },
  flagged: [],
  humanSide: 'w',
}

/** A Claude that records what it was asked and never touches the network. */
function fakeClaude(result: ClaudeResult = { ok: true, text: 'Take the centre.' }): Claude & { calls: ClaudeRequest[] } {
  const calls: ClaudeRequest[] = []
  return { calls, complete: async (req) => (calls.push(req), result) }
}

let store: ReturnType<typeof fakeStore>
let claude: ReturnType<typeof fakeClaude>

beforeEach(() => {
  store = fakeStore()
  claude = fakeClaude()
})

const deps = (over: Partial<CoachDeps> = {}): CoachDeps => ({
  store,
  claude,
  env: ENV,
  ip: IP,
  now: () => NOW,
  ...over,
})

function post(body: unknown, init: { origin?: string | null; raw?: string; method?: string } = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  const origin = init.origin === undefined ? SITE : init.origin
  if (origin !== null) headers.set('origin', origin)
  return new Request('https://chess-coach.netlify.app/api/hint', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? undefined : (init.raw ?? JSON.stringify(body)),
  })
}

const kindOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as CoachErrorResponse).error?.kind

describe('health', () => {
  test('reports whether a key is configured, and never anything about its value', async () => {
    const withKey = await handleHealth(ENV).json()
    expect(withKey).toEqual({ ok: true, claude: true })
    expect(JSON.stringify(withKey)).not.toContain('sk-test')

    expect(await handleHealth({}).json()).toEqual({ ok: true, claude: false })
    expect(await handleHealth({ ANTHROPIC_API_KEY: '   ' }).json()).toEqual({ ok: true, claude: false })
  })
})

describe('the request gates', () => {
  test('only POST is answered', async () => {
    const res = await handleCoach('hint', post(HINT, { method: 'GET' }), deps())
    expect(res.status).toBe(405)
    expect(claude.calls).toHaveLength(0)
  })

  test('another site cannot spend the key, and its origin is not echoed back', async () => {
    const res = await handleCoach('hint', post(HINT, { origin: 'https://evil.example' }), deps())
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(JSON.parse(body).error.kind).toBe('bad-request')
    expect(body).not.toContain('evil.example')
    expect(claude.calls).toHaveLength(0)
  })

  test('a request with no Origin at all is refused', async () => {
    expect((await handleCoach('hint', post(HINT, { origin: null }), deps())).status).toBe(403)
    expect(claude.calls).toHaveLength(0)
  })

  test('a developer running the site locally is allowed', async () => {
    const res = await handleCoach('hint', post(HINT, { origin: 'http://localhost:5173' }), deps())
    expect(res.status).toBe(200)
  })

  test('an oversized body is a 413 and a malformed one a 400, neither reaching Claude', async () => {
    const huge = JSON.stringify({ ...HINT, padding: 'x'.repeat(40 * 1024) })
    expect((await handleCoach('hint', post(null, { raw: huge }), deps())).status).toBe(413)
    expect((await handleCoach('hint', post(null, { raw: '{"fen":' }), deps())).status).toBe(400)
    expect(claude.calls).toHaveLength(0)
  })

  test('an invalid position is rejected before Claude, and without spending budget', async () => {
    const res = await handleCoach('hint', post({ ...HINT, fen: 'nope' }), deps())
    expect(res.status).toBe(400)
    expect(await kindOf(res)).toBe('bad-request')
    expect(claude.calls).toHaveLength(0)
    expect(store.data.get(`budget/${utcDay(NOW)}`)).toBeUndefined()
  })

  test('with no key configured the client is told no-key, exactly as the local server would', async () => {
    const res = await handleCoach('hint', post(HINT), deps({ claude: null }))
    expect(res.status).toBe(503)
    expect(await kindOf(res)).toBe('no-key')
  })
})

describe('relaying to Claude', () => {
  test('a valid hint reaches Claude and its text comes back', async () => {
    const res = await handleCoach('hint', post(HINT), deps())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Take the centre.' })
    expect(claude.calls[0]?.user).toContain(HINT.fen)
  })

  test('a review works the same way', async () => {
    claude = fakeClaude({ ok: true, text: 'Good game.' })
    const res = await handleCoach('review', post(REVIEW), deps())
    expect(await res.json()).toEqual({ text: 'Good game.' })
  })

  test('replies are capped short, which is what the spending ceiling rests on', async () => {
    await handleCoach('hint', post(HINT), deps())
    expect(claude.calls[0]?.maxTokens).toBe(COACH_LIMITS.maxTokens.hint)

    claude = fakeClaude()
    await handleCoach('review', post(REVIEW), deps())
    expect(claude.calls[0]?.maxTokens).toBe(COACH_LIMITS.maxTokens.review)
  })

  test('a Claude failure is passed through with its kind, so the app can say why once', async () => {
    claude = fakeClaude({ ok: false, kind: 'timeout', message: 'Claude did not answer within 15 seconds.' })
    const res = await handleCoach('hint', post(HINT), deps())
    expect(res.status).toBe(503)
    expect(await kindOf(res)).toBe('timeout')
    // A failed answer is not cached.
    expect([...store.data.keys()].some((k) => k.startsWith('answer/'))).toBe(false)
  })
})

describe('the cache', () => {
  test('an identical request is answered from the cache without paying again', async () => {
    const first = await handleCoach('hint', post(HINT), deps())
    expect(first.headers.get('x-coach-cache')).toBeNull()

    const second = await handleCoach('hint', post(HINT), deps())
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ text: 'Take the centre.' })
    expect(second.headers.get('x-coach-cache')).toBe('hit')
    expect(claude.calls).toHaveLength(1)
  })

  test('a cache hit costs no budget', async () => {
    await handleCoach('hint', post(HINT), deps())
    const spent = store.data.get(`budget/${utcDay(NOW)}`)
    await handleCoach('hint', post(HINT), deps())
    expect(store.data.get(`budget/${utcDay(NOW)}`)).toEqual(spent)
  })

  test('a different position is a different answer', async () => {
    await handleCoach('hint', post(HINT), deps())
    await handleCoach('hint', post({ ...HINT, bestMoveSan: 'd4', line: ['d4'] }), deps())
    expect(claude.calls).toHaveLength(2)
  })
})

describe('when a limit is hit', () => {
  /**
   * Every limit answers `no-key`, which is what makes the fallback silent:
   * `CoachClient` treats that kind as "stop asking for this session", shows
   * the quiet "coaching offline" badge and uses its built-in hints — no
   * banner, no retry loop.
   */
  const expectSilentFallback = async (res: Response): Promise<void> => {
    expect(res.status).toBe(503)
    expect(await kindOf(res)).toBe('no-key')
  }

  test('an exhausted day pauses coaching without reaching Claude', async () => {
    await store.setJSON(`budget/${utcDay(NOW)}`, { units: COACH_LIMITS.dailyUnits })
    const res = await handleCoach('hint', post(HINT), deps())
    await expectSilentFallback(res.clone())
    expect(res.headers.get('x-coach-limit')).toBe('budget')
    expect(claude.calls).toHaveLength(0)
  })

  test('a visitor asking too fast is throttled, again without reaching Claude', async () => {
    for (let i = 0; i < COACH_LIMITS.perIpBurst; i++) {
      await handleCoach('hint', post({ ...HINT, evaluation: `+${i}.0` }), deps())
    }
    const res = await handleCoach('hint', post({ ...HINT, evaluation: '+99.9' }), deps())
    await expectSilentFallback(res.clone())
    expect(res.headers.get('x-coach-limit')).toBe('rate')
    expect(claude.calls).toHaveLength(COACH_LIMITS.perIpBurst)
  })

  test('the limit message names no internals', async () => {
    await store.setJSON(`budget/${utcDay(NOW)}`, { units: COACH_LIMITS.dailyUnits })
    const body = await (await handleCoach('hint', post(HINT), deps())).text()
    expect(body).toContain(LIMIT_MESSAGE)
    expect(body).not.toContain('sk-test')
  })

  test("one visitor's spending does not stop everyone else", async () => {
    await store.setJSON(`visitor/${visitorKey(IP)}`, {
      times: [],
      day: utcDay(NOW),
      units: COACH_LIMITS.perIpDailyUnits,
    })
    await expectSilentFallback(await handleCoach('hint', post(HINT), deps()))
    const other = await handleCoach('hint', post(HINT), deps({ ip: '198.51.100.4' }))
    expect(other.status).toBe(200)
  })
})
