/** A tiny lichess-format dataset: header, then eco<TAB>name<TAB>pgn. */
export const FIXTURE_TSV = [
  'eco\tname\tpgn',
  'B20\tSicilian Defense\t1. e4 c5',
  'B27\tSicilian Defense: Hyperaccelerated Fianchetto\t1. e4 c5 2. Nf3 g6',
  "C20\tKing's Pawn Game\t1. e4 e5",
  "A40\tQueen's Pawn Game: Transposition Test\t1. d4 Nf6 2. c4 e6",
  'A10\tEnglish Opening: Transposition Test\t1. c4 e6 2. d4 Nf6',
].join('\n')

export const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
export const AFTER_E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
