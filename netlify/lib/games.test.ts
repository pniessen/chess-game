// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest'
import { CLAUDE_SESSION_IDLE_MS, MOVE_TIMEOUT_MS, RESERVE_PER_GAME_USD } from '../../src/claude/models'
import {
  GAMES_LIMITS,
  authorizeMove,
  budgetLeft,
  chargeMove,
  checkGameToken,
  checkOwner,
  endGame,
  startGame,
} from './games'
import { fakeStore } from './limits.test'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const ENV = { OWNER_TOKEN: 'fake-owner-token' }
const SIDES = { white: 'haiku', black: 'sonnet' } as const

let store: ReturnType<typeof fakeStore>
beforeEach(() => {
  store = fakeStore()
})

async function start(now = NOW, sides: { white: string; black: string } = SIDES) {
  const r = await startGame(store, now, ENV, sides)
  if (!r.ok) throw new Error(`start failed: ${r.kind}`)
  return r
}

describe('checkOwner', () => {
  test('a missing or empty OWNER_TOKEN never matches, even an empty header', () => {
    expect(checkOwner('anything', {})).toBe(false)
    expect(checkOwner('', { OWNER_TOKEN: '' })).toBe(false)
    expect(checkOwner(null, { OWNER_TOKEN: '' })).toBe(false)
  })
  test('wrong, null and right headers', () => {
    expect(checkOwner('nope', ENV)).toBe(false)
    expect(checkOwner(null, ENV)).toBe(false)
    expect(checkOwner('fake-owner-token', ENV)).toBe(true)
  })
})

describe('startGame', () => {
  test('rejects unknown model keys', async () => {
    const r = await startGame(store, NOW, ENV, { white: 'gpt', black: 'haiku' })
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
    expect(await startGame(store, NOW + 1000, ENV, SIDES)).toEqual({ ok: false, kind: 'busy' })
  })
  test('an expired lock does not block a new game', async () => {
    await start()
    const r = await startGame(store, NOW + GAMES_LIMITS.lockTtlMs + 1, ENV, SIDES)
    expect(r.ok).toBe(true)
  })
  test('too little budget left is refused', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 19.9, reserved: 0 })
    expect(await startGame(store, NOW, ENV, { white: 'fable', black: 'fable' })).toEqual({ ok: false, kind: 'budget' })
  })
  test('a new month resets the budget', async () => {
    await store.setJSON('games/budget/2026-09', { spent: 19.99, reserved: 0 })
    expect(await budgetLeft(store, Date.UTC(2026, 9, 1))).toBe(GAMES_LIMITS.monthlyUsd)
  })
})

