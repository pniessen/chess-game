import { describe, expect, it, vi } from 'vitest'
import { createGameClient, fetchBudget } from './gameClient'
import { CLAUDE_SESSION_IDLE_MS } from './models'

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const err = (status: number, kind: string): Response => reply(status, { error: { kind, message: 'x' } })
const started = () => reply(200, { gameId: 'g1', token: 'tok', budgetLeftUsd: 12.5 })
const W_USAGE = { costUsd: 0.015, ms: 2100, inputTokens: 900, outputTokens: 120, calls: 2 }
const B_USAGE = { costUsd: 0.005, ms: 700, inputTokens: 950, outputTokens: 30, calls: 1 }
const ZERO = { costUsd: 0, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0 }
const moved = () =>
  reply(200, { san: 'e4', why: 'centre', costUsd: 0.01, gameSpentUsd: 0.02, usage: { w: W_USAGE, b: B_USAGE } })

function setup(...responses: Array<Response | Error>) {
  return setupAt(() => 0, ...responses)
}

/** setup() with an injectable clock (ms). */
function setupAt(now: () => number, ...responses: Array<Response | Error>) {
  const queue = [...responses]
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const r = queue.shift()
    if (!r) throw new Error('unexpected fetch')
    if (r instanceof Error) throw r
    return r
  })
  const client = createGameClient({ fetch: fetch as unknown as typeof globalThis.fetch, now })
  return { fetch, client }
}

const bodyOf = (fetch: ReturnType<typeof setup>['fetch'], i: number) => JSON.parse(String(fetch.mock.calls[i]![1]!.body))

describe('begin', () => {
  it('posts the keys as JSON, with no owner header, and reports the budget', async () => {
    const { fetch, client } = setup(started())
    expect(await client.begin('opus', 'haiku')).toEqual({ ok: true, budgetLeftUsd: 12.5 })
    expect(fetch.mock.calls[0]![0]).toBe('/api/game/start')
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({ 'content-type': 'application/json' })
    expect(bodyOf(fetch, 0)).toEqual({ white: 'opus', black: 'haiku' })
  })

  it.each([
    [409, 'busy', 'busy'],
    [402, 'budget', 'budget'],
    [403, 'forbidden', 'forbidden'],
    [400, 'bad-request', 'unavailable'],
    [500, 'upstream', 'unavailable'],
  ] as const)('maps %i %s to %s', async (status, kind, want) => {
    const { client } = setup(err(status, kind))
    expect(await client.begin('opus', 'opus')).toEqual({ ok: false, kind: want })
  })

  it('maps a network error or non-JSON body to unavailable', async () => {
    expect(await setup(new Error('down')).client.begin('opus', 'opus')).toEqual({ ok: false, kind: 'unavailable' })
    expect(await setup(reply(502, '<html>')).client.begin('opus', 'opus')).toEqual({ ok: false, kind: 'unavailable' })
  })
})

describe('move usage', () => {
  it('a reply without usage (or with junk in it) reads as zero usage rather than failing the move', async () => {
    const { client } = setup(
      started(),
      reply(200, { san: 'e4', why: 'c', costUsd: 0.01, gameSpentUsd: 0.01 }),
      reply(200, { san: 'e4', why: 'c', costUsd: 0.01, gameSpentUsd: 0.01, usage: { w: { ms: 'x', calls: 3 }, b: 7 } }),
    )
    await client.begin('opus', 'opus')
    expect(await client.move({ history: [] })).toMatchObject({ ok: true, usage: { w: ZERO, b: ZERO } })
    expect(await client.move({ history: [] })).toMatchObject({ ok: true, usage: { w: { ...ZERO, calls: 3 }, b: ZERO } })
  })
})

describe('move', () => {
  it('sends the stored game id and token and returns the move', async () => {
    const { fetch, client } = setup(started(), moved())
    await client.begin('opus', 'opus')
    expect(await client.move({ startFen: 'fen', history: ['e4'] })).toEqual({
      ok: true, san: 'e4', why: 'centre', costUsd: 0.01, gameSpentUsd: 0.02, usage: { w: W_USAGE, b: B_USAGE },
    })
    expect(fetch.mock.calls[1]![0]).toBe('/api/game/move')
    expect(bodyOf(fetch, 1)).toEqual({ gameId: 'g1', token: 'tok', startFen: 'fen', history: ['e4'] })
  })

  it('omits startFen when absent', async () => {
    const { fetch, client } = setup(started(), moved())
    await client.begin('opus', 'opus')
    await client.move({ history: [] })
    expect(bodyOf(fetch, 1)).not.toHaveProperty('startFen')
  })

  it('is fatal without a network call before begin succeeds', async () => {
    const { fetch, client } = setup(err(409, 'busy'))
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: 'fatal' })
    await client.begin('opus', 'opus')
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: 'fatal' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [502, 'illegal-reply', 'retry'],
    [502, 'timeout', 'retry'],
    [502, 'upstream', 'retry'],
    [502, 'rate-limited', 'retry'],
    [500, 'upstream', 'retry'],
    [402, 'budget', 'budget'],
    [409, 'over', 'fatal'],
    // The local server restarted: its new secret rejects this game's token.
    // Nothing a retry can fix, and not a generic failure either.
    [403, 'forbidden', 'lost'],
    [503, 'no-key', 'fatal'],
    [400, 'bad-request', 'fatal'],
  ] as const)('maps %i %s to %s', async (status, kind, want) => {
    const { client } = setup(started(), err(status, kind))
    await client.begin('opus', 'opus')
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: want })
  })

  it('maps a network TypeError from fetch to retry: a Wi-Fi blip must not end a paid game', async () => {
    const { client } = setup(started(), new TypeError('Failed to fetch'))
    await client.begin('opus', 'opus')
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: 'retry' })
  })

  it('maps any other thrown error or a non-JSON body to fatal', async () => {
    const a = setup(started(), new Error('down'))
    await a.client.begin('opus', 'opus')
    expect(await a.client.move({ history: [] })).toEqual({ ok: false, kind: 'fatal' })
    const b = setup(started(), reply(200, 'not json'))
    await b.client.begin('opus', 'opus')
    expect(await b.client.move({ history: [] })).toEqual({ ok: false, kind: 'fatal' })
  })

  it('resolves a caller abort to retry, whether before or during the call', async () => {
    const pre = setup(started())
    await pre.client.begin('opus', 'opus')
    const ac = new AbortController()
    ac.abort()
    expect(await pre.client.move({ history: [] }, ac.signal)).toEqual({ ok: false, kind: 'retry' })
    expect(pre.fetch).toHaveBeenCalledTimes(1)

    const ac2 = new AbortController()
    const { client } = setup(started(), Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await client.begin('opus', 'opus')
    const p = client.move({ history: [] }, ac2.signal)
    ac2.abort()
    expect(await p).toEqual({ ok: false, kind: 'retry' })
  })
})

