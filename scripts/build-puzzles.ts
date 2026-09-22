import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PUZZLES_JSON, buildPuzzlesJson } from './puzzles-lib'

const json = buildPuzzlesJson()
mkdirSync(dirname(PUZZLES_JSON), { recursive: true })
writeFileSync(PUZZLES_JSON, json)
const count = (JSON.parse(json) as { puzzles: unknown[] }).puzzles.length
console.log(`wrote ${PUZZLES_JSON}: ${count} puzzles, ${(json.length / 1024).toFixed(0)} KiB`)
