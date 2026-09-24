// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OpeningBook, loadOpeningBook, resetOpeningBookCache } from './book'
import { buildOpeningsData } from './build'
import { AFTER_E4_EPD, FIXTURE_TSV, START_EPD } from '../../tests/fixtures/openings'
import { gameFromSan } from '../game-core/io'

const book = new OpeningBook(buildOpeningsData([FIXTURE_TSV]))

function epdsOf(sans: string[]): string[] {
  const r = gameFromSan(sans)
  if (!r.ok) throw new Error(r.error)
  return r.game.epds(sans.length)
}

describe('OpeningBook', () => {
  test('names an exact position and lists continuations', () => {
    expect(book.named(epdsOf(['e4', 'c5'])[2]!)?.name).toBe('Sicilian Defense')
    expect(book.named(START_EPD)).toBeNull()
    expect(book.continuations(AFTER_E4_EPD)).toEqual(['c7c5', 'e7e5'])
    expect(book.continuations('8/8/8/8/8/8/8/8 w - -')).toEqual([])
  })

  test('identify walks back to the latest named position', () => {
    // After 2.Nf3 (unnamed) the game is still a Sicilian.
    expect(book.identify(epdsOf(['e4', 'c5', 'Nf3']))?.eco).toBe('B20')
    expect(book.identify(epdsOf(['e4', 'c5', 'Nf3', 'g6']))?.eco).toBe('B27')
    expect(book.identify([START_EPD])).toBeNull()
  })

  test('transpositions are named by position, not by move order', () => {
    const viaEnglish = book.identify(epdsOf(['c4', 'e6', 'd4', 'Nf6']))
    const viaQueensPawn = book.identify(epdsOf(['d4', 'Nf6', 'c4', 'e6']))
    expect(viaEnglish).toEqual(viaQueensPawn)
    expect(viaEnglish?.eco).toBe('A40')
  })

  test('search matches name or ECO, case-insensitively, with a limit', () => {
    expect(book.search('sicilian').map((e) => e.eco)).toEqual(['B20', 'B27'])
    expect(book.search('b27').map((e) => e.eco)).toEqual(['B27'])
    expect(book.search('')).toHaveLength(5)
    expect(book.search('', 2)).toHaveLength(2)
    expect(book.all[1]?.moves).toEqual(['e4', 'c5', 'Nf3', 'g6'])
  })
})

describe('loadOpeningBook', () => {
  afterEach(() => resetOpeningBookCache())

  test('fetches, validates and caches', async () => {
    const data = buildOpeningsData([FIXTURE_TSV])
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(data)))
    const a = await loadOpeningBook(fetchImpl)
    const b = await loadOpeningBook(fetchImpl)
    expect(a?.all).toHaveLength(5)
    expect(b).toBe(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // Breaks under a subpath deploy (GitHub Pages), where the index is not at
  // the domain root.
  test('the default url follows the deploy base', async () => {
    vi.stubEnv('BASE_URL', '/chess-game/')
    const data = buildOpeningsData([FIXTURE_TSV])
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(data)))
    await loadOpeningBook(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/chess-game/openings/openings.json')
    vi.unstubAllEnvs()
  })

  test('a failure yields null and is retried next time', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 404 }))
    expect(await loadOpeningBook(failing)).toBeNull()
    const data = buildOpeningsData([FIXTURE_TSV])
    expect(await loadOpeningBook(async () => new Response(JSON.stringify(data)))).not.toBeNull()
  })
})
