/**
 * The pre-built opening index (public/openings/openings.json), produced by
 * scripts/build-openings.ts from the vendored lichess TSVs.
 */
export interface OpeningsData {
  v: 1
  /** Longest line in plies: no deeper position can be named. */
  maxPly: number
  /** [eco, name, space-separated SAN moves] — index = opening id. */
  openings: Array<[string, string, string]>
  /** EPD -> [id of the opening whose line ends exactly here, or -1; distinct UCI continuations]. */
  positions: Record<string, [number, string[]]>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Shape check for our own asset (a truncated or stale download must not crash the app). */
export function parseOpeningsData(raw: unknown): OpeningsData | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null
  if (typeof raw['maxPly'] !== 'number' || !Array.isArray(raw['openings']) || !isRecord(raw['positions'])) {
    return null
  }
  return raw as unknown as OpeningsData
}
