import { Chess, type Move } from 'chess.js'
import type {
  Color,
  GameStatus,
  MoveIntent,
  MoveResult,
  PieceSymbol,
  PlayedMove,
  Square,
} from './types'

/** Convert a chess.js Move (a class) into our plain, cloneable record. */
function toPlayedMove(m: Move): PlayedMove {
  return {
    san: m.san,
    from: m.from,
    to: m.to,
    piece: m.piece,
    color: m.color,
    captured: m.captured,
    promotion: m.promotion,
    // chess.js isCapture() is FALSE for en passant — fix it here, once.
    isCapture: m.isCapture() || m.isEnPassant(),
    isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
    isEnPassant: m.isEnPassant(),
    fenAfter: m.after,
  }
}

export class Position {
  private readonly chess: Chess

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess()
  }

  static fromFen(
    fen: string,
  ): { ok: true; position: Position } | { ok: false; error: string } {
    try {
      return { ok: true, position: new Position(fen) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  fen(): string {
    return this.chess.fen()
  }

  /**
   * The position as an EPD key: placement, side, castling, en passant.
   * The en-passant square is omitted when unusable, relying on chess.js
   * to filter it from its own fen() output.
   */
  epd(): string {
    return this.chess.fen().split(' ').slice(0, 4).join(' ')
  }

  turn(): Color {
    return this.chess.turn()
  }

  board() {
    return this.chess.board()
  }

  /**
   * Every legal move, with promotions expanded into four separate intents.
   * The expansion matters: a collapsed promotion undercounts in perft and
   * would hide a whole class of move-generation bug.
   */
  legalMoves(): MoveIntent[] {
    return this.chess.moves({ verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }))
  }

  legalMovesFrom(square: Square): MoveIntent[] {
    return this.chess.moves({ square, verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }))
  }

  /** Would a move from->to require choosing a promotion piece? */
  isPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && m.promotion !== undefined)
  }

  /** Never throws. An illegal move is a returned value. */
  tryMove(intent: MoveIntent): MoveResult {
    if (this.status().kind !== 'in-progress') {
      return { ok: false, reason: 'game-over' }
    }
    if (!intent.promotion && this.isPromotion(intent.from, intent.to)) {
      return { ok: false, reason: 'needs-promotion' }
    }
    try {
      const m = this.chess.move({
        from: intent.from,
        to: intent.to,
        ...(intent.promotion ? { promotion: intent.promotion } : {}),
      })
      return { ok: true, move: toPlayedMove(m) }
    } catch {
      return { ok: false, reason: 'illegal' }
    }
  }

  /** Apply a SAN move. Never throws: chess.js throws on illegal input, we return a value. */
  trySan(san: string): MoveResult {
    if (this.status().kind !== 'in-progress') {
      return { ok: false, reason: 'game-over' }
    }
    try {
      return { ok: true, move: toPlayedMove(this.chess.move(san)) }
    } catch {
      return { ok: false, reason: 'illegal' }
    }
  }

  undo(): PlayedMove | null {
    const m = this.chess.undo()
    return m ? toPlayedMove(m) : null
  }

  /**
   * Order matters and is deliberate: checkmate first, then each draw
   * condition in a fixed priority so the reported reason is deterministic.
   */
  status(): GameStatus {
    if (this.chess.isCheckmate()) {
      return { kind: 'checkmate', winner: this.chess.turn() === 'w' ? 'b' : 'w' }
    }
    if (this.chess.isStalemate()) {
      return { kind: 'draw', reason: 'stalemate' }
    }
    if (this.chess.isInsufficientMaterial()) {
      return { kind: 'draw', reason: 'insufficient-material' }
    }
    if (this.chess.isThreefoldRepetition()) {
      return { kind: 'draw', reason: 'threefold-repetition' }
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return { kind: 'draw', reason: 'fifty-move-rule' }
    }
    return { kind: 'in-progress', inCheck: this.chess.isCheck() }
  }

  kingSquare(color: Color): Square | null {
    const found = this.chess.findPiece({ color, type: 'k' as PieceSymbol })
    return found[0] ?? null
  }

  clone(): Position {
    return new Position(this.fen())
  }
}
