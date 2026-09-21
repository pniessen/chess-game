/**
 * Piece sets (Task 15, controller ruling P1). Rhosgfx (CC0) stays the
 * default set exactly as shipped since Phase 1; Cburnett (Wikimedia
 * Commons, GFDL/CC-BY-SA/GPL/BSD, redistributed here under BSD — see
 * NOTICE.md) is the second set the ruling authorizes.
 *
 * Each set's 12 pieces live under `/pieces/<id>/<code>.svg`, where `code`
 * is e.g. `wK`/`bQ` (see Piece.tsx) — so adding a set is just a new
 * directory of same-named files plus an entry here.
 */
export const PIECE_SETS = [
  { id: 'rhosgfx', label: 'Rhosgfx' },
  { id: 'cburnett', label: 'Cburnett' },
] as const

export type PieceSet = (typeof PIECE_SETS)[number]

/** Unknown ids (e.g. a setting saved by a future version) fall back to Rhosgfx. */
export function pieceSetOf(id: string): PieceSet {
  return PIECE_SETS.find((p) => p.id === id) ?? PIECE_SETS[0]
}

/** `code` is a piece code like `wK`/`bQ` (see Piece.tsx's LETTER table). */
export function pieceImageSrc(setId: string, code: string): string {
  return `/pieces/${pieceSetOf(setId).id}/${code}.svg`
}
