// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, test } from 'vitest'
import { CLAUDE_SESSION_IDLE_MS, MOVE_TIMEOUT_MS, RESERVE_PER_GAME_USD } from '../src/claude/models'
import {
  GAMES_LIMITS,
  authorizeMove,
  budgetLeft,
  chargeMove,
  checkGameToken,
  endGame,
  monthUsage,
  startGame,
  type MoveCall,
} from './games'
import { fakeStore } from '../netlify/lib/limits.test'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const SECRET = Buffer.from('fake-process-secret')
/** This process's boot id; a lock written under another boot is from a server that has since restarted. */
const BOOT = 'boot-a'
const SIDES = { white: 'haiku', black: 'sonnet' } as const

let store: ReturnType<typeof fakeStore>
beforeEach(() => {
  store = fakeStore()
})

/** One API call's charge; the side defaults to White and the usage beyond its cost to zero. */
const call = (costUsd: number, over: Partial<MoveCall> = {}): MoveCall => ({
  side: 'white',
  costUsd,
  ms: 0,
  inputTokens: 0,
  outputTokens: 0,
  ...over,
})

async function start(now = NOW, sides: { white: string; black: string } = SIDES) {
  const r = await startGame(store, now, SECRET, sides, BOOT)
  if (!r.ok) throw new Error(`start failed: ${r.kind}`)
  return r
}

describe('the per-process secret', () => {
  test('a token minted under one secret fails under another, and under a random one', async () => {
    const g = await start()
    expect(checkGameToken(SECRET, g.gameId, g.token)).toBe(true)
    expect(checkGameToken(Buffer.from('another-secret'), g.gameId, g.token)).toBe(false)
    expect(checkGameToken(randomBytes(32), g.gameId, g.token)).toBe(false)
    const a = { gameId: g.gameId, token: g.token, side: 'white' as const, plies: 0 }
    expect(await authorizeMove(store, NOW, randomBytes(32), a)).toEqual({ ok: false, kind: 'forbidden' })
  })
  test('a token for another game id never matches', async () => {
    const g = await start()
    expect(checkGameToken(SECRET, 'other-game', g.token)).toBe(false)
  })
})

describe('startGame', () => {
  test('rejects unknown model keys', async () => {
    const r = await startGame(store, NOW, SECRET, { white: 'gpt', black: 'haiku' }, BOOT)
    expect(r).toEqual({ ok: false, kind: 'bad-request' })
  })
  test('reserves both sides and reports what is left', async () => {
    const r = await start()
    const reserve = RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet
    expect(r.budgetLeftUsd).toBeCloseTo(GAMES_LIMITS.monthlyUsd - reserve, 6)
    expect(await budgetLeft(store, NOW)).toBeCloseTo(GAMES_LIMITS.monthlyUsd - reserve, 6)
    expect(r.token).toMatch(/^[0-9a-f]{64}$/)
  })
  test('a second game while the lock is held is busy', async () => {
    await start()
    expect(await startGame(store, NOW + 1000, SECRET, SIDES, BOOT)).toEqual({ ok: false, kind: 'busy' })
  })
  test('an expired lock does not block a new game', async () => {
    await start()
    const r = await startGame(store, NOW + GAMES_LIMITS.lockTtlMs + 1, SECRET, SIDES, BOOT)
    expect(r.ok).toBe(true)
  })
  test('too little budget left is refused', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 19.9, reserved: 0 })
    expect(await startGame(store, NOW, SECRET, { white: 'fable', black: 'fable' }, BOOT)).toEqual({ ok: false, kind: 'budget' })
  })
  test('a new month resets the budget', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 19.99, reserved: 0 })
    expect(await budgetLeft(store, Date.UTC(2026, 9, 1))).toBe(GAMES_LIMITS.monthlyUsd)
  })
})

