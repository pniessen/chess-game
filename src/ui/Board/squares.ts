import type { Square } from '../../game-core/types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const

/** Reading order for rendering: a8..h8, a7..h7, … h1 for a white view. */
export function squaresInOrder(orientation: 'white' | 'black'): Square[] {
  const out: Square[] = []
  for (const rank of RANKS) {
    for (const file of FILES) {
      out.push(`${file}${rank}` as Square)
    }
  }
  return orientation === 'white' ? out : out.reverse()
}

/** File letters left-to-right as the viewer sees them. */
export function filesInOrder(orientation: 'white' | 'black'): string[] {
  const files: string[] = [...FILES]
  return orientation === 'white' ? files : files.reverse()
}

/** Rank numbers top-to-bottom as the viewer sees them. */
export function ranksInOrder(orientation: 'white' | 'black'): string[] {
  const ranks = RANKS.map(String)
  return orientation === 'white' ? ranks : ranks.reverse()
}

export function isLightSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number])
  const rank = Number(square[1])
  return (file + rank) % 2 === 0
}

/**
 * A square's column and row in the 8x8 grid AS THE VIEWER SEES IT
 * (0,0 = top-left). The flight layer positions airborne pieces with it.
 */
export function squareCell(square: Square, orientation: 'white' | 'black'): { col: number; row: number } {
  const file = square.charCodeAt(0) - 97 // a = 0
  const rank = Number(square[1]) // 1..8
  return orientation === 'white'
    ? { col: file, row: 8 - rank }
    : { col: 7 - file, row: rank - 1 }
}
