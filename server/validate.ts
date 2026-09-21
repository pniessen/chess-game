import {
  LIMITS,
  type FlaggedClass,
  type FlaggedMove,
  type HintRequest,
  type ReviewRequest,
} from '../src/coach/protocol'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const FEN_RE =
  /^[1-8pnbrqkPNBRQK]+(?:\/[1-8pnbrqkPNBRQK]+){7} [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36]) \d{1,3} \d{1,4}$/
const SAN_RE =
  /^(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?$/
const EVAL_RE = /^(?:[+-]?\d{1,3}\.\d|-?M\d{1,3})$/
/** Letters (any script), digits, and the punctuation lichess opening names use. */
const NAME_RE = /^[\p{L}\p{N} .,:;'’()\-/!?+]+$/u
const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'] as const
const CLASSES: readonly FlaggedClass[] = ['inaccuracy', 'mistake', 'blunder']

const fail = (error: string) => ({ ok: false as const, error })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSan(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 10 && SAN_RE.test(v)
}

function isSide(v: unknown): v is 'w' | 'b' {
  return v === 'w' || v === 'b'
}

function isPercentOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
}

export function parseHintRequest(body: unknown): Parsed<HintRequest> {
  if (!isRecord(body)) return fail('body must be a JSON object')
  const { fen, bestMoveSan, line, evaluation } = body
  if (typeof fen !== 'string' || fen.length > 100 || !FEN_RE.test(fen)) return fail('fen is not a valid FEN')
  if (!isSan(bestMoveSan)) return fail('bestMoveSan must be a SAN move')
  if (!Array.isArray(line) || line.length > LIMITS.maxLine || !line.every(isSan)) {
    return fail(`line must be at most ${LIMITS.maxLine} SAN moves`)
  }
  if (typeof evaluation !== 'string' || !EVAL_RE.test(evaluation)) return fail('evaluation is malformed')
  return { ok: true, value: { fen, bestMoveSan, line, evaluation } }
}

function parseFlagged(v: unknown, moveCount: number): FlaggedMove | null {
  if (!isRecord(v)) return null
  const { ply, san, classification, bestSan, lossPct } = v
  if (typeof ply !== 'number' || !Number.isInteger(ply) || ply < 1 || ply > moveCount) return null
  if (!isSan(san)) return null
  if (!CLASSES.includes(classification as FlaggedClass)) return null
  if (bestSan !== null && !isSan(bestSan)) return null
  if (typeof lossPct !== 'number' || !Number.isFinite(lossPct) || lossPct < 0 || lossPct > 100) return null
  return { ply, san, classification: classification as FlaggedClass, bestSan, lossPct }
}

export function parseReviewRequest(body: unknown): Parsed<ReviewRequest> {
  if (!isRecord(body)) return fail('body must be a JSON object')
  const { moves, firstMover, result, opening, accuracy, flagged, humanSide } = body
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > LIMITS.maxMoves || !moves.every(isSan)) {
    return fail(`moves must be 1..${LIMITS.maxMoves} SAN moves`)
  }
  if (!isSide(firstMover)) return fail('firstMover must be "w" or "b"')
  if (!RESULTS.includes(result as (typeof RESULTS)[number])) return fail('result is not a PGN result')
  if (
    opening !== null &&
    (typeof opening !== 'string' || opening.length > LIMITS.maxOpeningName || !NAME_RE.test(opening))
  ) {
    return fail('opening is malformed')
  }
  if (!isRecord(accuracy) || !isPercentOrNull(accuracy['w']) || !isPercentOrNull(accuracy['b'])) {
    return fail('accuracy must be { w, b } percentages or null')
  }
  if (!Array.isArray(flagged) || flagged.length > LIMITS.maxFlagged) return fail('too many flagged moves')
  const parsedFlagged: FlaggedMove[] = []
  for (const f of flagged) {
    const p = parseFlagged(f, moves.length)
    if (!p) return fail('a flagged move is malformed')
    parsedFlagged.push(p)
  }
  if (humanSide !== null && !isSide(humanSide)) return fail('humanSide must be "w", "b" or null')
  return {
    ok: true,
    value: {
      moves,
      firstMover,
      result: result as ReviewRequest['result'],
      opening,
      accuracy: { w: accuracy['w'] as number | null, b: accuracy['b'] as number | null },
      flagged: parsedFlagged,
      humanSide,
    },
  }
}