describe('authorizeMove', () => {
  test('a move is authorised with the side model', async () => {
    const g = await start()
    const a = { gameId: g.gameId, token: g.token, plies: 0 }
    expect(await authorizeMove(store, NOW, SECRET, { ...a, side: 'white' })).toEqual({ ok: true, model: 'haiku' })
    expect(await authorizeMove(store, NOW, SECRET, { ...a, side: 'black' })).toEqual({ ok: true, model: 'sonnet' })
  })
  test('a bad token or unknown game is forbidden', async () => {
    const g = await start()
    expect(await authorizeMove(store, NOW, SECRET, { gameId: g.gameId, token: 'bad', side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
    expect(await authorizeMove(store, NOW, SECRET, { gameId: 'nope', token: g.token, side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
  })
  test('a move refreshes the lock', async () => {
    const g = await start()
    const later = NOW + GAMES_LIMITS.lockTtlMs - 1000
    await authorizeMove(store, later, SECRET, { gameId: g.gameId, token: g.token, side: 'white', plies: 0 })
    expect(await startGame(store, later + GAMES_LIMITS.lockTtlMs - 1000, SECRET, SIDES, BOOT)).toEqual({ ok: false, kind: 'busy' })
  })
  test('a lost lock is forbidden', async () => {
    const g = await start()
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    await start(t)
    expect(await authorizeMove(store, t, SECRET, { gameId: g.gameId, token: g.token, side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
  })
  test('ply 160 is over', async () => {
    const g = await start()
    const a = { gameId: g.gameId, token: g.token, side: 'white' as const }
    expect(await authorizeMove(store, NOW, SECRET, { ...a, plies: 159 })).toMatchObject({ ok: true })
    expect(await authorizeMove(store, NOW, SECRET, { ...a, plies: 160 })).toEqual({ ok: false, kind: 'over' })
  })
  test('spent at or over the reservation is budget', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet))
    expect(await authorizeMove(store, NOW, SECRET, { gameId: g.gameId, token: g.token, side: 'white', plies: 2 })).toEqual({
      ok: false,
      kind: 'budget',
    })
  })
})

describe('chargeMove and endGame', () => {
  test('charges do not change what is left until the game ends', async () => {
    const g = await start()
    const before = await budgetLeft(store, NOW)
    await chargeMove(store, NOW, g.gameId, call(0.05))
    expect(await budgetLeft(store, NOW)).toBeCloseTo(before, 6)
  })
  test('ending releases the lock and the unused reservation, and saves the record', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.05))
    await endGame(store, NOW, g.gameId, { pgn: '1. e4 *', costUsd: 0.05 })
    expect(await budgetLeft(store, NOW)).toBeCloseTo(GAMES_LIMITS.monthlyUsd - 0.05, 6)
    expect(store.data.get(`games/saved/${g.gameId}`)).toMatchObject({ pgn: '1. e4 *' })
    expect((await startGame(store, NOW + 1, SECRET, SIDES, BOOT)).ok).toBe(true)
  })
  test('the saved record takes its money from the server-tracked game, not the caller', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.05))
    await endGame(store, NOW, g.gameId, { pgn: '1. e4 *', spent: 999, reserved: 999, costUsd: 999 })
    const saved = store.data.get(`games/saved/${g.gameId}`) as Record<string, number>
    expect(saved['spent']).toBeCloseTo(0.05, 6)
    expect(saved['reserved']).toBeCloseTo(RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet, 6)
  })
  test('chargeMove reports the game total so far', async () => {
    const g = await start()
    expect((await chargeMove(store, NOW, g.gameId, call(0.05))).spent).toBeCloseTo(0.05, 6)
    expect((await chargeMove(store, NOW, g.gameId, call(0))).spent).toBeCloseTo(0.05, 6)
    expect((await chargeMove(store, NOW, g.gameId, call(0.01))).spent).toBeCloseTo(0.06, 6)
  })
  test('checkGameToken accepts only that game\'s token', async () => {
    const g = await start()
    expect(checkGameToken(SECRET, g.gameId, g.token)).toBe(true)
    expect(checkGameToken(SECRET, 'other', g.token)).toBe(false)
  })
  test('a charge that lands after the game ended still counts against the month', async () => {
    const g = await start()
    await endGame(store, NOW, g.gameId, { pgn: '*' })
    const before = await budgetLeft(store, NOW)
    const saved = JSON.stringify(store.data.get(`games/saved/${g.gameId}`))
    await chargeMove(store, NOW, g.gameId, call(0.07))
    expect(await budgetLeft(store, NOW)).toBeCloseTo(before - 0.07, 6)
    expect(store.data.get('games/budget/2026-09')).toMatchObject({ spent: expect.closeTo(0.07, 6), reserved: 0 })
    expect(JSON.stringify(store.data.get(`games/saved/${g.gameId}`))).toBe(saved)
  })
  test('the same after a lapsed lock was settled by a new start', async () => {
    const a = await start()
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    await start(t)
    const before = await budgetLeft(store, t)
    await chargeMove(store, t, a.gameId, call(0.07))
    expect(await budgetLeft(store, t)).toBeCloseTo(before - 0.07, 6)
  })
  test('ending twice does not refund twice', async () => {
    const g = await start()
    await endGame(store, NOW, g.gameId, {})
    await endGame(store, NOW, g.gameId, {})
    expect(await budgetLeft(store, NOW)).toBe(GAMES_LIMITS.monthlyUsd)
  })
  test('ending an old game does not release a newer game lock', async () => {
    const g = await start()
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    await start(t)
    await endGame(store, t, g.gameId, {})
    expect(await startGame(store, t + 1, SECRET, SIDES, BOOT)).toEqual({ ok: false, kind: 'busy' })
  })
})

