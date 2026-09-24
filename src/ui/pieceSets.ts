/**
 * Piece sets (Task 15, controller ruling P1). Rhosgfx (CC0) stays the
 * default set exactly as shipped since Phase 1; Cburnett (Wikimedia
 * Commons, GFDL/CC-BY-SA/GPL/BSD, redistributed here under BSD — see
 * NOTICE.md) is the second set the ruling authorizes.
 *
 * Each set's 12 pieces live under `public/pieces/<id>/<code>.svg`, where `code`
 * is e.g. `wK`/`bQ` (see `pieceCode`) — so adding a set is just a new
 * directory of same-named files plus an entry here.
 */
import type { Color, PieceSymbol } from '../game-core/types'
import { assetUrl } from '../assetUrl'

export const PIECE_SETS = [
  { id: 'rhosgfx', label: 'Rhosgfx' },
  { id: 'cburnett', label: 'Cburnett' },
] as const

export type PieceSet = (typeof PIECE_SETS)[number]

/** Unknown ids (e.g. a setting saved by a future version) fall back to Rhosgfx. */
export function pieceSetOf(id: string): PieceSet {
  return PIECE_SETS.find((p) => p.id === id) ?? PIECE_SETS[0]
}

/** `code` is a piece code like `wK`/`bQ` (see `pieceCode`). */
export function pieceImageSrc(setId: string, code: string): string {
  return assetUrl(`pieces/${pieceSetOf(setId).id}/${code}.svg`)
}

const LETTER: Record<PieceSymbol, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

/** The piece code used for image file names and `data-piece` (wP, bQ, …). */
export function pieceCode(color: Color, type: PieceSymbol): string {
  return `${color === 'w' ? 'w' : 'b'}${LETTER[type]}`
}
