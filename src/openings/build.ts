import { Position } from '../game-core/position'
import { sanTokens, uciOf } from '../game-core/notation'
import type { OpeningsData } from './data'

export interface TsvRow {
  eco: string
  name: string
  sans: string[]
}

/** lichess-org/chess-openings format: a header line `eco\tname\tpgn`, then one opening per line. */
export function parseTsv(text: string): TsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const [header, ...rows] = lines
  if (header?.trim() !== 'eco\tname\tpgn') throw new Error(`unexpected TSV header: ${header ?? '(empty)'}`)
  return rows.map((row, i) => {
    const [eco, name, pgn] = row.split('\t')
    if (!eco || !name || !pgn) throw new Error(`malformed TSV row ${i + 2}: ${row}`)
    return { eco, name, sans: sanTokens(pgn) }
  })
}

/**
 * Replay every line once through game-core (the only chess.js user) and
 * index each position by EPD. Deterministic: files and rows are processed
 * in order, so the same input always produces byte-identical JSON.
 */
export function buildOpeningsData(tsvTexts: readonly string[]): OpeningsData {
  const openings: OpeningsData['openings'] = []
  const positions: OpeningsData['positions'] = {}
  let maxPly = 0
  const entryFor = (epd: string): [number, string[]] => (positions[epd] ??= [-1, []])

  for (const text of tsvTexts) {
    for (const row of parseTsv(text)) {
      const id = openings.length
      openings.push([row.eco, row.name, row.sans.join(' ')])
      const pos = new Position()
      for (const san of row.sans) {
        const entry = entryFor(pos.epd())
        const r = pos.trySan(san)
        if (!r.ok) throw new Error(`${row.eco} ${row.name}: illegal move ${san}`)
        const uci = uciOf(r.move)
        if (!entry[1].includes(uci)) entry[1].push(uci)
      }
      const final = entryFor(pos.epd())
      if (final[0] === -1) final[0] = id
      maxPly = Math.max(maxPly, row.sans.length)
    }
  }
  return { v: 1, maxPly, openings, positions }
}
