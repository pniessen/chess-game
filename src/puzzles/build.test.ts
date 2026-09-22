import { describe, expect, test } from 'vitest'
import { CURATED_HEADER, buildPuzzleData, curatedCsvOf, parseCuratedCsv, puzzleJsonOf } from './build'
import { parsePuzzleData } from './data'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

describe('curated CSV', () => {
  test('round-trips through curatedCsvOf / parseCuratedCsv', () => {
    const csv = curatedCsvOf([DEFENCE, MULTI])
    expect(csv.startsWith(`${CURATED_HEADER}\n`)).toBe(true)
    expect(csv.endsWith('\n')).toBe(true)
    expect(parseCuratedCsv(csv)).toEqual([DEFENCE, MULTI])
  })

  test('a wrong header or a malformed row throws', () => {
    expect(() => parseCuratedCsv('PuzzleId,FEN\nx,y')).toThrow(/header/)
    expect(() => parseCuratedCsv(`${CURATED_HEADER}\n0000D,fen,e2e4 e7e5,notanumber,fork`)).toThrow(/row 2/)
  })
})

describe('buildPuzzleData', () => {
  // Breaks if the builder stops validating moves through game-core.
  test('validates every puzzle and names the bad one', () => {
    const bad = { ...DEFENCE, id: 'BAD01', moves: ['d3d6', 'a1a8'] }
    expect(() => buildPuzzleData(curatedCsvOf([DEFENCE, bad]))).toThrow(/puzzle BAD01: move 2 \(a1a8\) is illegal/)
  })

  test('rejects duplicate ids', () => {
    expect(() => buildPuzzleData(curatedCsvOf([DEFENCE, DEFENCE]))).toThrow(/duplicate puzzle id 0000D/)
  })

  test('the JSON it writes parses back to the same puzzles', () => {
    const json = puzzleJsonOf(buildPuzzleData(curatedCsvOf([DEFENCE, MULTI, BACK_RANK])))
    expect(json.endsWith('\n')).toBe(true)
    expect(json.split('\n')).toHaveLength(6) // opening line, 3 rows, closing line, trailing ''
    expect(parsePuzzleData(JSON.parse(json))).toEqual([DEFENCE, MULTI, BACK_RANK])
  })
})
