import type { Game } from '../game-core/game'
import { gameFromSan, importFen } from '../game-core/io'
import { STARTING_FEN } from '../game-core/types'

const FEN_PARAM = 'fen'
const MOVES_PARAM = 'moves'

/**
 * A cap on the encoded move list, well inside every browser's URL length
 * limit (Chrome/Firefox: ~32k+, Safari/older Edge: ~64k, but the practical
 * concern is a reasonable-looking link, not the ceiling) — past this the
 * link ships the FEN alone, which is always enough to reconstruct the
 * position.
 */
const MAX_MOVES_LENGTH = 1500

/** A defensive cap on the `fen` param itself: a real FEN is well under 100 chars. */
const MAX_FEN_LENGTH = 300

export interface SharedPosition {
  game: Game
}

export type ShareParseResult =
  | { kind: 'none' }
  | { kind: 'ok'; position: SharedPosition }
  | { kind: 'error'; message: string }

/**
 * The query string (with a leading '?') for the CURRENTLY DISPLAYED
 * position (`game.ply`, which may be mid-history-browse, not necessarily
 * the live position). The move list rides along too, but only when the
 * game started from the standard position and the list stays cheap — a
 * custom start position would need a third param to reconstruct, which
 * isn't worth it when the FEN alone already gets a recipient to the exact
 * position.
 */
export function buildShareQuery(game: Game): string {
  const params = new URLSearchParams()
  params.set(FEN_PARAM, game.current().fen())
  if (game.startFen === STARTING_FEN) {
    const sans = game.moves
      .slice(0, game.ply)
      .map((m) => m.san)
      .join(' ')
    if (sans.length > 0 && sans.length <= MAX_MOVES_LENGTH) params.set(MOVES_PARAM, sans)
  }
  return `?${params.toString()}`
}

/**
 * The full, absolute shareable URL, honouring the GitHub Pages base path
 * (`import.meta.env.BASE_URL`, exactly what src/assetUrl.ts uses) so a link
 * built on https://pniessen.github.io/chess-game/ carries that prefix
 * rather than pointing at the domain root.
 */
export function buildShareUrl(game: Game): string {
  const origin = window.location.origin
  const base = import.meta.env?.BASE_URL ?? '/'
  const prefixedBase = base.endsWith('/') ? base : `${base}/`
  return `${origin}${prefixedBase}${buildShareQuery(game)}`
}

/**
 * Reads a shared position back out of a URL's query string. Never throws:
 * a malformed or hostile `fen`/`moves` param falls back to `'error'` with a
 * message fit to show the user, exactly the way a bad PGN/FEN paste already
 * reports through GameIO's import — this is the same failure shape, just a
 * different source. `'none'` means there was no share link at all, which is
 * the overwhelmingly common case and must never be treated as an error.
 */
export function parseShareLink(search: string): ShareParseResult {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return { kind: 'error', message: 'That shared link could not be read.' }
  }

  const fen = params.get(FEN_PARAM)
  if (fen === null) return { kind: 'none' }
  if (fen.length === 0 || fen.length > MAX_FEN_LENGTH) {
    return { kind: 'error', message: "That shared link's position could not be read." }
  }

  const movesParam = params.get(MOVES_PARAM)
  if (movesParam && movesParam.length <= MAX_MOVES_LENGTH) {
    const sans = movesParam.split(/\s+/).filter(Boolean)
    try {
      const built = gameFromSan(sans)
      if (built.ok && built.game.current().fen() === fen.trim()) {
        return { kind: 'ok', position: { game: built.game } }
      }
    } catch {
      // Falls through to the FEN-only reconstruction below.
    }
  }

  try {
    const result = importFen(fen)
    if (!result.ok) {
      return { kind: 'error', message: `That shared link's position could not be read: ${result.error}` }
    }
    return { kind: 'ok', position: { game: result.game } }
  } catch {
    return { kind: 'error', message: "That shared link's position could not be read." }
  }
}
