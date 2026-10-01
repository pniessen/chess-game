// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createEngine, EnginePool, parseBest, parseScore } from './stockfish'

describe('UCI parsing', () => {
  test('the last info line\'s score, and the bestmove', () => {
    expect(parseScore(['info depth 1 score cp 20 pv e2e4', 'info depth 2 score cp -15 pv d2d4', 'bestmove d2d4'])).toEqual({ cp: -15 })
    expect(parseScore(['info depth 5 score mate -3 pv a1a2'])).toEqual({ mate: -3 })
    expect(parseScore(['bestmove (none)'])).toBeNull()
    expect(parseBest('bestmove e7e8q ponder a2a3')).toBe('e7e8q')
    expect(parseBest('bestmove (none)')).toBeNull()
  })
})

describe('Stockfish in Node (the real engine, no network)', () => {
  test('two independent instances loaded at once; fetch survives, and no process handlers are left behind', async () => {
    const before = globalThis.fetch
    const handlers = process.listeners('unhandledRejection').length + process.listeners('uncaughtException').length
    const [a, b] = await Promise.all([createEngine(), createEngine()])
    expect(globalThis.fetch).toBe(before)
    expect(process.listeners('unhandledRejection').length + process.listeners('uncaughtException').length).toBe(handlers)
    // Back-rank mate in one for White.
    const mateIn1 = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'
    const [ea, eb] = await Promise.all([a.evaluate(mateIn1, 10), b.evaluate(mateIn1, 10)])
    expect(ea).toEqual({ score: { mate: 1 }, best: 'd1d8' })
    expect(eb).toEqual({ score: { mate: 1 }, best: 'd1d8' })
    expect(await a.fallbackMove(mateIn1)).toBe('d1d8')
  }, 30_000)

  test('the pool reuses a released engine rather than making another', async () => {
    let made = 0
    const pool = new EnginePool(async () => {
      made++
      return { evaluate: async () => ({ score: { cp: 0 }, best: null }), fallbackMove: async () => null }
    })
    const e1 = await pool.acquire()
    const e2 = await pool.acquire()
    expect(made).toBe(2)
    pool.release(e1)
    expect(await pool.acquire()).toBe(e1)
    expect(made).toBe(2)
    pool.release(e2)
  })
})
