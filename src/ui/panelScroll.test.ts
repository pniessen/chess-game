import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Task 5: the tab PANEL is the scroll container, not the document.
 *
 * These assertions are made against app.css's text rather than against a
 * rendered element because vitest runs in jsdom with `css: false` (see
 * vite.config.ts) — a CSS import is stubbed there, so `getComputedStyle`
 * in a unit test would report the UA defaults for every one of these
 * properties and pass no matter what the stylesheet said. The live,
 * computed version of the same check runs in a real browser in
 * tests/e2e/above-the-fold.spec.ts; this one exists to pin the RULES, so
 * that reinstating a fixed px cap is red even at a viewport where the e2e
 * suite happens not to look.
 *
 * Each one turns red if the change it names is reverted:
 *  - `.tab-panel` losing `overflow-y: auto` / `min-height: 0` puts the
 *    scrolling back on the document.
 *  - any of the three lists getting a px `max-height` back (420px on the
 *    moves list, 420px on `.history-list`, 280px on `.explorer-results`)
 *    is exactly what made the page 948px tall inside an 800px viewport.
 */

// `process.cwd()` is the project root under vitest — the same way
// moveMarkContrast.test.ts and dragTargetContrast.test.ts read this file.
const CSS = readFileSync(join(process.cwd(), 'src/ui/app.css'), 'utf8')

/**
 * The stylesheet's DESKTOP rules: everything above the phone breakpoint.
 * The three px caps deliberately survive inside `@media (max-width: 768px)`
 * — there the layout is a single column and the page is meant to scroll —
 * so a naive whole-file search would find them and prove nothing.
 */
const DESKTOP = CSS.slice(0, CSS.indexOf('@media (max-width: 768px)'))

/**
 * The declarations of the rule whose selector list is exactly `selector`,
 * written the way it appears in the file (newlines and all). Exact, not a
 * substring: `.move-list` must not match `.move-list li`.
 */
function ruleFor(selector: string, css = DESKTOP): string {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^[ \\t]*${literal}\\s*\\{([^}]*)\\}`, 'm')
  const match = pattern.exec(css)
  if (!match) throw new Error(`no rule with the exact selector \`${selector}\` in app.css`)
  return match[1] ?? ''
}

/** Declarations only — comments in this stylesheet quote the old values. */
function declarationsOf(selector: string, css = DESKTOP): string {
  return ruleFor(selector, css).replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('the tab panel is the scroll container', () => {
  test('.tab-panel scrolls itself and may shrink below its content', () => {
    const panel = declarationsOf('.tab-panel')
    expect(panel).toMatch(/overflow-y:\s*auto/)
    // Without this a flex item refuses to shrink under its content size, so
    // the panel would push the column past the board instead of scrolling.
    expect(panel).toMatch(/min-height:\s*0/)
    expect(panel).toMatch(/flex:\s*1 1 auto/)
  })

  test('.tab-panel only sets `display` when it is not the hidden one', () => {
    // Tabs.tsx keeps all four panels mounted and hides the inactive ones
    // with the `hidden` attribute. An author `display: flex` on `.tab-panel`
    // itself beats the UA stylesheet's `[hidden] { display: none }` — every
    // panel would be on screen at once.
    expect(declarationsOf('.tab-panel')).not.toMatch(/display:/)
    expect(declarationsOf('.tab-panel:not([hidden])')).toMatch(/display:\s*flex/)
  })
})

describe('no list carries a fixed px cap on the desktop layout', () => {
  for (const selector of ['.move-list', '.history-list', '.explorer-results']) {
    test(`${selector} takes the panel's height instead of a px max-height`, () => {
      const rule = declarationsOf(selector)
      expect(rule).not.toMatch(/max-height:\s*\d+px/)
      expect(rule).toMatch(/flex:\s*1 1 auto/)
      expect(rule).toMatch(/min-height:\s*0/)
      expect(rule).toMatch(/overflow-y:\s*auto/)
    })
  }

  test('the phone breakpoint keeps them, because there the page scrolls', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 768px)'))
    expect(declarationsOf('.move-list', phone)).toMatch(/max-height:\s*420px/)
    expect(declarationsOf('.history-list', phone)).toMatch(/max-height:\s*420px/)
    expect(declarationsOf('.explorer-results', phone)).toMatch(/max-height:\s*280px/)
  })
})

describe('both side columns are bounded by the board', () => {
  for (const selector of ['.left-column', '.right-column']) {
    test(`${selector} is capped at --board-size and scrolls inside it`, () => {
      const rule = declarationsOf(selector)
      expect(rule).toMatch(/max-height:\s*var\(--board-size\)/)
      expect(rule).toMatch(/overflow-y:\s*auto/)
      expect(rule).toMatch(/min-height:\s*0/)
    })
  }

  test('the phone breakpoint takes the caps off again', () => {
    const phone = CSS.slice(CSS.indexOf('@media (max-width: 768px)'))
    const rule = declarationsOf('.left-column,\n  .right-column', phone)
    expect(rule).toMatch(/max-height:\s*none/)
    expect(rule).toMatch(/overflow-y:\s*visible/)
  })
})
