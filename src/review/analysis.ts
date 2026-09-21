import { whiteWinPercent, type WhiteEval } from '../engine/evaluation'
import type { Color } from '../game-core/types'

export type MoveClass = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder'

/** Win-percentage points lost (Lichess). */
export const THRESHOLDS = { inaccuracy: 10, mistake: 20, blunder: 30 } as const

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function moverWinPercent(e: WhiteEval, mover: Color): number {
  const white = whiteWinPercent(e)
  return mover === 'w' ? white : 100 - white
}

export function classifyLoss(loss: number): MoveClass {
  if (loss >= THRESHOLDS.blunder) return 'blunder'
  if (loss >= THRESHOLDS.mistake) return 'mistake'
  if (loss >= THRESHOLDS.inaccuracy) return 'inaccuracy'
  return 'ok'
}

export function classifyMove(opts: {
  before: WhiteEval
  after: WhiteEval
  mover: Color
  playedUci: string
  bestUci: string | null
}): { classification: MoveClass; loss: number } {
  const loss = Math.max(0, moverWinPercent(opts.before, opts.mover) - moverWinPercent(opts.after, opts.mover))
  if (opts.bestUci !== null && opts.playedUci === opts.bestUci) return { classification: 'best', loss }
  return { classification: classifyLoss(loss), loss }
}

/** Lichess per-move accuracy from the mover's win% before and after. */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411
  return clamp(raw + 1, 0, 100) // +1: lila's uncertainty bonus
}

function stdDev(xs: readonly number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

/**
 * Lichess game accuracy per side. `whiteWinPercents[i]` is White's win% in
 * the position after i moves (i = 0 is the start), so move i goes from
 * index i-1 to i.
 */
export function gameAccuracy(
  whiteWinPercents: readonly number[],
  firstMover: Color,
): { w: number | null; b: number | null } {
  const n = whiteWinPercents.length - 1
  if (n < 1) return { w: null, b: null }

  const size = clamp(Math.floor(n / 10), 2, 8)
  const windows: number[][] = []
  const first = whiteWinPercents.slice(0, size)
  for (let i = 0; i < Math.min(size, whiteWinPercents.length) - 2; i++) windows.push(first)
  for (let i = 0; i + size <= whiteWinPercents.length; i++) windows.push(whiteWinPercents.slice(i, i + size))
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12))

  const perSide: Record<Color, Array<{ acc: number; weight: number }>> = { w: [], b: [] }
  for (let i = 1; i <= n; i++) {
    const mover: Color = ((i - 1) % 2 === 0) === (firstMover === 'w') ? 'w' : 'b'
    const prev = whiteWinPercents[i - 1] ?? 50
    const next = whiteWinPercents[i] ?? 50
    const acc = mover === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next)
    perSide[mover].push({ acc, weight: weights[i - 1] ?? 0.5 })
  }

  const side = (xs: Array<{ acc: number; weight: number }>): number | null => {
    if (xs.length === 0) return null
    const weighted = xs.reduce((s, x) => s + x.acc * x.weight, 0) / xs.reduce((s, x) => s + x.weight, 0)
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(1, x.acc), 0)
    return (weighted + harmonic) / 2
  }
  return { w: side(perSide.w), b: side(perSide.b) }
}
