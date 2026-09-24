import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BOARD_THEMES } from '../themes'

/**
 * The last-move arrow's brass shaft and arrowhead are backed by a dark
 * edge (`.last-move-arrow-edge`, `.last-move-arrowhead`'s own stroke) for
 * exactly the reason `.square.drag-target::before` gives one to the drag
 * ring: brass alone measures under WCAG's 3:1 non-text contrast minimum
 * against these square colours. This test computes the edge's contrast
 * against every board theme's own square colours straight from board.css's
 * own rgba() and BOARD_THEMES, the same way dragTargetContrast.test.ts
 * checks the drag ring, rather than trusting a hand-checked number in a
 * comment.
 */
const css = readFileSync(join(process.cwd(), 'src/ui/Board/board.css'), 'utf8')

function edgeRgba(selector: string, property: 'stroke'): { r: number; g: number; b: number; a: number } {
  const escaped = selector.replace(/[.#]/g, '\\$&')
  const rule = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0]
  if (!rule) throw new Error(`${selector} not found in board.css`)
  const match = rule.match(new RegExp(`${property}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`))
  if (!match) throw new Error(`${selector} ${property} rgba() not found`)
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

describe.each([
  ['the last-move arrow shaft edge', '.last-move-arrow-edge', 'stroke' as const],
  ['the last-move arrowhead edge', '.last-move-arrowhead', 'stroke' as const],
])('%s clears WCAG 3:1 non-text contrast in every board theme', (_label, selector, property) => {
  const edge = edgeRgba(selector, property)

  for (const theme of BOARD_THEMES) {
    test(`${theme.id} theme`, () => {
      const light = hexToRgb(theme.light)
      const dark = hexToRgb(theme.dark)
      const onLight = contrastRatio(blendOver(edge, light), light)
      const onDark = contrastRatio(blendOver(edge, dark), dark)
      // The dark square is the binding case in every theme
      // dragTargetContrast.test.ts found for the same colour; asserting
      // both keeps that from silently flipping unnoticed.
      expect(onLight).toBeGreaterThanOrEqual(3)
      expect(onDark).toBeGreaterThanOrEqual(3)
    })
  }
})