describe('usage per side and per model', () => {
  const ZERO = { costUsd: 0, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0 }

  test('each call adds to its own side, with the model taken from the game record', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.01, { ms: 1200, inputTokens: 900, outputTokens: 40 }))
    await chargeMove(store, NOW, g.gameId, call(0.02, { side: 'black', ms: 3000, inputTokens: 950, outputTokens: 200 }))
    const r = await chargeMove(store, NOW, g.gameId, call(0.03, { ms: 800, inputTokens: 1000, outputTokens: 60 }))
    const w = { costUsd: expect.closeTo(0.04, 6), ms: 2000, inputTokens: 1900, outputTokens: 100, calls: 2 }
    const b = { costUsd: expect.closeTo(0.02, 6), ms: 3000, inputTokens: 950, outputTokens: 200, calls: 1 }
    expect(r.usage).toEqual({ w, b })
    expect(r.spent).toBeCloseTo(0.06, 6)
    expect(store.data.get(`games/${g.gameId}`)).toMatchObject({ usage: { w, b } })
    // SIDES is haiku (White) vs sonnet (Black).
    expect(await monthUsage(store, NOW)).toEqual({ byModel: { haiku: w, sonnet: b }, earlierUsd: 0 })
  })

  test('a call that cost nothing (an SDK error) still counts its time; a timeout counts its estimated tokens', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0, { ms: 150 }))
    // A timeout: the ledger's worst-case cost and its estimated tokens.
    const r = await chargeMove(store, NOW, g.gameId, call(0.0412, { ms: 45_000, inputTokens: 700, outputTokens: 8000 }))
    expect(r.usage.w).toEqual({ costUsd: expect.closeTo(0.0412, 6), ms: 45_150, inputTokens: 700, outputTokens: 8000, calls: 2 })
    expect(r.usage.b).toEqual(ZERO)
    expect((await monthUsage(store, NOW)).byModel.haiku).toMatchObject({ calls: 2, ms: 45_150 })
  })

  test('a charge after the game ended adds to the game and the month, not to the saved record', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.01, { ms: 500, outputTokens: 10 }))
    await endGame(store, NOW, g.gameId, { pgn: '*' })
    const saved = JSON.stringify(store.data.get(`games/saved/${g.gameId}`))
    const r = await chargeMove(store, NOW, g.gameId, call(0.07, { side: 'black', ms: 900, outputTokens: 30 }))
    expect(r.usage.b).toMatchObject({ costUsd: expect.closeTo(0.07, 6), ms: 900, outputTokens: 30, calls: 1 })
    expect(r.usage.w).toMatchObject({ calls: 1, ms: 500 })
    expect((await monthUsage(store, NOW)).byModel.sonnet).toMatchObject({ calls: 1, ms: 900 })
    expect(JSON.stringify(store.data.get(`games/saved/${g.gameId}`))).toBe(saved)
  })

  test('the month adds up per model across games; the budget record keeps spent and reserved', async () => {
    const a = await start()
    await chargeMove(store, NOW, a.gameId, call(0.01, { ms: 100 }))
    await endGame(store, NOW, a.gameId, { pgn: '*' })
    const b = await start(NOW + 1, { white: 'sonnet', black: 'haiku' })
    await chargeMove(store, NOW, b.gameId, call(0.02, { side: 'black', ms: 200 }))
    const { byModel } = await monthUsage(store, NOW)
    expect(byModel.haiku).toMatchObject({ costUsd: expect.closeTo(0.03, 6), ms: 300, calls: 2 })
    expect(byModel.sonnet).toBeUndefined()
    expect(store.data.get('games/budget/2026-09')).toMatchObject({ spent: expect.closeTo(0.03, 6) })
  })

  test('a month record from before byModel loads as empty; its dollars show as earlier', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 0.13, reserved: 0 })
    expect(await monthUsage(store, NOW)).toEqual({ byModel: {}, earlierUsd: 0.13 })
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.02, { ms: 100 }))
    const m = await monthUsage(store, NOW)
    expect(m.byModel).toEqual({ haiku: expect.objectContaining({ calls: 1 }) })
    expect(m.earlierUsd).toBeCloseTo(0.13, 6)
    expect(await budgetLeft(store, NOW)).toBeCloseTo(
      GAMES_LIMITS.monthlyUsd - 0.15 - (RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet - 0.02),
      6,
    )
  })

  test('an earlier remainder under half a cent is not shown', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 0.004, reserved: 0 })
    expect((await monthUsage(store, NOW)).earlierUsd).toBe(0)
  })

  test('a non-finite cost adds nothing: spent and reserved stay intact', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.05, { ms: 100 }))
    const budget = JSON.stringify(store.data.get('games/budget/2026-09'))
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = await chargeMove(store, NOW, g.gameId, call(bad, { ms: 100 }))
      expect(r.spent).toBeCloseTo(0.05, 6)
      expect(r.usage.w.costUsd).toBeCloseTo(0.05, 6)
    }
    const after = store.data.get('games/budget/2026-09') as Record<string, unknown>
    const before = JSON.parse(budget) as Record<string, unknown>
    expect(after['spent']).toBe(before['spent'])
    expect(after['reserved']).toBe(before['reserved'])
    expect((store.data.get(`games/${g.gameId}`) as Record<string, unknown>)['spent']).toBeCloseTo(0.05, 6)
    expect((await monthUsage(store, NOW)).byModel.haiku!.costUsd).toBeCloseTo(0.05, 6)
  })

  test('a NaN or Infinity time or token count leaves the totals intact', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.01, { ms: 500, inputTokens: 10, outputTokens: 20 }))
    const r = await chargeMove(
      store,
      NOW,
      g.gameId,
      call(0.01, { ms: Number.NaN, inputTokens: Number.POSITIVE_INFINITY, outputTokens: Number.NaN }),
    )
    expect(r.usage.w).toEqual({ costUsd: 0.02, ms: 500, inputTokens: 10, outputTokens: 20, calls: 2 })
    expect((await monthUsage(store, NOW)).byModel.haiku).toEqual(r.usage.w)
  })

  test('a game record from before usage loads as zero usage', async () => {
    const g = await start()
    const rec = store.data.get(`games/${g.gameId}`) as Record<string, unknown>
    delete rec['usage']
    await store.setJSON(`games/${g.gameId}`, rec)
    const r = await chargeMove(store, NOW, g.gameId, call(0.01, { ms: 10 }))
    expect(r.usage).toEqual({ w: { costUsd: 0.01, ms: 10, inputTokens: 0, outputTokens: 0, calls: 1 }, b: ZERO })
  })

  test('the saved record carries the per-side usage from the game record, not the caller', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, call(0.01, { ms: 700, inputTokens: 5, outputTokens: 6 }))
    await endGame(store, NOW, g.gameId, { pgn: '*', usage: 'forged' })
    expect(store.data.get(`games/saved/${g.gameId}`)).toMatchObject({
      usage: { w: { costUsd: 0.01, ms: 700, inputTokens: 5, outputTokens: 6, calls: 1 }, b: ZERO },
    })
  })
})