describe('authorizeMove', () => {
  test('an owner move is authorised with the side model', async () => {
    const g = await start()
    const a = { gameId: g.gameId, token: g.token, plies: 0 }
    expect(await authorizeMove(store, NOW, ENV, { ...a, side: 'white' })).toEqual({ ok: true, model: 'haiku' })
    expect(await authorizeMove(store, NOW, ENV, { ...a, side: 'black' })).toEqual({ ok: true, model: 'sonnet' })
  })
  test('a bad token or unknown game is forbidden', async () => {
    const g = await start()
    expect(await authorizeMove(store, NOW, ENV, { gameId: g.gameId, token: 'bad', side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
    expect(await authorizeMove(store, NOW, ENV, { gameId: 'nope', token: g.token, side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
  })
  test('a move refreshes the lock', async () => {
    const g = await start()
    const later = NOW + GAMES_LIMITS.lockTtlMs - 1000
    await authorizeMove(store, later, ENV, { gameId: g.gameId, token: g.token, side: 'white', plies: 0 })
    expect(await startGame(store, later + GAMES_LIMITS.lockTtlMs - 1000, ENV, SIDES)).toEqual({ ok: false, kind: 'busy' })
  })
  test('a lost lock is forbidden', async () => {
    const g = await start()
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    await start(t)
    expect(await authorizeMove(store, t, ENV, { gameId: g.gameId, token: g.token, side: 'white', plies: 0 })).toEqual({
      ok: false,
      kind: 'forbidden',
    })
  })
  test('ply 160 is over', async () => {
    const g = await start()
    const a = { gameId: g.gameId, token: g.token, side: 'white' as const }
    expect(await authorizeMove(store, NOW, ENV, { ...a, plies: 159 })).toMatchObject({ ok: true })
    expect(await authorizeMove(store, NOW, ENV, { ...a, plies: 160 })).toEqual({ ok: false, kind: 'over' })
  })
  test('spent at or over the reservation is budget', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet)
    expect(await authorizeMove(store, NOW, ENV, { gameId: g.gameId, token: g.token, side: 'white', plies: 2 })).toEqual({
      ok: false,
      kind: 'budget',
    })
  })
})

describe('chargeMove and endGame', () => {
  test('charges do not change what is left until the game ends', async () => {
    const g = await start()
    const before = await budgetLeft(store, NOW)
    await chargeMove(store, NOW, g.gameId, 0.05)
    expect(await budgetLeft(store, NOW)).toBeCloseTo(before, 6)
  })
  test('ending releases the lock and the unused reservation, and saves the record', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, 0.05)
    await endGame(store, NOW, g.gameId, { pgn: '1. e4 *', costUsd: 0.05 })
    expect(await budgetLeft(store, NOW)).toBeCloseTo(GAMES_LIMITS.monthlyUsd - 0.05, 6)
    expect(store.data.get(`games/saved/${g.gameId}`)).toMatchObject({ pgn: '1. e4 *' })
    expect((await startGame(store, NOW + 1, ENV, SIDES)).ok).toBe(true)
  })
  test('the saved record takes its money from the server-tracked game, not the caller', async () => {
    const g = await start()
    await chargeMove(store, NOW, g.gameId, 0.05)
    await endGame(store, NOW, g.gameId, { pgn: '1. e4 *', spent: 999, reserved: 999, costUsd: 999 })
    const saved = store.data.get(`games/saved/${g.gameId}`) as Record<string, number>
    expect(saved['spent']).toBeCloseTo(0.05, 6)
    expect(saved['reserved']).toBeCloseTo(RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet, 6)
  })
  test('chargeMove reports the game total so far', async () => {
    const g = await start()
    expect(await chargeMove(store, NOW, g.gameId, 0.05)).toBeCloseTo(0.05, 6)
    expect(await chargeMove(store, NOW, g.gameId, 0)).toBeCloseTo(0.05, 6)
    expect(await chargeMove(store, NOW, g.gameId, 0.01)).toBeCloseTo(0.06, 6)
  })
  test('checkGameToken accepts only that game\'s token', async () => {
    const g = await start()
    expect(checkGameToken(ENV, g.gameId, g.token)).toBe(true)
    expect(checkGameToken(ENV, 'other', g.token)).toBe(false)
    expect(checkGameToken({}, g.gameId, g.token)).toBe(false)
  })
  test('a charge that lands after the game ended still counts against the month', async () => {
    const g = await start()
    await endGame(store, NOW, g.gameId, { pgn: '*' })
    const before = await budgetLeft(store, NOW)
    const saved = JSON.stringify(store.data.get(`games/saved/${g.gameId}`))
    await chargeMove(store, NOW, g.gameId, 0.07)
    expect(await budgetLeft(store, NOW)).toBeCloseTo(before - 0.07, 6)
    expect(store.data.get('games/budget/2026-09')).toMatchObject({ spent: expect.closeTo(0.07, 6), reserved: 0 })
    expect(JSON.stringify(store.data.get(`games/saved/${g.gameId}`))).toBe(saved)
  })
  test('the same after a lapsed lock was settled by a new start', async () => {
    const a = await start()
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    await start(t)
    const before = await budgetLeft(store, t)
    await chargeMove(store, t, a.gameId, 0.07)
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
    expect(await startGame(store, t + 1, ENV, SIDES)).toEqual({ ok: false, kind: 'busy' })
  })
})

describe('abandoned games and failing reads', () => {
  test('starting after the lock expired settles the abandoned game', async () => {
    const a = await start()
    await chargeMove(store, NOW, a.gameId, 0.05)
    const t = NOW + GAMES_LIMITS.lockTtlMs + 1
    const b = await start(t)
    expect(store.data.get(`games/${a.gameId}`)).toMatchObject({ ended: true })
    expect(store.data.get(`games/saved/${a.gameId}`)).toMatchObject({ abandoned: true })
    const reserveB = RESERVE_PER_GAME_USD.haiku + RESERVE_PER_GAME_USD.sonnet
    expect(b.budgetLeftUsd).toBeCloseTo(GAMES_LIMITS.monthlyUsd - 0.05 - reserveB, 6)
    expect(store.data.get('games/budget/2026-09')).toMatchObject({ reserved: expect.closeTo(reserveB, 6) })
  })
  test('a store whose reads fail makes the guards reject, not open', async () => {
    const broken = { get: async () => Promise.reject(new Error('blob down')), setJSON: async () => undefined }
    await expect(startGame(broken, NOW, ENV, SIDES)).rejects.toThrow('blob down')
    await expect(budgetLeft(broken, NOW)).rejects.toThrow('blob down')
  })
})

describe('the browser gives up a session before the lock does', () => {
  test('its idle limit plus a whole move timeout is inside the lock TTL', () => {
    expect(CLAUDE_SESSION_IDLE_MS + MOVE_TIMEOUT_MS).toBeLessThan(GAMES_LIMITS.lockTtlMs)
  })
})
