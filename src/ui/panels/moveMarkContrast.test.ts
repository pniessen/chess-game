import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Task 8: the move-quality chip (`.mark-*` in app.css) is a translucent
 * coloured pill (a solid text colour over a low-alpha tinted background) —
 * so what a reader actually sees is that background FLATTENED onto the
 * surface behind it, not the bare rgba() alpha value. This computes that
 * flattened pixel straight from app.css's own rules and design tokens (never
 * a hand-checked number, which drifts silently the moment either side
 * changes — see dragTargetContrast.test.ts for the same reasoning applied
 * to the drag-target ring) and checks it against WCAG AA's 4.5:1 small-text
 * minimum, for every classification, against both row backgrounds the move
 * list actually uses (`--surface`, `--surface-2`), in both themes.
 */
const css = readFileSync(join(process.cwd(), 'src/ui/app.css'), 'utf8')

type Rgb = [number, number, number]
type Rgba = { r: number; g: number; b: number; a: number }

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function token(name: string, scope: 'light' | 'dark'): Rgb {
  // The light block is the bare `:root { ... }`; the dark one is
  // `:root[data-theme='dark'] { ... }` — both defined once, near the top.
  const block =
    scope === 'light'
      ? css.match(/:root\s*\{([^}]*)\}/)?.[1]
      : css.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1]
  if (!block) throw new Error(`:root (${scope}) block not found in app.css`)
  const m = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`--${name} not found in the ${scope} :root block`)
  return hexToRgb(m[1] as string)
}

function markRule(cls: string, scope: 'light' | 'dark'): { color: Rgb; bg: Rgba } {
  // Light rules are bare `.mark-x { ... }`; dark rules are the
  // `:root[data-theme='dark'] .mark-x { ... }` override further down.
  const pattern =
    scope === 'light'
      ? new RegExp(`(?<!dark'\\]\\s)\\.${cls}\\s*\\{([^}]*)\\}`)
      : new RegExp(`:root\\[data-theme='dark'\\]\\s+\\.${cls}\\s*\\{([^}]*)\\}`)
  const body = css.match(pattern)?.[1]
  if (!body) throw new Error(`.${cls} (${scope}) not found in app.css`)
  const color = body.match(/color:\s*(#[0-9a-fA-F]{6})/)?.[1]
  const bg = body.match(/background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!color || !bg) throw new Error(`.${cls} (${scope}) is missing color or rgba background`)
  const [, r, g, b, a] = bg
  return { color: hexToRgb(color), bg: { r: Number(r), g: Number(g), b: Number(b), a: Number(a) } }
}

function blendOver(fg: Rgba, under: Rgb): Rgb {
  return [
    Math.round(fg.r * fg.a + under[0] * (1 - fg.a)),
    Math.round(fg.g * fg.a + under[1] * (1 - fg.a)),
    Math.round(fg.b * fg.a + under[2] * (1 - fg.a)),
  ]
}

function luminance([r, g, b]: Rgb): number {
  const linear = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const hi = Math.max(luminance(a), luminance(b))
  const lo = Math.min(luminance(a), luminance(b))
  return (hi + 0.05) / (lo + 0.05)
}

describe('move-quality chips clear WCAG AA (4.5:1) in both themes', () => {
  for (const cls of ['mark-best', 'mark-inaccuracy', 'mark-mistake', 'mark-blunder']) {
    for (const scope of ['light', 'dark'] as const) {
      for (const surface of ['surface', 'surface-2']) {
        test(`${cls}, ${scope} theme, on --${surface}`, () => {
          const { color, bg } = markRule(cls, scope)
          const under = token(surface, scope)
          const chip = blendOver(bg, under)
          expect(contrastRatio(color, chip)).toBeGreaterThanOrEqual(4.5)
        })
      }
    }
  }
})

// The current move sits on a solid --brass background (.move.current in the
// same file), so its chip deliberately trades the classification colour for
// a neutral one (see the comment above `.move.current .mark`) — checked
// against --brass directly (opaque, so no surface blend is needed).
describe('the current move\'s neutral chip clears WCAG AA (4.5:1) against --brass', () => {
  for (const scope of ['light', 'dark'] as const) {
    test(`${scope} theme`, () => {
      const body = css.match(/\.move\.current \.mark\s*\{([^}]*)\}/)?.[1]
      if (!body) throw new Error('.move.current .mark not found in app.css')
      if (!body.includes('var(--on-brass)')) throw new Error('.move.current .mark no longer uses --on-brass')
      const color = token('on-brass', scope)
      const bg = body.match(/background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
      if (!bg) throw new Error('.move.current .mark background not found')
      const [, r, g, b, a] = bg
      const brass = token('brass', scope)
      const chip = blendOver({ r: Number(r), g: Number(g), b: Number(b), a: Number(a) }, brass)
      expect(contrastRatio(color, chip)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
