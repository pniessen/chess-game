// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  Curator,
  LICHESS_HEADER,
  bucketOf,
  fnv1a,
  parseLichessLine,
  passesQuality,
  type LichessRow,
} from './puzzles-curate-lib'
import { DEFENCE } from '../tests/fixtures/puzzles'

const REAL_LINE =
  '0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,d3d6 f8d8 d6d8 f6d8,1468,75,96,37410,advantage endgame short,https://lichess.org/F8M8OS71#53,,'

/** A quality row replaying DEFENCE's (legal) line under another id, rating and themes. */
function row(id: string, rating: number, themes: string[], over: Partial<LichessRow> = {}): LichessRow {
  return {
    id, fen: DEFENCE.fen, moves: [...DEFENCE.moves], rating, themes,
    ratingDeviation: 75, popularity: 95, plays: 5000, ...over,
  }
}

describe('parseLichessLine', () => {
  test('reads a real dump row', () => {
    expect(parseLichessLine(REAL_LINE)).toEqual({
      id: '0000D', fen: DEFENCE.fen, moves: DEFENCE.moves, rating: 1468,
      ratingDeviation: 75, popularity: 96, plays: 37410, themes: ['advantage', 'endgame', 'short'],
    })
  })

  test('the header and junk read as null', () => {
    expect(parseLichessLine(LICHESS_HEADER)).toBeNull()
    expect(parseLichessLine('a,b')).toBeNull()
    expect(parseLichessLine('x,fen,e2e4 e7e5,abc,1,1,1,fork')).toBeNull()
  })
})

// Breaks if a threshold is off by one (the decision says <= 80, >= 85, >= 1000).
test('quality thresholds are inclusive', () => {
  expect(passesQuality(row('a', 1500, [], { ratingDeviation: 80, popularity: 85, plays: 1000 }))).toBe(true)
  expect(passesQuality(row('a', 1500, [], { ratingDeviation: 81 }))).toBe(false)
  expect(passesQuality(row('a', 1500, [], { popularity: 84 }))).toBe(false)
  expect(passesQuality(row('a', 1500, [], { plays: 999 }))).toBe(false)
})

test('ten 200-point buckets over 600..2599', () => {
  expect(bucketOf(599)).toBeNull()
  expect(bucketOf(600)).toBe(0)
  expect(bucketOf(799)).toBe(0)
  expect(bucketOf(800)).toBe(1)
  expect(bucketOf(2599)).toBe(9)
  expect(bucketOf(2600)).toBeNull()
})

test('fnv1a is standard 32-bit FNV-1a', () => {
  expect(fnv1a('')).toBe(0x811c9dc5)
  expect(fnv1a('a')).toBe(0xe40c292c)
})

describe('Curator', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    row(`p${String(i).padStart(2, '0')}`, 1200 + i, i === 7 ? ['skewer'] : ['advantage']),
  )
  const small = { perBucket: 3, minPerTheme: 1, candidatesPerBucket: 50 }

  // Breaks if selection depends on file order (a re-download would reshuffle the set).
  test('the same puzzles whatever the input order', () => {
    const a = new Curator(small)
    rows.forEach((r) => a.add(r))
    const b = new Curator(small)
    ;[...rows].reverse().forEach((r) => b.add(r))
    expect(a.result().puzzles).toEqual(b.result().puzzles)
  })

  // Breaks if the theme pass is dropped (rare themes would vanish from the set).
  test('per-bucket quota; a rare filter theme is always represented; output sorted and trimmed', () => {
    const c = new Curator(small)
    rows.forEach((r) => c.add(r))
    const out = c.result()
    expect(out.puzzles).toHaveLength(3)
    expect(out.perBucket).toEqual([0, 0, 0, 3, 0, 0, 0, 0, 0, 0])
    expect(out.puzzles.map((p) => p.id)).toContain('p07')
    const ratings = out.puzzles.map((p) => p.rating)
    expect(ratings).toEqual([...ratings].sort((x, y) => x - y))
    expect(Object.keys(out.puzzles[0] ?? {}).sort()).toEqual(['fen', 'id', 'moves', 'rating', 'themes'])
  })

  test('low-quality and out-of-range rows are ignored', () => {
    const c = new Curator(small)
    c.add(row('low', 1500, [], { plays: 10 }))
    c.add(row('high', 3000, []))
    c.add(row('easy', 400, []))
    expect(c.result()).toMatchObject({ puzzles: [], considered: 0 })
  })

  // Breaks if a puzzle is committed without being replayed through game-core.
  test('rows whose moves do not replay are rejected and reported', () => {
    const c = new Curator(small)
    c.add(row('bad', 1500, ['fork'], { moves: ['d3d6', 'a1a8'] }))
    c.add(row('good', 1500, ['fork']))
    const out = c.result()
    expect(out.puzzles.map((p) => p.id)).toEqual(['good'])
    expect(out.invalid).toEqual([expect.stringMatching(/^bad: move 2 \(a1a8\) is illegal/)])
  })

  // Breaks if the streaming trim keeps anything but the lowest hashes.
  test('keeps exactly the lowest-hash candidates while trimming as it streams', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`q${i}`, 1000, []))
    const c = new Curator({ perBucket: 30, minPerTheme: 0, candidatesPerBucket: 5 })
    many.forEach((r) => c.add(r))
    const expected = [...many].sort((x, y) => fnv1a(x.id) - fnv1a(y.id)).slice(0, 5).map((r) => r.id).sort()
    expect(c.result().puzzles.map((p) => p.id).sort()).toEqual(expected)
  })
})
