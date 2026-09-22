import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildPuzzleData, puzzleJsonOf } from '../src/puzzles/build'

const fromRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

export const CURATED_FILE = fromRoot('data/puzzles/puzzles.csv')
export const PUZZLES_JSON = fromRoot('public/puzzles/puzzles.json')

export function buildPuzzlesJson(): string {
  return puzzleJsonOf(buildPuzzleData(readFileSync(CURATED_FILE, 'utf8')))
}
