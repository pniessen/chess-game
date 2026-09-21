import type { MoveIntent } from './types'

/** Long algebraic (UCI) form of a move: e2e4, e7e8q. */
export function uciOf(m: MoveIntent): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`
}

const RESULT = /^(?:1-0|0-1|1\/2-1\/2|\*)$/

/** SAN moves out of PGN-style move text ("1. e4 e5 2.Nf3 3...a6 *"). */
export function sanTokens(moveText: string): string[] {
  return moveText
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t.length > 0 && !RESULT.test(t))
}
