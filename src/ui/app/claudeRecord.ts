import type { GameRecord } from '../../claude/gameClient'
import { CLAUDE_MODELS } from '../../claude/models'
import { exportPgn } from '../../game-core/io'
import { resultTagOf } from '../../match/result'
import type { MatchConfig, MatchSnapshot } from '../../match/types'

/** The server refuses a longer PGN (netlify/lib/gameHandler.ts MAX_PGN_CHARS is 20,000). */
const MAX_PGN_CHARS = 19_000

/** The comment a Stockfish stand-in move carries in the saved PGN. */
const FALLBACK_COMMENT = 'Stockfish fallback'

/** Claude vs Claude: both seats are Claude models (the only Claude mode v1 offers). */
export function isClaudeGame(
  config: MatchConfig,
): config is MatchConfig & { white: { kind: 'claude' }; black: { kind: 'claude' } } {
  return config.white.kind === 'claude' && config.black.kind === 'claude'
}

/** Each ply's rationale (or the fallback mark) as PGN comments, keyed by ply index. */
export function claudeComments(snapshot: Pick<MatchSnapshot, 'claude'>): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [ply, note] of Object.entries(snapshot.claude.notes)) {
    const text = note.fallback ? FALLBACK_COMMENT : note.why
    if (text) out[Number(ply)] = text
  }
  return out
}

/** PGN headers naming the players: the model's label for a Claude seat. */
export function claudeHeaders(snapshot: Pick<MatchSnapshot, 'config' | 'phase'>) {
  const name = (seat: MatchConfig['white']) => (seat.kind === 'claude' ? CLAUDE_MODELS[seat.model].label : undefined)
  const white = name(snapshot.config.white)
  const black = name(snapshot.config.black)
  return {
    ...(white ? { White: white } : {}),
    ...(black ? { Black: black } : {}),
    Result: resultTagOf(snapshot.phase),
  }
}

/**
 * What `ClaudeMover.end` saves for the game: the PGN (players named, each
 * rationale as a comment) and the fallback counts. A PGN too long for the
 * server is sent without its comments rather than refused.
 */
export function claudeRecordOf(snapshot: MatchSnapshot): GameRecord {
  const headers = claudeHeaders(snapshot)
  let pgn = exportPgn(snapshot.game, headers, claudeComments(snapshot))
  if (pgn.length > MAX_PGN_CHARS) pgn = exportPgn(snapshot.game, headers)
  return { pgn, fallbacks: { ...snapshot.claude.fallbacks } }
}
