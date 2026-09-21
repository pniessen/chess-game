import { expect, test } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

test('the nudge highlight is a translucent fill, not an opaque stroke', async ({ page }) => {
  // Regression guard: .annotation-square { stroke: none } and .tone-hint
  // { stroke: #2f80ed } used to have equal specificity, so source order let
  // the tone win and painted a ~2x2-square opaque stroke over the nudge
  // square (and the arrowhead), hiding the piece underneath. The DOM-attribute
  // assertions elsewhere in this file don't catch this — only computed style
  // does.
  await coachOffline(page)
  await page.goto('/')
  await startOnePlayer(page)

  await page.getByTestId('hint').click()
  const highlight = page.locator('[data-annotation="square"][data-tone="hint"]')
  await expect(highlight).toHaveCount(1)

  const style = await highlight.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { stroke: cs.stroke, strokeWidth: cs.strokeWidth, fillOpacity: cs.fillOpacity, opacity: cs.opacity }
  })
  // No stroke at all: neither a named stroke colour nor a nonzero stroke-width.
  expect(style.stroke === 'none' || parseFloat(style.strokeWidth) === 0).toBe(true)
  // The fill must be translucent, not a solid block.
  const effectiveOpacity = parseFloat(style.fillOpacity) * parseFloat(style.opacity)
  expect(effectiveOpacity).toBeGreaterThan(0)
  expect(effectiveOpacity).toBeLessThan(1)

  // The piece under the highlighted square (the king's home square, g1's
  // neighbour f1 is empty at game start — use e1, the king) stays visible:
  // the overlay must not force it hidden or transparent.
  const from = await highlight.getAttribute('data-annotation-square')
  const pieceUnderHighlight = page.locator(`[data-square="${from}"] .piece`)
  await expect(pieceUnderHighlight).toBeVisible()
  const pieceOpacity = await pieceUnderHighlight.evaluate((el) => getComputedStyle(el).opacity)
  expect(parseFloat(pieceOpacity)).toBe(1)
})

test('graded hints: nudge, then the move, then the reasoning; a move clears them', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await startOnePlayer(page)

  const hint = page.getByTestId('hint')
  const text = page.getByTestId('hint-text')
  const highlight = page.locator('[data-annotation="square"][data-tone="hint"]')
  const arrow = page.locator('[data-annotation="arrow"][data-tone="hint"]')

  // 1: the nudge — a highlighted piece and its name, but not the move.
  await hint.click()
  await expect(text).toContainText('Look at your', { timeout: 30_000 })
  await expect(highlight).toHaveCount(1)
  await expect(arrow).toHaveCount(0)
  await expect(hint).toHaveText('Show move')

  // 2: the move — an arrow from the highlighted square.
  await hint.click()
  await expect(arrow).toHaveCount(1)
  const from = await arrow.getAttribute('data-from')
  const to = await arrow.getAttribute('data-to')
  expect(await highlight.getAttribute('data-annotation-square')).toBe(from)
  await expect(text).toContainText('Try ')

  // 3: the reasoning.
  await hint.click()
  await expect(text).not.toContainText('Look at your', { timeout: 30_000 })
  await expect(text).toHaveText(/\S/)
  await expect(hint).toBeDisabled()

  // Play the suggested move by clicking THROUGH the overlay. If the overlay
  // took pointer events, Playwright would refuse: "<svg> intercepts pointer events".
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
  await expect(page.getByTestId('ply-count')).toHaveText(/^[12]$/)
  await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await expect(text).toHaveText('')
})
