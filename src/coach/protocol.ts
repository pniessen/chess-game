/**
 * The browser <-> coach-server contract. Pure types and limits: imported by
 * both sides, so it must never import DOM or Node APIs.
 */
export const LIMITS = {
  maxBodyBytes: 32 * 1024,
  maxMoves: 600,
  maxLine: 12,
  maxFlagged: 100,
  maxOpeningName: 120,
} as const

export type CoachErrorKind = 'no-key' | 'rate-limited' | 'timeout' | 'auth' | 'upstream' | 'bad-request'

export type FlaggedClass = 'inaccuracy' | 'mistake' | 'blunder'

export interface HintRequest {
  fen: string
  bestMoveSan: string
  /** The engine's main line in SAN, starting with bestMoveSan. At most LIMITS.maxLine. */
  line: string[]
  /** From the side to move: "+0.8", "-1.2", "M3", "-M2". */
  evaluation: string
}

export interface FlaggedMove {
  ply: number
  san: string
  classification: FlaggedClass
  bestSan: string | null
  /** Win-percentage points lost by the move, 0..100. */
  lossPct: number
}

export interface ReviewRequest {
  moves: string[]
  firstMover: 'w' | 'b'
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  opening: string | null
  accuracy: { w: number | null; b: number | null }
  flagged: FlaggedMove[]
  humanSide: 'w' | 'b' | null
}

export interface CoachTextResponse {
  text: string
}

export interface CoachErrorResponse {
  error: { kind: CoachErrorKind; message: string }
}

export interface HealthResponse {
  ok: true
  claude: boolean
}
