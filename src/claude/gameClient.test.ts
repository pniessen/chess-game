import { describe, expect, it, vi } from 'vitest'
import { createGameClient, fetchBudget } from './gameClient'
import { getOwnerToken, setOwnerToken } from './ownerToken'

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
const err = (status: number, kind: string): Response => reply(status, { error: { kind, message: 'x' } })
const started = () => reply(200, { gameId: 'g1', token: 'tok', budgetLeftUsd: 12.5 })
const moved = () => reply(200, { san: 'e4', why: 'centre', costUsd: 0.01, gameSpentUsd: 0.02 })

function setup(...responses: Array<Response | Error>) {
  const queue = [...responses]
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const r = queue.shift()
    if (!r) throw new Error('unexpected fetch')
    if (r instanceof Error) throw r
    return r
  })
  const client = createGameClient({ fetch: fetch as unknown as typeof globalThis.fetch, ownerToken: () => 'owner' })
  return { fetch, client }
}

const bodyOf = (fetch: ReturnType<typeof setup>['fetch'], i: number) => JSON.parse(String(fetch.mock.calls[i]![1]!.body))

describe('begin', () => {
  it('posts the keys with the owner header and reports the budget', async () => {
    const { fetch, client } = setup(started())
    expect(await client.begin('opus', 'haiku')).toEqual({ ok: true, budgetLeftUsd: 12.5 })
    expect(fetch.mock.calls[0]![0]).toBe('/api/game/start')
    expect((fetch.mock.calls[0]![1]!.headers as Record<string, string>)['x-owner-token']).toBe('owner')
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

describe('move', () => {
  it('sends the stored game id and token and returns the move', async () => {
    const { fetch, client } = setup(started(), moved())
    await client.begin('opus', 'opus')
    expect(await client.move({ startFen: 'fen', history: ['e4'] })).toEqual({
      ok: true, san: 'e4', why: 'centre', costUsd: 0.01, gameSpentUsd: 0.02,
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
    [409, 'over', 'budget'],
    [403, 'forbidden', 'fatal'],
    [503, 'no-key', 'fatal'],
    [400, 'bad-request', 'fatal'],
  ] as const)('maps %i %s to %s', async (status, kind, want) => {
    const { client } = setup(started(), err(status, kind))
    await client.begin('opus', 'opus')
    expect(await client.move({ history: [] })).toEqual({ ok: false, kind: want })
  })

  it('maps a network error or non-JSON body to fatal', async () => {
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
  const opts = (f: unknown) => ({ fetch: f as typeof globalThis.fetch, ownerToken: () => 'owner' })

  it('reads budgetLeftUsd with the owner header', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) => reply(200, { budgetLeftUsd: 7, monthlyUsd: 20 }))
    expect(await fetchBudget(opts(f))).toBe(7)
    expect(f.mock.calls[0]![0]).toBe('/api/game/budget')
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)['x-owner-token']).toBe('owner')
  })

  it('is null on a refusal, a bad body or a network error', async () => {
    expect(await fetchBudget(opts(async () => err(403, 'forbidden')))).toBeNull()
    expect(await fetchBudget(opts(async () => reply(200, '{}')))).toBeNull()
    expect(await fetchBudget(opts(async () => { throw new Error('down') }))).toBeNull()
  })
})

describe('ownerToken', () => {
  it('round-trips through localStorage under chess.ownerToken', () => {
    localStorage.clear()
    expect(getOwnerToken()).toBeNull()
    setOwnerToken('abc')
    expect(localStorage.getItem('chess.ownerToken')).toBe('abc')
    expect(getOwnerToken()).toBe('abc')
  })

  it('removes the key for null and empty', () => {
    setOwnerToken('abc')
    setOwnerToken(null)
    expect(localStorage.getItem('chess.ownerToken')).toBeNull()
    setOwnerToken('abc')
    setOwnerToken('')
    expect(localStorage.getItem('chess.ownerToken')).toBeNull()
  })

  it('survives a throwing localStorage', () => {
    const boom = () => { throw new Error('blocked') }
    const spies = [
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom),
    ]
    try {
      expect(getOwnerToken()).toBeNull()
      expect(() => setOwnerToken('abc')).not.toThrow()
      expect(() => setOwnerToken(null)).not.toThrow()
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })
})
