/** The theme filter: common Lichess themes, in display order. */
export const PUZZLE_THEMES: readonly string[] = [
  'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'backRankMate', 'fork', 'pin', 'skewer',
  'discoveredAttack', 'hangingPiece', 'trappedPiece', 'sacrifice', 'deflection', 'attraction',
  'promotion', 'quietMove', 'defensiveMove', 'endgame',
]

const LABELS: Record<string, string> = {
  mate: 'Checkmate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  backRankMate: 'Back-rank mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  hangingPiece: 'Hanging piece',
  trappedPiece: 'Trapped piece',
  sacrifice: 'Sacrifice',
  deflection: 'Deflection',
  attraction: 'Attraction',
  promotion: 'Promotion',
  quietMove: 'Quiet move',
  defensiveMove: 'Defensive move',
  endgame: 'Endgame',
}

/** "kingsideAttack" -> "Kingside attack"; known themes use their label. */
export function themeLabel(theme: string): string {
  const known = LABELS[theme]
  if (known) return known
  const words = theme.replace(/([A-Z])/g, ' $1').replace(/(\d+)/g, ' $1').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