describe('abandoned games and failing reads', () => {
  test('a lock from an earlier boot of the server does not block a start: the old game is settled as abandoned at once', async () => {
    // The server restarted: the old game's token no longer verifies, so its /end can never arrive.
    const a = await start()
    await chargeMove(store, NOW, a.gameId, call(0.05))
    const b = await startGame(store, NOW + 1, randomBytes(32), SIDES, 'boot-b')
    expect(b.ok).toBe(true)
    expect(store.data.get(`games/${a.gameId}`)).toMatchObject({ ended: true })
    expect(store.data.get(`games/saved/${a.gameId}`)).toMatchObject({ abandoned: true, spent: expect.closeTo(0.05, 6) })
    const reserve = RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet
    // Only game b's reservation is held; a's unused part went back, its 0.05 stays spent.
    expect(store.data.get('games/budget/2026-09')).toMatchObject({
      spent: expect.closeTo(0.05, 6),
      reserved: expect.closeTo(reserve, 6),
    })
    expect(store.data.get('games/lock')).toMatchObject({ boot: 'boot-b' })
  })
  test('a lock written before locks carried a boot id counts as another boot', async () => {
    const a = await start()
    await store.setJSON('games/lock', { gameId: a.gameId, until: NOW + GAMES_LIMITS.lockTtlMs })
    expect((await startGame(store, NOW + 1, SECRET, SIDES, BOOT)).ok).toBe(true)
    expect(store.data.get(`games/saved/${a.gameId}`)).toMatchObject({ abandoned: true })
  })
  test('a move keeps the lock under the boot that took it', async () => {
    const g = await start()
    await authorizeMove(store, NOW + 1000, SECRET, { gameId: g.gameId, token: g.token, side: 'white', plies: 0 })
    expect(store.data.get('games/lock')).toMatchObject({ gameId: g.gameId, boot: BOOT })
    expect(await startGame(store, NOW + 2000, SECRET, SIDES, BOOT)).toEqual({ ok: false, kind: 'busy' })
  })
  test('starting after the lock expired settles the abandoned game', async () => {
    const a = await start()
    await chargeMove(store, NOW, a.gameId, call(0.05))
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    const b = await start(t)
    expect(store.data.get(`games/${a.gameId}`)).toMatchObject({ ended: true })
    expect(store.data.get(`games/saved/${a.gameId}`)).toMatchObject({ abandoned: true })
    const reserveB = RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet
    expect(b.budgetLeftUsd).toBeCloseTo(GAMES_LIMITS.monthlyUsd - 0.05 - reserveB, 6)
    expect(store.data.get('games/budget/2026-09')).toMatchObject({ reserved: expect.closeTo(reserveB, 6) })
  })
  test('a store whose reads fail makes the guards reject, not open', async () => {
    const broken = { get: async () => Promise.reject(new Error('blob down')), setJSON: async () => undefined, keys: async () => [] }
    await expect(startGame(broken, NOW, SECRET, SIDES, BOOT)).rejects.toThrow('blob down')
    await expect(budgetLeft(broken, NOW)).rejects.toThrow('blob down')
  })
})

describe('the browser gives up a session before the lock does', () => {
  test('its idle limit plus a whole move timeout is inside the lock TTL', () => {
    expect(CLAUDE_SESSION_IDLE_MS + MOVE_TIMEOUT_MS).toBeLessThan(GAMES_LIMITS.lockTtlMs)
  })
})
