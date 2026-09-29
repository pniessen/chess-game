// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient } from '../../server/claude'
import { handleGame } from './gameHandler'
import { GAMES_LIMITS } from './games'
import { fakeStore } from './limits.test'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const OWNER = 'fake-owner-token'
const ENV = { OWNER_TOKEN: OWNER }
const BASE = 'https://chess.example.app'
const ORIGIN = BASE

type Store = ReturnType<typeof fakeStore>
let store: Store
let calls: number
let reply: (() => Anthropic.Message | Promise<Anthropic.Message>) | null

const message = (text: string, usage = { input_tokens: 1000, output_tokens: 200 }): Anthropic.Message =>
  ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage }) as unknown as Anthropic.Message

const fakeClient = (): MessagesClient => ({
  messages: {
    create: async () => {
      calls++
      if (!reply) throw new Error('unexpected call')
      return reply()
    },
  },
})

beforeEach(() => {
  store = fakeStore()
  calls = 0
  reply = () => message(JSON.stringify({ move: 'e4', why: 'Take the centre.' }))
})

interface Opts {
  method?: string
  origin?: string | null
  owner?: string | null
  body?: unknown
  raw?: string
  client?: MessagesClient | null
  env?: Record<string, string | undefined>
  store?: Parameters<typeof handleGame>[2]['store']
}

