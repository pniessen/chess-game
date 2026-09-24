import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadPuzzleSet, parsePuzzleData, resetPuzzleSetCache } from './data'
import { DEFENCE, PUZZLE_FIXTURE } from '../../tests/fixtures/puzzles'

afterEach(() => resetPuzzleSetCache())

const respond = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

describe('parsePuzzleData', () => {
  test('reads the compact rows back into puzzles', () => {
    const set = parsePuzzleData(PUZZLE_FIXTURE)
    expect(set).toHaveLength(2)
    expect(set?.[0]).toEqual(DEFENCE)
  })

  // Breaks if one bad row makes the whole set unusable (or slips through).
  test('malformed rows are dropped, the rest kept', () => {
    const raw = {
      v: 1,
      puzzles: [
        ...PUZZLE_FIXTURE.puzzles,
        ['x'],
        null,
        ['odd', 'fen', 'e2e4', 1500, 'fork'],
        ['notuci', 'fen', 'e2e4 zz99', 1500, ''],
        ['norating', 'fen', 'e2e4 e7e5', 'high', ''],
      ],
    }
    expect(parsePuzzleData(raw)?.map((p) => p.id)).toEqual(['0000D', 'T0001'])
  })

  test('another version, another shape, or no usable rows read as null', () => {
    expect(parsePuzzleData({ v: 2, puzzles: PUZZLE_FIXTURE.puzzles })).toBeNull()
    expect(parsePuzzleData({ v: 1 })).toBeNull()
    expect(parsePuzzleData({ v: 1, puzzles: [] })).toBeNull()
    expect(parsePuzzleData('nope')).toBeNull()
  })
})

describe('loadPuzzleSet', () => {
  // Breaks if every open of puzzle mode refetches the file.
  test('fetches the bundled file once and caches it', async () => {
    const fetchImpl = vi.fn(async (_url: string) => respond(PUZZLE_FIXTURE))
    expect(await loadPuzzleSet(fetchImpl)).toHaveLength(2)
    expect(await loadPuzzleSet(fetchImpl)).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('/puzzles/puzzles.json')
  })

  // Breaks under a subpath deploy (GitHub Pages), where the file is not at
  // the domain root.
  test('the default url follows the deploy base', async () => {
    vi.stubEnv('BASE_URL', '/chess-game/')
    const fetchImpl = vi.fn(async (_url: string) => respond(PUZZLE_FIXTURE))
    await loadPuzzleSet(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/chess-game/puzzles/puzzles.json')
    vi.unstubAllEnvs()
  })

  // Breaks if a failure is cached (puzzles would stay broken until reload) or thrown.
  test('a 404 or a network error resolves to null and is retried next time', async () => {
    expect(await loadPuzzleSet(async (_url: string) => respond('missing', false))).toBeNull()
    expect(await loadPuzzleSet(async (_url: string) => { throw new TypeError('network') })).toBeNull()
    expect(await loadPuzzleSet(async (_url: string) => respond(PUZZLE_FIXTURE))).toHaveLength(2)
  })
})
