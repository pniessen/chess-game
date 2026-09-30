/**
 * The head-to-head record of two Claude models, computed on demand from the
 * saved games (`games/saved/<id>`, written by settleGame in ./games): there
 * are no separate counters to drift. Saved games are history, not money, so
 * a record that cannot be read or makes no sense is left out rather than
 * failing the request; the file store logs an unparseable file once.
 */
import { isClaudeModelKey, type ClaudeModelKey, type HeadToHead } from '../src/claude/models'
import type { GameStore } from './store'

const SAVED_PREFIX = 'games/saved/'

export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*'

/**
 * The PGN's `[Result "…"]` tag, or null when there is none or it is not one of
 * the four PGN results. The saved record has no result field of its own: the
 * browser writes the result into the PGN it sends to /api/game/end (see
 * resultTagOf in src/match/result.ts), so the tag is the record of it.
 */
export function resultOfPgn(pgn: unknown): PgnResult | null {
  if (typeof pgn !== 'string') return null
  const m = /^\s*\[Result\s+"([^"]*)"\]\s*$/m.exec(pgn)
  const tag = m?.[1]
  return tag === '1-0' || tag === '0-1' || tag === '1/2-1/2' || tag === '*' ? tag : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** What one saved game contributes, or null when it is not counted. */
function outcomeOf(v: unknown): { white: ClaudeModelKey; black: ClaudeModelKey; result: '1-0' | '0-1' | '1/2-1/2' } | null {
  if (!isRecord(v) || v['abandoned'] === true) return null
  const { white, black } = v
  if (!isClaudeModelKey(white) || !isClaudeModelKey(black)) return null
  const result = resultOfPgn(v['pgn'])
  if (result === null || result === '*') return null
  return { white, black, result }
}

/**
 * The record of `white` against `black` (see HeadToHead for what each count
 * means). A failed listing propagates, so the handler answers 500; a saved
 * game that fails to read is skipped.
 */
export async function headToHead(store: GameStore, white: ClaudeModelKey, black: ClaudeModelKey): Promise<HeadToHead> {
  const r: HeadToHead = { games: 0, whiteModelWins: 0, blackModelWins: 0, draws: 0, whiteWins: 0, blackWins: 0 }
  const keys = await store.keys(SAVED_PREFIX)
  const values = await Promise.all(keys.map((k) => store.get(k, { type: 'json' }).catch(() => null)))
  for (const v of values) {
    const o = outcomeOf(v)
    if (!o) continue
    const same = o.white === white && o.black === black
    const swapped = o.white === black && o.black === white
    if (!same && !swapped) continue
    r.games++
    if (o.result === '1/2-1/2') {
      r.draws++
      continue
    }
    const whiteWon = o.result === '1-0'
    if (whiteWon) r.whiteWins++
    else r.blackWins++
    // Credit the model that won. In a mirror match `same` holds, so this is by colour.
    if (whiteWon === same) r.whiteModelWins++
    else r.blackModelWins++
  }
  return r
}
