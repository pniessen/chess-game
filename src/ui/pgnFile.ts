import type { Game } from '../game-core/game'
import { exportPgn, type PgnHeaders } from '../game-core/io'

function todayFileDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The download filename a PGN export gets: `chess-YYYY-MM-DD.pgn`. */
export function pgnFileName(now: Date = new Date()): string {
  return `chess-${todayFileDate(now)}.pgn`
}

/**
 * Download the game as a .pgn file. Extracted from GameIO (Task 6) so the
 * game-end card's "Export PGN" is the SAME export as the panel's button —
 * one implementation, one filename, one blob lifecycle.
 */
export function downloadPgn(game: Game, headers?: PgnHeaders): void {
  const pgn = exportPgn(game, headers)
  const blob = new Blob([pgn], { type: 'application/x-chess-pgn' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = pgnFileName()
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke once the click has been dispatched, or the blob leaks for the
  // page's lifetime.
  URL.revokeObjectURL(url)
}