async function call(endpoint: 'start' | 'move' | 'end' | 'budget', o: Opts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const origin = o.origin === undefined ? ORIGIN : o.origin
  if (origin) headers['origin'] = origin
  const owner = o.owner === undefined ? OWNER : o.owner
  if (owner !== null) headers['x-owner-token'] = owner
  const method = o.method ?? (endpoint === 'budget' ? 'GET' : 'POST')
  const res = await handleGame(endpoint, new Request(`${BASE}/api/game/${endpoint}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : (o.raw ?? JSON.stringify(o.body ?? {})),
  }), {
    store: o.store ?? store,
    env: o.env ?? ENV,
    client: o.client === undefined ? fakeClient() : o.client,
    now: () => NOW,
  })
  const text = await res.text()
  return { res, text, json: (text ? JSON.parse(text) : null) as any }
}

async function startGame(sides = { white: 'haiku', black: 'sonnet' }) {
  const r = await call('start', { body: sides })
  expect(r.res.status).toBe(200)
  return r.json as { gameId: string; token: string; budgetLeftUsd: number }
}

describe('gates', () => {
  test.each(['start', 'move', 'end'] as const)('%s: 403 forbidden without or with a wrong owner token', async (ep) => {
    for (const owner of [null, 'wrong']) {
      const r = await call(ep, { owner })
      expect(r.res.status).toBe(403)
      expect(r.json.error.kind).toBe('forbidden')
    }
  })
  test('budget: 403 without the token; every endpoint is 403 when OWNER_TOKEN is unset', async () => {
    expect((await call('budget', { owner: null })).res.status).toBe(403)
    for (const ep of ['start', 'move', 'end', 'budget'] as const) {
      expect((await call(ep, { env: {}, owner: 'anything' })).res.status).toBe(403)
    }
  })
  test('a foreign origin is refused, a missing one on POST too; wrong method is 405', async () => {
    expect((await call('start', { origin: 'https://evil.example' })).res.status).toBe(403)
    expect((await call('start', { origin: null })).res.status).toBe(403)
    expect((await call('start', { method: 'GET' })).res.status).toBe(405)
    expect((await call('budget', { method: 'POST' })).res.status).toBe(405)
  })
  test('a GET without Origin (same-origin fetch) is fine for budget, a foreign one is not', async () => {
    expect((await call('budget', { origin: null })).res.status).toBe(200)
    expect((await call('budget', { origin: 'https://evil.example' })).res.status).toBe(403)
  })
  test('malformed JSON and bad shapes are 400', async () => {
    expect((await call('start', { raw: '{nope' })).res.status).toBe(400)
    expect((await call('start', { body: { white: 'gpt', black: 'haiku' } })).res.status).toBe(400)
    expect((await call('move', { body: { gameId: 1, token: 'x', history: [] } })).res.status).toBe(400)
    expect((await call('move', { body: { gameId: 'g', token: 'x', history: [1] } })).res.status).toBe(400)
    expect((await call('end', { body: { gameId: 'g', token: 'x', pgn: 1, fallbacks: { w: 0, b: 0 } } })).res.status).toBe(400)
  })
})

describe('a game from start to end', () => {
  test('start, move, end, and the budget in between', async () => {
    const g = await startGame()
    expect(g.gameId).toBeTruthy()
    const b0 = await call('budget')
    expect(b0.json).toMatchObject({ monthlyUsd: GAMES_LIMITS.monthlyUsd })
    expect(b0.json.budgetLeftUsd).toBeCloseTo(g.budgetLeftUsd, 6)

    const m = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(m.res.status).toBe(200)
    expect(m.json).toMatchObject({ san: 'e4', why: 'Take the centre.' })
    expect(m.json.costUsd).toBeGreaterThan(0)
    expect(m.json.gameSpentUsd).toBeCloseTo(m.json.costUsd, 6)

    const e = await call('end', {
      body: { gameId: g.gameId, token: g.token, pgn: '1. e4 *', fallbacks: { w: 1, b: 2 } },
    })
    expect(e.res.status).toBe(200)
    const saved = store.data.get(`games/saved/${g.gameId}`)
    expect(saved).toMatchObject({ pgn: '1. e4 *', fallbacks: { w: 1, b: 2 } })
    expect((saved as any).spent).toBeCloseTo(m.json.costUsd, 6)
    // The lock is free again.
    expect((await call('start', { body: { white: 'haiku', black: 'haiku' } })).res.status).toBe(200)
  })

  test('end does not trust money in the request', async () => {
    const g = await startGame()
    await call('end', {
      body: { gameId: g.gameId, token: g.token, pgn: '*', fallbacks: { w: 0, b: 0 }, spent: 500, costUsd: 500 },
    })
    expect((store.data.get(`games/saved/${g.gameId}`) as any).spent).toBe(0)
  })

  test('end needs this game\'s token', async () => {
    const g = await startGame()
    const r = await call('end', { body: { gameId: g.gameId, token: 'nope', pgn: '*', fallbacks: { w: 0, b: 0 } } })
    expect(r.res.status).toBe(403)
    expect(store.data.has(`games/saved/${g.gameId}`)).toBe(false)
  })

  test('start: a second game is busy (409); an unaffordable one is budget (402)', async () => {
    await startGame()
    expect((await call('start', { body: { white: 'haiku', black: 'haiku' } })).res.status).toBe(409)
    const s2 = fakeStore()
    s2.data.set('games/budget/2026-09', { spent: 19.99, reserved: 0 })
    const r = await call('start', { store: s2, body: { white: 'fable', black: 'fable' } })
    expect(r.res.status).toBe(402)
    expect(r.json.error.kind).toBe('budget')
  })
})

describe('move', () => {
  test('a wrong game token is 403 and never reaches Claude', async () => {
    const g = await startGame()
    const r = await call('move', { body: { gameId: g.gameId, token: 'bad', history: [] } })
    expect(r.res.status).toBe(403)
    expect(calls).toBe(0)
  })
  test('the ply cap is 409 over', async () => {
    const g = await startGame()
    const history = Array.from({ length: GAMES_LIMITS.plyCap }, (_, i) => (i % 2 ? 'Nf6' : 'Nf3'))
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history } })
    expect(r.res.status).toBe(409)
    expect(r.json.error.kind).toBe('over')
    expect(calls).toBe(0)
  })
  test('a used-up reservation is 402', async () => {
    const g = await startGame()
    reply = () => message(JSON.stringify({ move: 'e4', why: '' }), { input_tokens: 1_000_000, output_tokens: 100_000 })
    expect((await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })).res.status).toBe(200)
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: ['e4'] } })
    expect(r.res.status).toBe(402)
    expect(r.json.error.kind).toBe('budget')
  })
  test('an illegal history is 400', async () => {
    const g = await startGame()
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: ['e5'] } })
    expect(r.res.status).toBe(400)
    expect(r.json.error.kind).toBe('bad-request')
  })
  test('a startFen is honoured (Black to move)', async () => {
    const g = await startGame()
    reply = () => message(JSON.stringify({ move: 'e5', why: 'x' }))
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, startFen: fen, history: [] } })
    expect(r.res.status).toBe(200)
    expect(r.json.san).toBe('e5')
  })
  test('no client is 503 no-key', async () => {
    const g = await startGame()
    const r = await call('move', { client: null, body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(503)
    expect(r.json.error.kind).toBe('no-key')
  })
  test('an illegal reply is 502 and is still charged', async () => {
    const g = await startGame()
    reply = () => message(JSON.stringify({ move: 'Qh5', why: 'x' }))
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(502)
    expect(r.json.error.kind).toBe('illegal-reply')
    expect((store.data.get(`games/${g.gameId}`) as any).spent).toBeGreaterThan(0)
  })
  test.each([
    ['rate limit', new Anthropic.RateLimitError(429, undefined, 'x', new Headers()), 'rate-limited'],
    ['server error', new Error('boom'), 'upstream'],
  ])('an SDK %s is 502 with its own kind (%s) and costs nothing', async (_n, err, kind) => {
    const g = await startGame()
    reply = () => Promise.reject(err)
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(502)
    expect(r.json.error.kind).toBe(kind)
    expect((store.data.get(`games/${g.gameId}`) as any).spent).toBe(0)
  })
  test('an SDK timeout is 502 timeout and charges the conservative estimate', async () => {
    const g = await startGame()
    reply = () => Promise.reject(new Anthropic.APIConnectionTimeoutError())
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(502)
    expect(r.json.error.kind).toBe('timeout')
    // White is haiku: at least the whole 8000-token output cap at $5/M.
    expect((store.data.get(`games/${g.gameId}`) as any).spent).toBeGreaterThanOrEqual(0.04)
  })
  test('a rejected key is 503 no-key, not a retryable 502', async () => {
    const g = await startGame()
    reply = () => Promise.reject(new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()))
    const r = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(503)
    expect(r.json.error.kind).toBe('no-key')
  })
  test('nothing secret is in any response', async () => {
    const g = await startGame()
    const other = 'somebody-elses-token'
    const all = [
      await call('move', { body: { gameId: g.gameId, token: other, history: [] } }),
      await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } }),
      await call('budget'),
      await call('start', { owner: 'wrong' }),
    ]
    for (const r of all) expect(r.text).not.toContain(OWNER)
    expect(all[0]!.text).not.toContain(g.token)
  })
})

describe('a failing store fails closed', () => {
  const broken = { get: async () => Promise.reject(new Error('blob down')), setJSON: async () => undefined }
  test.each(['start', 'move', 'end', 'budget'] as const)('%s answers 500 upstream, never 200', async (ep) => {
    // Real tokens, so the request gets past the token check and reaches the store.
    const g = await startGame()
    const body =
      ep === 'start'
        ? { white: 'haiku', black: 'haiku' }
        : ep === 'move'
          ? { gameId: g.gameId, token: g.token, history: [] }
          : { gameId: g.gameId, token: g.token, pgn: '*', fallbacks: { w: 0, b: 0 } }
    const r = await call(ep, { store: broken, body })
    if (ep === 'end') {
      // end needs no store read to authorize; its write is what breaks.
      const failingWrite = { get: store.get, setJSON: async () => Promise.reject(new Error('blob down')) }
      const r2 = await call(ep, { store: failingWrite, body })
      expect(r2.res.status).toBe(500)
      return
    }
    expect(r.res.status).toBe(500)
    expect(r.json.error.kind).toBe('upstream')
    expect(r.text).not.toContain('blob down')
  })
  test('a store that fails on the charge does not answer 200', async () => {
    const g = await startGame()
    const flaky = {
      get: store.get,
      setJSON: async (k: string, v: unknown) => {
        if (k === `games/${g.gameId}` && (v as any).spent > 0) throw new Error('write failed')
        return store.setJSON(k, v)
      },
    }
    const r = await call('move', { store: flaky, body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(r.res.status).toBe(500)
  })
})

test('the coach keys are never written', async () => {
  const g = await startGame()
  await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
  await call('end', { body: { gameId: g.gameId, token: g.token, pgn: '*', fallbacks: { w: 0, b: 0 } } })
  await call('budget')
  expect(store.data.size).toBeGreaterThan(0)
  for (const key of store.data.keys()) {
    expect(key.startsWith('games/')).toBe(true)
    expect(/^(answer|rate|budget)\//.test(key)).toBe(false)
  }
})
