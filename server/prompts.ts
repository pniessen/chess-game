import type { HintRequest, ReviewRequest } from '../src/coach/protocol'
import { moveLabel, numberedMoves } from '../src/review/moveNumber'
import type { ClaudeRequest } from './claude'

const HINT_SYSTEM = [
  'You are a friendly chess coach explaining a move to an improving club player.',
  'A chess engine has already chosen the best move; your only job is to explain why it is good.',
  'Never recommend a different move, never mention moves that are not in the given line,',
  'and do not restate the FEN. Answer in at most three short sentences of plain text, no markdown.',
].join(' ')

const REVIEW_SYSTEM = [
  'You are a chess coach writing a short, encouraging post-game review.',
  'Use only the data given: refer to moves exactly as numbered, and never invent moves or evaluations.',
  'Mention the opening, the turning point, and one concrete lesson. At most 150 words, plain text, no headings.',
].join(' ')

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black')

export function hintPrompt(r: HintRequest): ClaudeRequest {
  const side = sideName(r.fen.split(' ')[1] === 'b' ? 'b' : 'w')
  return {
    system: HINT_SYSTEM,
    maxTokens: 1024,
    user: [
      `Position (FEN): ${r.fen}`,
      `Side to move: ${side}`,
      `Engine's best move: ${r.bestMoveSan}`,
      `Engine's main line: ${r.line.length > 0 ? r.line.join(' ') : r.bestMoveSan}`,
      `Evaluation for ${side}: ${r.evaluation}`,
      '',
      `Explain the idea behind ${r.bestMoveSan}.`,
    ].join('\n'),
  }
}

export function reviewPrompt(r: ReviewRequest): ClaudeRequest {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${x.toFixed(1)}%`)
  const flagged =
    r.flagged.length === 0
      ? 'None.'
      : r.flagged
          .map(
            (f) =>
              `- ${moveLabel(f.ply, f.san, r.firstMover)}: ${f.classification} ` +
              `(lost ${f.lossPct.toFixed(1)} points of winning chance)` +
              (f.bestSan ? `; the engine preferred ${f.bestSan}` : ''),
          )
          .join('\n')
  return {
    system: REVIEW_SYSTEM,
    maxTokens: 2048,
    user: [
      `Result: ${r.result}`,
      `Opening: ${r.opening ?? 'unnamed'}`,
      r.humanSide
        ? `The human played ${sideName(r.humanSide)}; address them as "you".`
        : 'Refer to the players as White and Black.',
      `Accuracy: White ${pct(r.accuracy.w)}, Black ${pct(r.accuracy.b)}`,
      `Moves: ${numberedMoves(r.moves, r.firstMover)}`,
      'Flagged moves:',
      flagged,
    ].join('\n'),
  }
}
