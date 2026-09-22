import { specOfRated, validateSpec } from '../src/puzzles/spec'
import { PUZZLE_THEMES } from '../src/puzzles/themes'
import type { RatedPuzzle } from '../src/puzzles/types'

export const LICHESS_HEADER =
  'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate'

export const QUALITY = { maxRatingDeviation: 80, minPopularity: 85, minPlays: 1000 } as const
export const RATING_MIN = 600
/** Exclusive. */
export const RATING_MAX = 2600
export const BUCKET_WIDTH = 200
export const BUCKET_COUNT = (RATING_MAX - RATING_MIN) / BUCKET_WIDTH

export interface LichessRow extends RatedPuzzle {
  ratingDeviation: number
  popularity: number
  plays: number
}

/** One dump line; null for the header or anything malformed. Extra columns are ignored. */
export function parseLichessLine(line: string): LichessRow | null {
  const f = line.split(',')
  if (f.length < 8) return null
  const [id, fen, moves, rating, rd, popularity, plays, themes] = f
  if (!id || !fen || !moves || id === 'PuzzleId') return null
  const [r, d, p, n] = [rating, rd, popularity, plays].map((x) => Number(x))
  if (r === undefined || d === undefined || p === undefined || n === undefined) return null
  if (![r, d, p, n].every((x) => Number.isFinite(x))) return null
  return {
    id, fen, moves: moves.split(' ').filter(Boolean), rating: r,
    themes: (themes ?? '').split(' ').filter(Boolean),
    ratingDeviation: d, popularity: p, plays: n,
  }
}

export function passesQuality(r: LichessRow): boolean {
  return r.ratingDeviation <= QUALITY.maxRatingDeviation && r.popularity >= QUALITY.minPopularity && r.plays >= QUALITY.minPlays
}

export function bucketOf(rating: number): number | null {
  if (rating < RATING_MIN || rating >= RATING_MAX) return null
  return Math.floor((rating - RATING_MIN) / BUCKET_WIDTH)
}

/** 32-bit FNV-1a: a stable, order-independent sampling key. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

interface Candidate {
  row: LichessRow
  hash: number
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byHash = (a: Candidate, b: Candidate) => a.hash - b.hash || byId(a.row.id, b.row.id)

/**
 * From candidates in hash order: first up to `minPerTheme` rounds of one
 * puzzle per filter theme, then fill to `n` in hash order. `isValid` runs
 * at most once per candidate.
 */
export function pickDiverse(
  candidates: readonly LichessRow[],
  n: number,
  minPerTheme: number,
  isValid: (r: LichessRow) => boolean,
): LichessRow[] {
  const verdict = new Map<string, boolean>()
  const taken = new Set<string>()
  const chosen: LichessRow[] = []
  const usable = (r: LichessRow): boolean => {
    if (taken.has(r.id)) return false
    let ok = verdict.get(r.id)
    if (ok === undefined) {
      ok = isValid(r)
      verdict.set(r.id, ok)
    }
    return ok
  }
  const take = (r: LichessRow) => {
    taken.add(r.id)
    chosen.push(r)
  }
  for (let round = 0; round < minPerTheme; round++) {
    for (const theme of PUZZLE_THEMES) {
      if (chosen.length >= n) return chosen
      const next = candidates.find((r) => r.themes.includes(theme) && usable(r))
      if (next) take(next)
    }
  }
  for (const r of candidates) {
    if (chosen.length >= n) break
    if (usable(r)) take(r)
  }
  return chosen
}

export interface CuratorOptions {
  perBucket: number
  minPerTheme: number
  candidatesPerBucket: number
}

export const DEFAULT_CURATOR_OPTIONS: CuratorOptions = { perBucket: 300, minPerTheme: 6, candidatesPerBucket: 4000 }

export interface CurationResult {
  puzzles: RatedPuzzle[]
  perBucket: number[]
  /** `id: reason` for every sampled row that failed game-core validation. */
  invalid: string[]
  /** Rows that passed the quality filter and fell in a bucket. */
  considered: number
}

/** Streams dump rows in; memory stays bounded (about 2 x candidatesPerBucket rows per bucket). */
export class Curator {
  private readonly opts: CuratorOptions
  private readonly buckets: Candidate[][] = Array.from({ length: BUCKET_COUNT }, () => [])
  private considered = 0

  constructor(opts: Partial<CuratorOptions> = {}) {
    this.opts = { ...DEFAULT_CURATOR_OPTIONS, ...opts }
  }

  add(row: LichessRow): void {
    if (!passesQuality(row)) return
    const b = bucketOf(row.rating)
    const bucket = b === null ? undefined : this.buckets[b]
    if (!bucket) return
    this.considered++
    bucket.push({ row, hash: fnv1a(row.id) })
    // Dropping anything outside the current lowest K is safe: at least K
    // lower hashes already exist, so it can never be in the final lowest K.
    if (bucket.length >= 2 * this.opts.candidatesPerBucket) {
      bucket.sort(byHash)
      bucket.length = this.opts.candidatesPerBucket
    }
  }

  result(): CurationResult {
    const invalid: string[] = []
    const isValid = (r: LichessRow): boolean => {
      const problem = validateSpec(specOfRated(r))
      if (problem) invalid.push(`${r.id}: ${problem}`)
      return problem === null
    }
    const chosen: LichessRow[] = []
    const perBucket: number[] = []
    for (const bucket of this.buckets) {
      const sorted = [...bucket].sort(byHash).slice(0, this.opts.candidatesPerBucket).map((c) => c.row)
      const picked = pickDiverse(sorted, this.opts.perBucket, this.opts.minPerTheme, isValid)
      perBucket.push(picked.length)
      chosen.push(...picked)
    }
    chosen.sort((a, b) => a.rating - b.rating || byId(a.id, b.id))
    return {
      puzzles: chosen.map(({ id, fen, moves, rating, themes }) => ({ id, fen, moves, rating, themes })),
      perBucket,
      invalid,
      considered: this.considered,
    }
  }
}
