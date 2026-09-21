import type { Square } from '../../game-core/types'

export type AnnotationTone = 'hint' | 'best' | 'inaccuracy' | 'mistake' | 'blunder'

/**
 * Generic board markup. Hints use it now; the review (Task 12) reuses it for
 * the best-move arrow on a flagged move. Deliberately independent of what
 * produced it.
 */
export type Annotation =
  | { kind: 'square'; square: Square; tone: AnnotationTone }
  | { kind: 'arrow'; from: Square; to: Square; tone: AnnotationTone }

export const ANNOTATION_TONES: readonly AnnotationTone[] = ['hint', 'best', 'inaccuracy', 'mistake', 'blunder']

/** Centre of a square in board units (0..8), origin at the top-left of the VIEW. */
export function squareCenter(square: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97 // a = 0
  const rank = Number(square[1]) // 1..8
  const col = orientation === 'white' ? file : 7 - file
  const row = orientation === 'white' ? 8 - rank : rank - 1
  return { x: col + 0.5, y: row + 0.5 }
}

/** An arrow from centre to centre, stopped `headRoom` short so the head sits inside the target square. */
export function arrowLine(
  from: Square,
  to: Square,
  orientation: 'white' | 'black',
  headRoom = 0.35,
): { x1: number; y1: number; x2: number; y2: number } {
  const a = squareCenter(from, orientation)
  const b = squareCenter(to, orientation)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  const k = (len - headRoom) / len
  return { x1: a.x, y1: a.y, x2: a.x + dx * k, y2: a.y + dy * k }
}
