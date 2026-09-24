import { expect, test, type Page } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

/**
 * Review-fix round 1 (Task 3): the first version of the "Stacking order"
 * change in board.css got the direction backwards — `.piece` painted ABOVE
 * `.board-overlay`, so a piece sat on top of its own hint highlight, and
 * `.square.legal::after` (no z-index at all) sat under a piece on a
 * capturable destination. hints.spec.ts's "piece underneath stays visible"
 * check passed either way (it only asserts opacity, not paint order), so it
 * did not catch this — these tests assert real paint order instead, via
 * `document.elementsFromPoint`.
 *
 * `.piece`, `.board-overlay` and its children, and `.square::after` all set
 * `pointer-events: none` so clicks reach the square underneath — which also
 * makes `elementsFromPoint` skip them entirely (verified: Chromium excludes
 * `pointer-events: none` elements from hit-testing, so without this they
 * would never appear in the result regardless of z-index, making the check
 * meaningless). Each test flips `pointer-events` to `auto` on exactly the
 * elements being compared, for the single synchronous measurement only, so
 * this never touches real click behaviour or leaks between tests.
 */
async function topmostOrder(page: Page, square: string): Promise<string[]> {
  const locator = page.locator(`[data-square="${square}"]`)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`no bounding box for ${square}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  return page.evaluate(
    ({ sq, x, y }) => {
      const style = document.createElement('style')
      style.textContent = '.piece, .board-overlay, .board-overlay * { pointer-events: auto !important; }'
      document.head.appendChild(style)
      const els = document.elementsFromPoint(x, y)
      const order = els.map((e) => {
        if (e instanceof HTMLImageElement && e.classList.contains('piece')) return 'piece'
        if (e.classList?.contains('annotation-square')) return 'annotation-square'
        if (e.classList?.contains('board-overlay')) return 'board-overlay'
        if (e.getAttribute('data-square') === sq) return 'square'
        return e.tagName.toLowerCase()
      })
      style.remove()
      return order
    },
    { sq: square, x, y },
  )
}

test.beforeEach(async ({ page }) => coachOffline(page))

// Red if a piece paints over its own hint highlight (the regression this
// round fixed): the annotation must come before the piece in paint order.
test('a hint highlight paints over the piece on its own (occupied) square', async ({ page }) => {
  await page.goto('/')
  await startOnePlayer(page)

  await page.getByTestId('hint').click()
  // Real engine analysis (HINT_BUDGET), same as hints.spec.ts's own wait.
  await expect(page.getByTestId('hint-text')).toContainText('Look at your', { timeout: 30_000 })
  const highlight = page.locator('[data-annotation="square"][data-tone="hint"]')
  await expect(highlight).toHaveCount(1)
  const square = await highlight.getAttribute('data-annotation-square')
  expect(square).toBeTruthy()
  // The start position always has a piece on the highlighted square — it is
  // the origin of a legal move.
  await expect(page.locator(`[data-square="${square}"] .piece`)).toBeVisible()

  const order = await topmostOrder(page, square!)
  const annotationIndex = order.indexOf('annotation-square')
  const pieceIndex = order.indexOf('piece')
  expect(annotationIndex).toBeGreaterThanOrEqual(0)
  expect(pieceIndex).toBeGreaterThanOrEqual(0)
  expect(annotationIndex).toBeLessThan(pieceIndex)
})

// Red if the legal-move dot paints under an enemy piece on a capturable
// destination (the corollary this round also fixed): `.square.legal` is the
// class actually applied to every legal destination in the running app,
// occupied or not (see the comment on `.square.legal::after` in board.css —
// `highlights.captures` is never populated, so `.square.capture` never
// applies today), so this is the element that must win.
test('the legal-move dot paints over an enemy piece on a capturable destination', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()

  const move = async (from: string, to: string) => {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
  await move('e2', 'e4')
  await move('d7', 'd5')
  // Select White's e4 pawn: d5 is now a legal, occupied (capturable) destination.
  await page.locator('[data-square="e4"]').click()

  const target = page.locator('[data-square="d5"]')
  await expect(target).toHaveClass(/legal/)
  await expect(target.locator('.piece')).toBeVisible()

  const order = await topmostOrder(page, 'd5')
  const squareIndex = order.indexOf('square')
  const pieceIndex = order.indexOf('piece')
  expect(squareIndex).toBeGreaterThanOrEqual(0)
  expect(pieceIndex).toBeGreaterThanOrEqual(0)
  expect(squareIndex).toBeLessThan(pieceIndex)
})
