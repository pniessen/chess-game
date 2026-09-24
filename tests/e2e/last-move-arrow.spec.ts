import { expect, test, type Page } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

async function twoPlayer(page: Page): Promise<void> {
  await coachOffline(page)
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

const arrow = (page: Page) => page.getByTestId('last-move-arrow')

// Red if the arrow is drawn at the start position, before any move exists.
test('no arrow at the start position', async ({ page }) => {
  await twoPlayer(page)
  await expect(arrow(page)).toHaveCount(0)
})

// Red if the arrow never appears, or names the wrong squares.
test('a move draws an arrow from origin to destination, alongside the square tint', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')

  await expect(arrow(page)).toHaveCount(1)
  await expect(arrow(page)).toHaveAttribute('data-from', 'e2')
  await expect(arrow(page)).toHaveAttribute('data-to', 'e4')
  await expect(page.locator('[data-square="e2"]')).toHaveClass(/last-move/)
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/last-move/)
})

// Red if the arrow stops tracking the move that led to the DISPLAYED
// position and instead keeps showing the most recently played move.
test('follows history browsing: shows the move at the browsed ply, not the live one', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await move(page, 'g1', 'f3')
  await expect(arrow(page)).toHaveAttribute('data-from', 'g1') // live position: 3. Nf3

  await page.getByTestId('move-1').click() // browse back to "1. e4" (White's first move)
  await expect(arrow(page)).toHaveAttribute('data-from', 'e2')
  await expect(arrow(page)).toHaveAttribute('data-to', 'e4')

  await page.getByTestId('move-2').click() // browse forward to "1...e5"
  await expect(arrow(page)).toHaveAttribute('data-from', 'e7')
  await expect(arrow(page)).toHaveAttribute('data-to', 'e5')
})

// Red if a new game leaves the previous game's arrow on the board.
test('a new game clears the arrow', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await expect(arrow(page)).toHaveCount(1)

  await page.getByTestId('new-game').click()
  await expect(arrow(page)).toHaveCount(0)
})

// Red if undo removes the move but leaves its arrow behind.
test('undo removes the arrow along with the move (or shows the prior move\'s arrow)', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await expect(arrow(page)).toHaveAttribute('data-from', 'e7')

  await page.getByTestId('undo').click()
  await expect(arrow(page)).toHaveAttribute('data-to', 'e4')

  await page.getByTestId('undo').click()
  await expect(arrow(page)).toHaveCount(0)
})

// Red if the arrow's geometry does not flip with the board.
test('flips with the board', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  const before = await arrow(page).locator('.last-move-arrow-line').getAttribute('y1')

  await page.getByTestId('flip').click()
  await expect(page.locator('.board.black')).toBeVisible()
  const after = await arrow(page).locator('.last-move-arrow-line').getAttribute('y1')
  expect(after).not.toBe(before)
})

// Red if the overlay intercepts the click instead of passing it through to
// the square underneath (Playwright would refuse with "<svg> intercepts
// pointer events" the same way hints.spec.ts's equivalent check would).
test('never blocks pointer events: a move can be played by clicking through the arrow', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await expect(arrow(page)).toHaveCount(1)

  // e4's own square is inside the arrow's bounding box; clicking it must
  // still reach the square, not the SVG layer drawn under the piece there.
  await move(page, 'e7', 'e5')
  await expect(page.getByTestId('ply-count')).toHaveText('2')
})

// Red if the last-move arrow and a hint arrow can't be told apart, or if
// either one stops showing once both are present.
test('shows together with a hint arrow, and the two stay visually distinct', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await startOnePlayer(page)
  await move(page, 'e2', 'e4')

  await expect(arrow(page)).toHaveCount(1)

  // The hint button is disabled until it is White's turn again (engine
  // replies to e2-e4 first) — Playwright's click() waits for that itself.
  await page.getByTestId('hint').click({ timeout: 30_000 })
  await page.getByTestId('hint').click() // stage 2: the hint arrow appears
  const hintArrow = page.locator('[data-annotation="arrow"][data-tone="hint"]')
  await expect(hintArrow).toHaveCount(1)

  // Both present at once.
  await expect(arrow(page)).toHaveCount(1)
  await expect(hintArrow).toHaveCount(1)

  const lastMoveColour = await arrow(page)
    .locator('.last-move-arrow-line')
    .evaluate((el) => getComputedStyle(el).stroke)
  const hintColour = await hintArrow.evaluate((el) => getComputedStyle(el).stroke)
  expect(lastMoveColour).not.toBe(hintColour)

  const lastMoveWidth = await arrow(page)
    .locator('.last-move-arrow-line')
    .evaluate((el) => getComputedStyle(el).strokeWidth)
  const hintWidth = await hintArrow.evaluate((el) => getComputedStyle(el).strokeWidth)
  expect(lastMoveWidth).not.toBe(hintWidth)
})

// Red if `prefers-reduced-motion: reduce` breaks the arrow (it is not
// itself animated, but it must still render normally under that setting).
test('renders under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await expect(arrow(page)).toHaveCount(1)
})
