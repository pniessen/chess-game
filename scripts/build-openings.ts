import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { OUTPUT_FILE, buildOpeningsJson } from './openings-lib'

const json = buildOpeningsJson()
mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
writeFileSync(OUTPUT_FILE, json)
const data = JSON.parse(json) as { openings: unknown[]; positions: object; maxPly: number }
console.log(
  `wrote ${OUTPUT_FILE}: ${data.openings.length} openings, ` +
    `${Object.keys(data.positions).length} positions, maxPly ${data.maxPly}, ` +
    `${(json.length / 1024).toFixed(0)} KiB`,
)
