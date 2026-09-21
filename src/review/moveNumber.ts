type Side = 'w' | 'b'

function numberOf(ply: number, firstMover: Side): { number: number; color: Side } {
  // Half-move index counted from White's move 1: a Black-first game starts at 1.
  const half = ply - 1 + (firstMover === 'w' ? 0 : 1)
  return { number: Math.floor(half / 2) + 1, color: half % 2 === 0 ? 'w' : 'b' }
}

/** "3... Nf6" / "4. Qxf7#" for the move at 1-based `ply`. */
export function moveLabel(ply: number, san: string, firstMover: Side): string {
  const { number, color } = numberOf(ply, firstMover)
  return color === 'w' ? `${number}. ${san}` : `${number}... ${san}`
}

export function numberedMoves(sans: readonly string[], firstMover: Side): string {
  const out: string[] = []
  sans.forEach((san, i) => {
    const ply = i + 1
    const { number, color } = numberOf(ply, firstMover)
    if (color === 'w') out.push(`${number}. ${san}`)
    else out.push(ply === 1 ? `${number}... ${san}` : san)
  })
  return out.join(' ')
}
