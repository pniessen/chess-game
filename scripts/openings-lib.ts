import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildOpeningsData } from '../src/openings/build'

const fromRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

export const TSV_FILES = ['a', 'b', 'c', 'd', 'e'].map((l) => fromRoot(`data/openings/${l}.tsv`))
export const OUTPUT_FILE = fromRoot('public/openings/openings.json')

export function buildOpeningsJson(): string {
  return `${JSON.stringify(buildOpeningsData(TSV_FILES.map((f) => readFileSync(f, 'utf8'))))}\n`
}
