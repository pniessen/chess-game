import type { Level } from '../storage/storage'

/** Stockfish stands in for a failed Claude turn at full strength, so the stand-in is never the weak link. */
export const CLAUDE_FALLBACK_LEVEL: Level = 8
/** This many Stockfish stand-ins for one side in one game, and that Claude is out. */
export const CLAUDE_FALLBACK_LIMIT = 5