describe('end', () => {
  const record = { pgn: '1. e4 *', fallbacks: { w: 1, b: 2 } }

  it('posts the record with keepalive', async () => {
    const { fetch, client } = setup(started(), reply(200, { ok: true }))
    await client.begin('opus', 'opus')
    await client.end(record)
    expect(fetch.mock.calls[1]![0]).toBe('/api/game/end')
    expect(fetch.mock.calls[1]![1]!.keepalive).toBe(true)
    expect(bodyOf(fetch, 1)).toEqual({ gameId: 'g1', token: 'tok', ...record })
  })

  it('is a no-op the second time and before begin', async () => {
    const { fetch, client } = setup(started(), reply(200, { ok: true }))
    await client.end(record)
    await client.begin('opus', 'opus')
    await client.end(record)
    await client.end(record)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never throws and still clears the game', async () => {
    const { fetch, client } = setup(started(), new Error('down'))
    await client.begin('opus', 'opus')
    await expect(client.end(record)).resolves.toBeUndefined()
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: 'fatal' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('fetchBudget', () => {
  const opts = (f: unknown) => ({ fetch: f as typeof globalThis.fetch })

  it('reads budgetLeftUsd with a plain GET (no owner header)', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => reply(200, { budgetLeftUsd: 7, monthlyUsd: 20 }))
    expect(await fetchBudget(opts(f))).toEqual({ budgetLeftUsd: 7, byModel: {}, earlierUsd: 0 })
    expect(f.mock.calls[0]![0]).toBe('/api/game/budget')
    expect(f.mock.calls[0]![1]).toBeUndefined()
  })

  it('reads the month\'s usage per model and the earlier dollars; unknown models are dropped', async () => {
    const body = { budgetLeftUsd: 7, byModel: { fable: W_USAGE, haiku: B_USAGE, gpt: W_USAGE }, earlierUsd: 0.13 }
    expect(await fetchBudget(opts(async () => reply(200, body)))).toEqual({
      budgetLeftUsd: 7,
      byModel: { fable: W_USAGE, haiku: B_USAGE },
      earlierUsd: 0.13,
    })
  })

  it('is null on a refusal, a bad body or a network error', async () => {
    expect(await fetchBudget(opts(async () => err(403, 'forbidden')))).toBeNull()
    expect(await fetchBudget(opts(async () => err(503, 'no-key')))).toBeNull()
    expect(await fetchBudget(opts(async () => reply(200, '{}')))).toBeNull()
    expect(await fetchBudget(opts(async () => { throw new Error('down') }))).toBeNull()
  })
})

describe('sessionFresh: the server lock (30 min) is not outlived', () => {
  const MIN = 60_000

  it('fresh from begin until 25 minutes without server contact, then stale', async () => {
    let t = 1_000_000
    const { client } = setupAt(() => t, started())
    expect(client.sessionFresh?.()).toBe(false) // nothing begun
    await client.begin('opus', 'opus')
    t += CLAUDE_SESSION_IDLE_MS
    expect(client.sessionFresh?.()).toBe(true)
    t += 1
    expect(client.sessionFresh?.()).toBe(false)
  })

  it('a move response is contact, dated from when its request was sent', async () => {
    let t = 0
    let answer: (r: Response) => void = () => {}
    const fetch = vi.fn(async (url: unknown) =>
      String(url).endsWith('/start') ? started() : new Promise<Response>((resolve) => (answer = resolve)),
    )
    const client = createGameClient({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => t })
    await client.begin('opus', 'opus')
    t = 20 * MIN
    const p = client.move({ history: [] })
    t = 21 * MIN
    answer(err(502, 'timeout'))
    await p
    // Fresh until 25 minutes after the SEND (20 min), not the answer (21 min).
    t = 45 * MIN
    expect(client.sessionFresh?.()).toBe(true)
    t = 45 * MIN + 1
    expect(client.sessionFresh?.()).toBe(false)
  })

  it('a move that never reached the server is not contact; end forgets the session', async () => {
    let t = 0
    const { client } = setupAt(() => t, started(), new TypeError('Failed to fetch'), reply(200, { ok: true }))
    await client.begin('opus', 'opus')
    t = 20 * MIN
    await client.move({ history: [] })
    t = 25 * MIN + 1
    expect(client.sessionFresh?.()).toBe(false)
    t = 0
    await client.end({ pgn: '*', fallbacks: { w: 0, b: 0 } })
    expect(client.sessionFresh?.()).toBe(false)
  })

  it('the idle limit sits inside the server lock TTL', () => {
    expect(CLAUDE_SESSION_IDLE_MS).toBe(25 * MIN)
  })
})
