// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { endGame, startGame } from './games'
import { headToHead, resultOfPgn } from './headToHead'
import { fileStore } from './fileStore'
import { memoryStore } from './memoryStore'
import type { GameStore } from './store'

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0)
const pgn = (result: string) =>
  `[Event "Casual game"]\n[White "Claude Haiku 4.5"]\n[Black "Claude Sonnet 5.5"]\n[Result "${result}"]\n\n1. e4 e5 ${result}\n`

let store: GameStore
beforeEach(() => {
  store = memoryStore()
})

/** A saved record as settleGame writes it (only the fields the record reads matter). */
async function saved(white: string, black: string, record: Record<string, unknown>, s: GameStore = store) {
  const id = randomUUID()
  await s.setJSON(`games/saved/${id}`, { ...record, gameId: id, white, black, spent: 0, reserved: 0, endedAt: NOW })
  return id
}

describe('resultOfPgn', () => {
  test.each([
    ['1-0', '1-0'],
    ['0-1', '0-1'],
    ['1/2-1/2', '1/2-1/2'],
    ['*', '*'],
  ])('reads the Result tag %s', (tag, want) => {
    expect(resultOfPgn(pgn(tag))).toBe(want)
  })
  test('null for a PGN with no Result tag, a bogus one, or not a string', () => {
    expect(resultOfPgn('1. e4 e5 *')).toBeNull()
    expect(resultOfPgn('[Result "2-0"]\n\n1. e4')).toBeNull()
    expect(resultOfPgn(42)).toBeNull()
    expect(resultOfPgn(undefined)).toBeNull()
  })
})

describe('headToHead', () => {
  test('no saved games: all zero', async () => {
    expect(await headToHead(store, 'sonnet', 'haiku')).toEqual({
      games: 0,
      whiteModelWins: 0,
      blackModelWins: 0,
      draws: 0,
      whiteWins: 0,
      blackWins: 0,
    })
  })

  test('counts both colour orders, crediting the model, not the colour', async () => {
    await saved('sonnet', 'haiku', { pgn: pgn('1-0') }) // sonnet (white) wins
    await saved('haiku', 'sonnet', { pgn: pgn('0-1') }) // sonnet (black) wins
    await saved('haiku', 'sonnet', { pgn: pgn('1-0') }) // haiku (white) wins
    await saved('sonnet', 'haiku', { pgn: pgn('1/2-1/2') })
    // Other pairings are not counted.
    await saved('sonnet', 'opus', { pgn: pgn('1-0') })
    await saved('haiku', 'haiku', { pgn: pgn('1-0') })
    const r = await headToHead(store, 'sonnet', 'haiku')
    expect(r).toMatchObject({ games: 4, whiteModelWins: 2, blackModelWins: 1, draws: 1 })
    // By colour over the same games: white won 2 (sonnet as white, haiku as white), black 1.
    expect(r).toMatchObject({ whiteWins: 2, blackWins: 1 })
    // Asked the other way round, the model counts swap.
    expect(await headToHead(store, 'haiku', 'sonnet')).toMatchObject({
      games: 4,
      whiteModelWins: 1,
      blackModelWins: 2,
      draws: 1,
    })
  })

  test('a mirror match counts by colour', async () => {
    await saved('haiku', 'haiku', { pgn: pgn('1-0') })
    await saved('haiku', 'haiku', { pgn: pgn('1/2-1/2') })
    await saved('haiku', 'haiku', { pgn: pgn('1/2-1/2') })
    await saved('haiku', 'sonnet', { pgn: pgn('0-1') })
    expect(await headToHead(store, 'haiku', 'haiku')).toEqual({
      games: 3,
      whiteWins: 1,
      blackWins: 0,
      draws: 2,
      whiteModelWins: 1,
      blackModelWins: 0,
    })
  })

  test('skips unfinished (*), abandoned, unparseable and malformed records', async () => {
    await saved('sonnet', 'haiku', { pgn: pgn('*') }) // stopped: unavailable or budget
    await saved('sonnet', 'haiku', { abandoned: true })
    await saved('sonnet', 'haiku', { abandoned: true, pgn: pgn('1-0') })
    await saved('sonnet', 'haiku', { pgn: 'not a pgn' })
    await saved('sonnet', 'haiku', { pgn: 7 })
    await saved('sonnet', 'nobody', { pgn: pgn('1-0') })
    await store.setJSON('games/saved/weird', [1, 2])
    await store.setJSON('games/saved/null', null)
    await saved('sonnet', 'haiku', { pgn: pgn('0-1') })
    expect(await headToHead(store, 'sonnet', 'haiku')).toMatchObject({
      games: 1,
      whiteModelWins: 0,
      blackModelWins: 1,
      draws: 0,
    })
  })

  test('the 160-ply adjudicated draw and a real end, saved through endGame, both count', async () => {
    const secret = Buffer.from('s')
    for (const result of ['1/2-1/2', '1-0']) {
      const g = await startGame(store, NOW, secret, { white: 'sonnet', black: 'haiku' }, 'boot')
      if (!g.ok) throw new Error('start refused')
      await endGame(store, NOW, g.gameId, { pgn: pgn(result), fallbacks: { w: 0, b: 0 } })
    }
    // A game replaced mid-way is settled with '*': not counted.
    const g = await startGame(store, NOW, secret, { white: 'haiku', black: 'sonnet' }, 'boot')
    if (!g.ok) throw new Error('start refused')
    await endGame(store, NOW, g.gameId, { pgn: pgn('*'), fallbacks: { w: 0, b: 0 } })
    expect(await headToHead(store, 'sonnet', 'haiku')).toMatchObject({ games: 2, whiteModelWins: 1, draws: 1 })
  })

  test('the in-progress game records (games/<id>) are not saved games', async () => {
    const g = await startGame(store, NOW, Buffer.from('s'), { white: 'sonnet', black: 'haiku' }, 'boot')
    expect(g.ok).toBe(true)
    expect((await headToHead(store, 'sonnet', 'haiku')).games).toBe(0)
  })

  test('a corrupt saved file is skipped, not a failure, and the file store logs it once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'h2h-'))
    try {
      const logged: string[] = []
      const fs = fileStore(root, { log: (line) => logged.push(line) })
      await saved('sonnet', 'haiku', { pgn: pgn('1-0') }, fs)
      const bad = await saved('sonnet', 'haiku', { pgn: pgn('1-0') }, fs)
      await writeFile(join(root, 'games', 'saved', `${bad}.json`), '{oops')
      expect(await headToHead(fs, 'sonnet', 'haiku')).toMatchObject({ games: 1, whiteModelWins: 1 })
      expect(await headToHead(fs, 'sonnet', 'haiku')).toMatchObject({ games: 1 })
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain(`${bad}.json`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a store whose listing fails propagates (the handler answers 500)', async () => {
    const broken: GameStore = { ...store, keys: async () => Promise.reject(new Error('disk gone')) }
    await expect(headToHead(broken, 'sonnet', 'haiku')).rejects.toThrow('disk gone')
  })
})
