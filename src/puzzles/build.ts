import { specOfRated, validateSpec } from './spec'
import type { PuzzleData, PuzzleRow, RatedPuzzle } from './types'

/** The committed curated file: the Lichess columns we keep, values unmodified. */
export const CURATED_HEADER = 'PuzzleId,FEN,Moves,Rating,Themes'

/** FEN, moves and themes contain spaces but never commas, so a plain split is exact. */
export function parseCuratedCsv(text: string): RatedPuzzle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const [header, ...rows] = lines
  if (header?.trim() !== CURATED_HEADER) throw new Error(`unexpected puzzles CSV header: ${header ?? '(empty)'}`)
  return rows.map((row, i) => {
    const fields = row.split(',')
    const [id, fen, moves, rating, themes] = fields
    const r = Number(rating)
    if (fields.length !== 5 || !id || !fen || !moves || themes === undefined || !Number.isInteger(r)) {
      throw new Error(`malformed puzzles CSV row ${i + 2}: ${row}`)
    }
    return { id, fen, moves: moves.split(' ').filter(Boolean), rating: r, themes: themes.split(' ').filter(Boolean) }
  })
}

export function curatedCsvOf(puzzles: readonly RatedPuzzle[]): string {
  const rows = puzzles.map((p) => [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')].join(','))
  return `${[CURATED_HEADER, ...rows].join('\n')}\n`
}

/** Every puzzle is replayed through game-core; any bad or duplicate one fails the build. Deterministic. */
export function buildPuzzleData(csvText: string): PuzzleData {
  const seen = new Set<string>()
  const puzzles: PuzzleRow[] = []
  for (const p of parseCuratedCsv(csvText)) {
    if (seen.has(p.id)) throw new Error(`duplicate puzzle id ${p.id}`)
    seen.add(p.id)
    const problem = validateSpec(specOfRated(p))
    if (problem) throw new Error(`puzzle ${p.id}: ${problem}`)
    puzzles.push([p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')])
  }
  return { v: 1, puzzles }
}

/** One row per line, so a re-curation shows up as a readable diff. */
export function puzzleJsonOf(data: PuzzleData): string {
  return `{"v":1,"puzzles":[\n${data.puzzles.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`
}
