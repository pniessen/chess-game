import { describe, expect, test } from 'vitest'
import { buildOpeningsData, parseTsv } from './build'
import { parseOpeningsData } from './data'
import { AFTER_E4_EPD, FIXTURE_TSV, START_EPD } from '../../tests/fixtures/openings'
import { Position } from '../game-core/position'

describe('parseTsv', () => {
  test('reads rows into SAN lists', () => {
    expect(parseTsv(FIXTURE_TSV)[1]).toEqual({
      eco: 'B27',
      name: 'Sicilian Defense: Hyperaccelerated Fianchetto',
      sans: ['e4', 'c5', 'Nf3', 'g6'],
    })
  })
  test('rejects a file with the wrong header', () => {
    expect(() => parseTsv('eco\tname\tuci\nA00\tx\te2e4')).toThrow(/header/)
  })
})

describe('buildOpeningsData', () => {
  const data = buildOpeningsData([FIXTURE_TSV])

  test('lists every opening in order', () => {
    expect(data.openings).toHaveLength(5)
    expect(data.openings[0]).toEqual(['B20', 'Sicilian Defense', 'e4 c5'])
    expect(data.maxPly).toBe(4)
  })

  test('records distinct continuations per position, in first-seen order', () => {
    expect(data.positions[START_EPD]).toEqual([-1, ['e2e4', 'd2d4', 'c2c4']])
    expect(data.positions[AFTER_E4_EPD]).toEqual([-1, ['c7c5', 'e7e5']])
  })

  test('names the final position of each line; a transposed duplicate keeps the first name', () => {
    const p = new Position()
    for (const san of ['e4', 'c5']) p.trySan(san)
    expect(data.positions[p.epd()]?.[0]).toBe(0)

    const q = new Position()
    for (const san of ['c4', 'e6', 'd4', 'Nf6']) q.trySan(san)
    expect(data.positions[q.epd()]?.[0]).toBe(3) // A40 came first
  })

  test('an illegal line fails the build loudly', () => {
    expect(() => buildOpeningsData(['eco\tname\tpgn\nX00\tBroken\t1. e4 e4'])).toThrow(/Broken.*e4/)
  })

  test('parseOpeningsData accepts the output and rejects junk', () => {
    expect(parseOpeningsData(JSON.parse(JSON.stringify(data)))).not.toBeNull()
    expect(parseOpeningsData({ v: 2 })).toBeNull()
    expect(parseOpeningsData('nope')).toBeNull()
  })
})
