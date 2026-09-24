import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BOARD_THEMES } from '../themes'

/**
 * `.square.drag-target::before` (board.css) pairs the brass ring with a
 * translucent dark edge because brass alone falls under WCAG's 3:1
 * non-text contrast minimum against the square colours (down around
 * 1.2–1.9:1 — checked by hand while building it). This test computes the
 * EDGE's contrast against every board theme's own square colours, straight
 * from board.css's own rgba() and BOARD_THEMES, rather than trusting a
 * hand-computed number in a comment (which drifts silently the moment
 * either side changes — see durations.test.ts for the same reasoning
 * applied to the animation timings).
 */
const css = readFileSync(join(process.cwd(), 'src/ui/Board/board.css'), 'utf8')

function edgeRgba(): { r: number; g: number; b: number; a: number } {
  const rule = css.match(/\.square\.drag-target::before\s*\{[^}]*\}/)?.[0]
  if (!rule) throw new Error('.square.drag-target::before not found in board.css')
  // The second (outer) inset shadow layer — the dark hairline, not the brass.
  const match = rule.match(/inset 0 0 0 4px rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!match) throw new Error('drag-target edge rgba() not found')
  const [, r, g, b, a] = match
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function blendOver(fg: { r: number; g: number; b: number; a: number }, bg: [number, number, number]): [number, number, number] {
  return [
    Math.round(fg.r * fg.a + bg[0] * (1 - fg.a)),
    Math.round(fg.g * fg.a + bg[1] * (1 - fg.a)),
    Math.round(fg.b * fg.a + bg[2] * (1 - fg.a)),
  ]
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const hi = Math.max(luminance(a), luminance(b))
  const lo = Math.min(luminance(a), luminance(b))
  return (hi + 0.05) / (lo + 0.05)
}

describe('the drag target ring clears WCAG 3:1 non-text contrast in every board theme', () => {
  const edge = edgeRgba()

  for (const theme of BOARD_THEMES) {
    test(`${theme.id} theme`, () => {
      const light = hexToRgb(theme.light)
      const dark = hexToRgb(theme.dark)
      const onLight = contrastRatio(blendOver(edge, light), light)
      const onDark = contrastRatio(blendOver(edge, dark), dark)
      // The dark square is the binding case in every theme this was
      // checked against; asserting both keeps that from silently flipping
      // unnoticed if a theme's colours change.
      expect(onLight).toBeGreaterThanOrEqual(3)
      expect(onDark).toBeGreaterThanOrEqual(3)
    })
  }
})
