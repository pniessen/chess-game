/**
 * One-off, run by hand — never by npm install, build or test:
 *
 *   zstd -dc lichess_db_puzzle.csv.zst | npm run -s curate-puzzles
 *
 * Streams the full Lichess puzzle dump (CC0) from stdin and writes the
 * curated subset to data/puzzles/puzzles.csv. Then run `npm run puzzles`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { curatedCsvOf } from '../src/puzzles/build'
import { Curator, LICHESS_HEADER, parseLichessLine } from './puzzles-curate-lib'
import { CURATED_FILE } from './puzzles-lib'

if (process.stdin.isTTY) {
  console.error('usage: zstd -dc lichess_db_puzzle.csv.zst | npm run -s curate-puzzles')
  process.exit(2)
}

const curator = new Curator()
let header: string | null = null
let rows = 0
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (header === null) {
    header = line.trim()
    if (header !== LICHESS_HEADER) {
      console.error(`unexpected header: ${header}`)
      process.exit(1)
    }
    continue
  }
  rows++
  const row = parseLichessLine(line)
  if (row) curator.add(row)
}

const { puzzles, perBucket, invalid, considered } = curator.result()
mkdirSync(dirname(CURATED_FILE), { recursive: true })
writeFileSync(CURATED_FILE, curatedCsvOf(puzzles))
console.log(`read ${rows} rows; ${considered} passed quality in 600-2599`)
console.log(`kept ${puzzles.length} puzzles; per bucket: ${perBucket.join(' ')}`)
if (invalid.length > 0) console.log(`rejected ${invalid.length} sampled rows that do not replay:\n${invalid.join('\n')}`)
console.log(`wrote ${CURATED_FILE}`)
