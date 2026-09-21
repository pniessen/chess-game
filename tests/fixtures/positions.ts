/**
 * Perft reference positions and node counts from the Chess Programming Wiki
 * "Perft Results" page, cross-checked against rocechess.ch and the
 * python-chess `tricky.perft` corpus. All three sources agreed exactly.
 */
export const PERFT_POSITIONS = [
  {
    name: 'initial position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    nodes: [20, 400, 8902, 197281],
  },
  {
    name: 'Kiwipete (position 2)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    nodes: [48, 2039, 97862, 4085603],
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    nodes: [14, 191, 2812, 43238],
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    nodes: [6, 264, 9467, 422333],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    nodes: [44, 1486, 62379, 2103487],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    nodes: [46, 2079, 89890, 3894594],
  },
] as const

/** Positions exercising one rule each, for the targeted rules tests. */
export const RULE_FIXTURES = {
  /** White pawn on a7 may promote to any of four pieces. */
  promotionChoice: '8/P7/8/8/8/8/8/K6k w - - 0 1',
  /** Black has just played d7-d5; White may capture en passant on d6. */
  enPassantAvailable: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
  /** White to move, castling rights intact, nothing attacked. */
  castlingAvailable: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
  /**
   * White king on e1 is in check from the black rook on e8 down the open
   * e-file, with castling rights still intact on both sides. Verified with
   * chess.js: isCheck() === true, and legalMovesFrom('e1') is ['f1','d1'] —
   * neither g1 nor c1.
   */
  castlingWhileInCheck: '4r2k/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQ - 0 1',
  /** Black king alone vs white king: insufficient material. */
  insufficientMaterial: '8/8/8/4k3/8/8/8/4K3 w - - 0 1',
  /** Black to move is stalemated. */
  stalemate: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
  /** White mates in one with Qxf7. */
  mateInOne: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
} as const
