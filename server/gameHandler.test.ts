// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient } from './claude'
import { handleGame } from './gameHandler'
import { GAMES_LIMITS } from './games'
import { fakeStore } from '../netlify/lib/limits.test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileStore } from './fileStore'
import type { JevClient } from './jevMove'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const SECRET = Buffer.from('fake-process-secret')
const BOOT = 'fake-boot'
const BASE = 'http://127.0.0.1:8787'
const ORIGIN = 'http://localhost:5173'

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
  body?: unknown
  raw?: string
  client?: MessagesClient | null
  /** TypeSafe's client; absent (as before Jev) unless a test passes one. */
  jev?: JevClient | null
  secret?: Buffer
  boot?: string
  store?: Parameters<typeof handleGame>[2]['store']
  /** The query string, without its `?`. */
  query?: string
}

async function call(endpoint: 'start' | 'move' | 'end' | 'budget' | 'record', o: Opts = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const origin = o.origin === undefined ? ORIGIN : o.origin
  if (origin) headers['origin'] = origin
  const method = o.method ?? (endpoint === 'budget' || endpoint === 'record' ? 'GET' : 'POST')
  const query = o.query !== undefined ? `?${o.query}` : ''
  const res = await handleGame(endpoint, new Request(`${BASE}/api/game/${endpoint}${query}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : (o.raw ?? JSON.stringify(o.body ?? {})),
  }), {
    store: o.store ?? store,
    secret: o.secret ?? SECRET,
    boot: o.boot ?? BOOT,
    client: o.client === undefined ? fakeClient() : o.client,
    ...(o.jev !== undefined ? { jev: o.jev } : {}),
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
  test.each([
    'http://localhost:5173',
    'http://localhost:8787',
    'http://localhost',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:1',
    'http://[::1]:5173',
  ])('loopback origin %s is allowed', async (origin) => {
    expect((await call('start', { origin, body: { white: 'haiku', black: 'haiku' } })).res.status).toBe(200)
  })
  test.each([
    'https://localhost:5173',
    'https://chess.example.app',
    'http://localhost.evil.example',
    'http://evil.example:5173',
    'http://localhost:5173@evil.example',
    'http://127.0.0.1.evil.example',
    'http://192.168.1.5:5173',
    'http://0.0.0.0:5173',
    'null',
    'not a url',
  ])('origin %s is refused on every endpoint', async (origin) => {
    for (const ep of ['start', 'move', 'end', 'budget'] as const) {
      const r = await call(ep, { origin })
      expect(r.res.status).toBe(403)
      expect(r.json.error.kind).toBe('forbidden')
    }
  })
  test('a token minted under one process secret is refused under another', async () => {
    const g = await startGame()
    const body = { gameId: g.gameId, token: g.token, history: [] }
    expect((await call('move', { body, secret: Buffer.from('a-different-process') })).res.status).toBe(403)
    expect((await call('end', { body: { ...body, pgn: '*', fallbacks: { w: 0, b: 0 } }, secret: Buffer.from('a-different-process') })).res.status).toBe(403)
    expect((await call('move', { body })).res.status).toBe(200)
  })
  test('after a server restart the old game cannot end itself, and the next start settles it instead of 409', async () => {
    const g = await startGame()
    const restarted = { secret: Buffer.from('a-different-process'), boot: 'another-boot' }
    const end = { gameId: g.gameId, token: g.token, pgn: '*', fallbacks: { w: 0, b: 0 } }
    expect((await call('end', { body: end, ...restarted })).res.status).toBe(403)
    const r = await call('start', { body: { white: 'haiku', black: 'sonnet' }, ...restarted })
    expect(r.res.status).toBe(200)
    expect(store.data.get(`games/saved/${g.gameId}`)).toMatchObject({ abandoned: true })
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

describe('usage', () => {
  const ZERO = { costUsd: 0, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0 }

  test('the move response carries the game\'s running per-side usage, the side from the history', async () => {
    const g = await startGame()
    const m1 = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(m1.json.usage).toEqual({
      w: { costUsd: expect.closeTo(m1.json.costUsd, 6), ms: expect.any(Number), inputTokens: 1000, outputTokens: 200, calls: 1 },
      b: ZERO,
    })
    reply = () => message(JSON.stringify({ move: 'e5', why: 'Mirror.' }), { input_tokens: 1100, output_tokens: 50 })
    const m2 = await call('move', { body: { gameId: g.gameId, token: g.token, history: ['e4'] } })
    expect(m2.json.usage.w).toEqual(m1.json.usage.w)
    expect(m2.json.usage.b).toMatchObject({ inputTokens: 1100, outputTokens: 50, calls: 1 })
    expect(m2.json.gameSpentUsd).toBeCloseTo(m1.json.usage.w.costUsd + m2.json.usage.b.costUsd, 6)
  })

  test('a timed-out call counts toward its side with estimated tokens; a later reply reports it', async () => {
    const g = await startGame()
    reply = () => Promise.reject(new Anthropic.APIConnectionTimeoutError())
    await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    reply = () => message(JSON.stringify({ move: 'e4', why: 'x' }))
    const m = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(m.json.usage.w.calls).toBe(2)
    expect(m.json.usage.w.outputTokens).toBe(8000 + 200)
    expect(m.json.usage.w.costUsd).toBeCloseTo(m.json.gameSpentUsd, 6)
  })

  test('a request refused before any call (bad history) adds no usage', async () => {
    const g = await startGame()
    await call('move', { body: { gameId: g.gameId, token: g.token, history: ['e5'] } })
    expect((store.data.get(`games/${g.gameId}`) as any).usage).toEqual({ w: ZERO, b: ZERO })
  })

  test('a reply that lands after the game ended still counts, for the game and the month', async () => {
    const g = await startGame()
    reply = async () => {
      await call('end', { body: { gameId: g.gameId, token: g.token, pgn: '*', fallbacks: { w: 0, b: 0 } } })
      return message(JSON.stringify({ move: 'e4', why: 'x' }))
    }
    const m = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(m.json.usage.w.calls).toBe(1)
    expect((await call('budget')).json.byModel.haiku).toMatchObject({ calls: 1, outputTokens: 200 })
  })

  test('budget reports usage per model this month and the dollars from before it was tracked', async () => {
    const empty = await call('budget')
    expect(empty.json).toMatchObject({ byModel: {}, earlierUsd: 0 })
    await store.setJSON('games/budget/2026-09', { spent: 0.13, reserved: 0 })
    const g = await startGame()
    const m = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    const b = await call('budget')
    expect(b.json.byModel).toEqual({ haiku: m.json.usage.w })
    expect(b.json.earlierUsd).toBeCloseTo(0.13, 6)
  })

  test('the saved record carries the per-side usage', async () => {
    const g = await startGame()
    const m = await call('move', { body: { gameId: g.gameId, token: g.token, history: [] } })
    await call('end', { body: { gameId: g.gameId, token: g.token, pgn: '1. e4 *', fallbacks: { w: 0, b: 0 }, usage: 1 } })
    expect((store.data.get(`games/saved/${g.gameId}`) as any).usage).toEqual(m.json.usage)
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
  // The browser reads a failed budget as "start the local server with a key"
  // and disables Start; a keyless server must not look ready.
  test('with no client, budget and start are 503 no-key and nothing is reserved', async () => {
    const b = await call('budget', { client: null })
    expect(b.res.status).toBe(503)
    expect(b.json.error.kind).toBe('no-key')
    const s = await call('start', { client: null, body: { white: 'haiku', black: 'haiku' } })
    expect(s.res.status).toBe(503)
    expect(s.json.error.kind).toBe('no-key')
    // No lock was taken: a keyed start right after succeeds.
    await startGame()
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
      await call('start', { origin: 'https://evil.example' }),
    ]
    for (const r of all) expect(r.text).not.toContain(SECRET.toString())
    expect(all[0]!.text).not.toContain(g.token)
  })
})

describe('a failing store fails closed', () => {
  const broken = { get: async () => Promise.reject(new Error('blob down')), setJSON: async () => undefined, keys: async () => [] }
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
      const failingWrite = { get: store.get, setJSON: async () => Promise.reject(new Error('blob down')), keys: store.keys }
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
      keys: store.keys,
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

describe('a corrupt ledger file', () => {
  test('fails closed with a bare 500: the file path is logged, never sent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ledger-'))
    try {
      const logged: string[] = []
      const fs = fileStore(root, { log: (line) => logged.push(line) })
      await fs.setJSON('games/budget/2026-09', { spent: 0, reserved: 0 })
      await writeFile(join(root, 'games', 'budget', '2026-09.json'), '{oops')
      for (const ep of ['budget', 'start'] as const) {
        const r = await call(ep, { store: fs, body: { white: 'haiku', black: 'haiku' } })
        expect(r.res.status).toBe(500)
        expect(r.text).not.toContain(root)
        expect(r.text).not.toContain('2026-09.json')
      }
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain(join(root, 'games', 'budget', '2026-09.json'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('record: the head-to-head of two models', () => {
  const pgn = (result: string) => `[Result "${result}"]\n\n1. e4 e5 ${result}\n`
  async function play(white: string, black: string, result: string) {
    const g = await startGame({ white, black })
    const r = await call('end', { body: { gameId: g.gameId, token: g.token, pgn: pgn(result), fallbacks: { w: 0, b: 0 } } })
    expect(r.res.status).toBe(200)
  }

  test('answers the record for the pair, crediting the model asked for as white', async () => {
    const empty = await call('record', { query: 'white=sonnet&black=haiku' })
    expect(empty.res.status).toBe(200)
    expect(empty.res.headers.get('cache-control')).toBe('no-store')
    expect(empty.json).toEqual({ games: 0, whiteModelWins: 0, blackModelWins: 0, draws: 0, whiteWins: 0, blackWins: 0 })
    await play('sonnet', 'haiku', '1-0')
    await play('haiku', 'sonnet', '0-1')
    await play('haiku', 'sonnet', '1/2-1/2')
    await play('haiku', 'sonnet', '*')
    const r = await call('record', { query: 'white=sonnet&black=haiku' })
    expect(r.json).toEqual({ games: 3, whiteModelWins: 2, blackModelWins: 0, draws: 1, whiteWins: 1, blackWins: 1 })
  })

  test('a mirror match answers by colour', async () => {
    await play('haiku', 'haiku', '0-1')
    const r = await call('record', { query: 'white=haiku&black=haiku' })
    expect(r.json).toMatchObject({ games: 1, whiteWins: 0, blackWins: 1, draws: 0 })
  })

  test.each(['', 'white=sonnet', 'black=haiku', 'white=gpt&black=haiku', 'white=sonnet&black=', 'white=__proto__&black=haiku', 'white=Sonnet&black=haiku'])(
    'query %j is 400 bad-request',
    async (query) => {
      const r = await call('record', { query })
      expect(r.res.status).toBe(400)
      expect(r.json.error.kind).toBe('bad-request')
    },
  )

  test('same Origin rules as budget: none is fine, a foreign one is 403; POST is 405', async () => {
    const q = 'white=sonnet&black=haiku'
    expect((await call('record', { query: q, origin: null })).res.status).toBe(200)
    expect((await call('record', { query: q, origin: 'https://evil.example' })).res.status).toBe(403)
    expect((await call('record', { query: q, origin: 'http://localhost.evil.example' })).res.status).toBe(403)
    expect((await call('record', { query: q, method: 'POST' })).res.status).toBe(405)
  })

  test('reading history needs no Anthropic key', async () => {
    expect((await call('record', { query: 'white=sonnet&black=haiku', client: null })).res.status).toBe(200)
  })

  test('a corrupt saved game is skipped (not a 500) and logged once, server-side', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ledger-'))
    try {
      const logged: string[] = []
      const fs = fileStore(root, { log: (line) => logged.push(line) })
      await fs.setJSON('games/saved/good', { white: 'sonnet', black: 'haiku', pgn: pgn('1-0') })
      await fs.setJSON('games/saved/bad', { white: 'sonnet', black: 'haiku', pgn: pgn('1-0') })
      await writeFile(join(root, 'games', 'saved', 'bad.json'), '{oops')
      for (let i = 0; i < 2; i++) {
        const r = await call('record', { store: fs, query: 'white=sonnet&black=haiku' })
        expect(r.res.status).toBe(200)
        expect(r.json).toMatchObject({ games: 1, whiteModelWins: 1 })
        expect(r.text).not.toContain(root)
      }
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain(join(root, 'games', 'saved', 'bad.json'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a store that cannot list its saved games answers 500 upstream', async () => {
    const broken = { ...store, keys: async () => Promise.reject(new Error('disk gone')) }
    const r = await call('record', { store: broken, query: 'white=sonnet&black=haiku' })
    expect(r.res.status).toBe(500)
    expect(r.json.error.kind).toBe('upstream')
    expect(r.text).not.toContain('disk gone')
  })
})

describe('Jev in a seat', () => {
  /** A System One stand-in: picks the criterion for `san` (default e4/e5 by side); records each body. */
  function fakeJev(san?: string, usage = { input_tokens: 1500, output_tokens: 300 }) {
    const bodies: any[] = []
    const jev: JevClient = {
      systemone: async (body: any) => {
        bodies.push(body)
        const want = san ?? (body.state.side_to_move === 'White' ? 'e4' : 'e5')
        const key = Object.entries(body.questions.move.criteria as Record<string, string>).find(([, d]) =>
          d.startsWith(`${want}:`),
        )![0]
        return Response.json({ answers: { move: { type: 'choice', choice: key, probabilities: { [key]: 0.31 }, confidence: 0.5 } }, usage })
      },
    }
    return { jev, bodies }
  }

  test('a Jev seat asks System One, not Anthropic; its usage is charged to the side and to jev for the month', async () => {
    const { jev, bodies } = fakeJev()
    const s = await call('start', { jev, body: { white: 'jev', black: 'haiku' } })
    expect(s.res.status).toBe(200)
    const g = s.json
    const m = await call('move', { jev, body: { gameId: g.gameId, token: g.token, history: [] } })
    expect(m.res.status).toBe(200)
    expect(m.json).toMatchObject({ san: 'e4', why: "Jev's pick (p 0.31)" })
    expect(calls).toBe(0)
    expect(bodies).toHaveLength(1)
    expect(m.json.costUsd).toBeCloseTo((1500 * 0.042) / 1e6, 9)
    expect(m.json.usage.w).toMatchObject({ inputTokens: 1500, outputTokens: 300, calls: 1 })

    // Black is Haiku: Anthropic answers, System One is not asked.
    reply = () => message(JSON.stringify({ move: 'e5', why: 'Mirror.' }))
    const m2 = await call('move', { jev, body: { gameId: g.gameId, token: g.token, history: ['e4'] } })
    expect(m2.res.status).toBe(200)
    expect(calls).toBe(1)
    expect(bodies).toHaveLength(1)

    const b = await call('budget', { jev })
    expect(b.json.byModel.jev).toMatchObject({ inputTokens: 1500, outputTokens: 300, calls: 1 })
    expect(b.json.byModel.haiku.calls).toBe(1)
  })

  test('budget lists the models this server can seat', async () => {
    const { jev } = fakeJev()
    expect((await call('budget', { jev })).json.models).toEqual(['fable', 'opus', 'sonnet', 'haiku', 'jev'])
    expect((await call('budget', {})).json.models).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    const onlyJev = await call('budget', { client: null, jev })
    expect(onlyJev.res.status).toBe(200)
    expect(onlyJev.json.models).toEqual(['jev'])
  })

  test('without a TypeSafe key a Jev seat cannot start (503 no-jev-key), nothing is reserved; Claude games still can', async () => {
    const before = (await call('budget')).json.budgetLeftUsd
    for (const sides of [{ white: 'jev', black: 'haiku' }, { white: 'haiku', black: 'jev' }]) {
      const r = await call('start', { body: sides })
      expect(r.res.status).toBe(503)
      expect(r.json.error).toEqual({ kind: 'no-jev-key', message: 'Jev is not configured (no TYPESAFE_API_KEY).' })
    }
    expect((await call('budget')).json.budgetLeftUsd).toBe(before)
    await startGame({ white: 'haiku', black: 'sonnet' })
  })

  test('with only a TypeSafe key, Jev vs Jev starts and a Claude seat is 503 no-key', async () => {
    const { jev } = fakeJev()
    const claudeSeat = await call('start', { client: null, jev, body: { white: 'jev', black: 'opus' } })
    expect(claudeSeat.res.status).toBe(503)
    expect(claudeSeat.json.error.kind).toBe('no-key')
    const s = await call('start', { client: null, jev, body: { white: 'jev', black: 'jev' } })
    expect(s.res.status).toBe(200)
    const m = await call('move', { client: null, jev, body: { gameId: s.json.gameId, token: s.json.token, history: [] } })
    expect(m.res.status).toBe(200)
    expect(m.json.san).toBe('e4')
  })

  test('a Jev move with no TypeSafe client is 503 no-jev-key; a rejected key is too', async () => {
    const { jev } = fakeJev()
    const s = await call('start', { jev, body: { white: 'jev', black: 'jev' } })
    const r = await call('move', { jev: null, body: { gameId: s.json.gameId, token: s.json.token, history: [] } })
    expect(r.res.status).toBe(503)
    expect(r.json.error.kind).toBe('no-jev-key')
    const rejecting: JevClient = { systemone: async () => Response.json({ error: 'x' }, { status: 401 }) }
    const r2 = await call('move', { jev: rejecting, body: { gameId: s.json.gameId, token: s.json.token, history: [] } })
    expect(r2.res.status).toBe(503)
    expect(r2.json.error.kind).toBe('no-jev-key')
  })

  test('a rate-limited Jev is a retryable 502 with its own message', async () => {
    const { jev } = fakeJev()
    const s = await call('start', { jev, body: { white: 'jev', black: 'jev' } })
    const limited: JevClient = { systemone: async () => new Response('', { status: 529 }) }
    const r = await call('move', { jev: limited, body: { gameId: s.json.gameId, token: s.json.token, history: [] } })
    expect(r.res.status).toBe(502)
    expect(r.json.error).toEqual({ kind: 'rate-limited', message: 'Jev is rate-limiting requests.' })
  })

  test('the head-to-head counts Jev games like any other', async () => {
    const { jev } = fakeJev()
    const s = await call('start', { jev, body: { white: 'jev', black: 'haiku' } })
    await call('end', {
      jev,
      body: { gameId: s.json.gameId, token: s.json.token, pgn: '[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1', fallbacks: { w: 0, b: 0 } },
    })
    const r = await call('record', { query: 'white=haiku&black=jev' })
    expect(r.res.status).toBe(200)
    expect(r.json).toMatchObject({ games: 1, whiteModelWins: 1, blackModelWins: 0 })
  })
})
