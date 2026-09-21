import type { MoveIntent } from '../game-core/types'

export interface EngineInfo {
  depth?: number
  multipv?: number
  /** Centipawns, from the side-to-move's perspective. */
  scoreCp?: number
  /** Signed moves to mate; negative means the engine is being mated. */
  scoreMate?: number
  nodes?: number
  timeMs?: number
  pv: string[]
}

function firstNumber(line: string, re: RegExp): number | undefined {
  const m = line.match(re)
  return m?.[1] === undefined ? undefined : Number(m[1])
}

/**
 * Parse an `info` line. Returns null unless the line carries a principal
 * variation, since those are the only ones we act on.
 *
 * `pv` is always the final field and runs to end of line, so it must be
 * matched with a trailing pattern rather than a token count.
 */
export function parseInfo(line: string): EngineInfo | null {
  if (!line.startsWith('info ')) return null
  const pvMatch = line.match(/\bpv (.+)$/)
  if (!pvMatch?.[1]) return null

  const info: EngineInfo = { pv: pvMatch[1].trim().split(/\s+/) }
  const depth = firstNumber(line, /\bdepth (\d+)/)
  const multipv = firstNumber(line, /\bmultipv (\d+)/)
  const nodes = firstNumber(line, /\bnodes (\d+)/)
  const timeMs = firstNumber(line, /\btime (\d+)/)
  const scoreCp = firstNumber(line, /\bscore cp (-?\d+)/)
  const scoreMate = firstNumber(line, /\bscore mate (-?\d+)/)

  if (depth !== undefined) info.depth = depth
  if (multipv !== undefined) info.multipv = multipv
  if (nodes !== undefined) info.nodes = nodes
  if (timeMs !== undefined) info.timeMs = timeMs
  if (scoreCp !== undefined) info.scoreCp = scoreCp
  if (scoreMate !== undefined) info.scoreMate = scoreMate
  return info
}

export function parseBestMove(line: string): { best: string; ponder?: string } | null {
  if (!line.startsWith('bestmove')) return null
  const parts = line.trim().split(/\s+/)
  const best = parts[1]
  if (!best) return null
  const ponderIndex = parts.indexOf('ponder')
  const ponder = ponderIndex >= 0 ? parts[ponderIndex + 1] : undefined
  return ponder ? { best, ponder } : { best }
}

/**
 * Stockfish 19 terminates its own process on a malformed FEN or an illegal
 * move in a `position ... moves` list, announcing it on this line first.
 * If we ever see it the worker is dead and must be recreated.
 */
export function isCriticalError(line: string): boolean {
  return line.includes('CRITICAL ERROR')
}

/**
 * Convert UCI long algebraic notation into a MoveIntent.
 * "e2e4" -> { from: 'e2', to: 'e4' }; "e7e8q" adds promotion: 'q'.
 *
 * This lives here rather than in the controller because it is UCI notation
 * handling, and both the controller and the hint coach need it.
 */
export function uciToIntent(uci: string): MoveIntent | null {
  if (uci.length < 4 || uci === '(none)') return null
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promo = uci.slice(4, 5)
  return {
    from: from as MoveIntent['from'],
    to: to as MoveIntent['to'],
    ...(promo ? { promotion: promo as MoveIntent['promotion'] } : {}),
  }
}
