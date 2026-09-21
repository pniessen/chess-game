import { Chess } from 'chess.js'
import { Game } from './game'
import { STARTING_FEN } from './types'

export interface PgnHeaders {
  Event?: string
  Site?: string
  Date?: string
  Round?: string
  White?: string
  Black?: string
  Result?: string
  TimeControl?: string
}

function todayPgnDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

function resultTag(game: Game): string {
  const status = game.status()
  if (status.kind === 'checkmate') return status.winner === 'w' ? '1-0' : '0-1'
  if (status.kind === 'draw') return '1/2-1/2'
  return '*'
}

export function exportPgn(game: Game, headers: PgnHeaders = {}): string {
  const chess = new Chess(game.startFen)
  for (const m of game.moves) {
    chess.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })
  }

  const all: Record<string, string> = {
    Event: headers.Event ?? 'Casual game',
    Site: headers.Site ?? 'Local',
    Date: headers.Date ?? todayPgnDate(),
    Round: headers.Round ?? '-',
    White: headers.White ?? 'White',
    Black: headers.Black ?? 'Black',
    Result: headers.Result ?? resultTag(game),
  }
  if (headers.TimeControl) all['TimeControl'] = headers.TimeControl
  if (game.startFen !== STARTING_FEN) {
    all['SetUp'] = '1'
    all['FEN'] = game.startFen
  }
  // setHeader, not header(): header() is deprecated in chess.js 1.4.0 and
  // "will return null header tags". Verified against the installed .d.ts.
  for (const [k, v] of Object.entries(all)) chess.setHeader(k, v)

  return chess.pgn({ maxWidth: 80 })
}

export function importPgn(
  text: string,
): { ok: true; game: Game } | { ok: false; error: string } {
  if (text.trim().length === 0) {
    return { ok: false, error: 'The PGN is empty.' }
  }
  try {
    const chess = new Chess()
    chess.loadPgn(text)
    const headers = chess.getHeaders()
    const startFen = headers['FEN'] ?? STARTING_FEN
    const game = new Game({ fen: startFen })
    for (const m of chess.history({ verbose: true })) {
      const r = game.play({
        from: m.from,
        to: m.to,
        ...(m.promotion ? { promotion: m.promotion } : {}),
      })
      if (!r.ok) return { ok: false, error: `Illegal move in PGN: ${m.san}` }
    }
    if (game.moves.length === 0) {
      return { ok: false, error: 'The PGN contains no moves.' }
    }
    return { ok: true, game }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function importFen(
  text: string,
): { ok: true; game: Game } | { ok: false; error: string } {
  const fen = text.trim()
  try {
    // Constructing a Chess throws on an invalid FEN; let it validate for us.
    new Chess(fen)
    return { ok: true, game: new Game({ fen }) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
