import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 9: hovering or focusing a move in the move list shows a small board
 * popover of that position, without touching the displayed board.
 */

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('hovering an earlier move previews that position without changing the displayed board', async ({ page }) => {
  await play(page, [['e2', 'e4'], ['e7', 'e5']])
  await page.getByTestId('tab-moves').click()
  await expect(page.getByTestId('move-preview')).toHaveCount(0)

  // Hover move 1 (1. e4) while the board itself is showing the position
  // after move 2 (1...e5).
  await page.getByTestId('move-1').hover()
  const preview = page.getByTestId('move-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('Position after e4')

  // The MAIN board is untouched: still on e7-e5, not reverted to e2-e4.
  await expect(page.locator('[data-square="e5"] [data-piece="bP"]')).toBeVisible()
  await expect(page.locator('[data-square="e7"] [data-piece]')).toHaveCount(0)

  // Moving off the move hides the popover again.
  await page.getByTestId('move-2').hover()
  await expect(preview).toContainText('Position after e5')
})

test('is keyboard-reachable: focusing a move shows the preview, Escape dismisses it without losing focus', async ({ page }) => {
  await play(page, [['e2', 'e4']])
  await page.getByTestId('tab-moves').click()

  await page.getByTestId('move-1').focus()
  await expect(page.getByTestId('move-preview')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('move-preview')).toHaveCount(0)
  // Escape closed the popover, not the focus.
  await expect(page.getByTestId('move-1')).toBeFocused()
})

test('hovering a move does not stop clicking it from jumping to that ply', async ({ page }) => {
  await play(page, [['e2', 'e4'], ['e7', 'e5']])
  await page.getByTestId('tab-moves').click()

  await page.getByTestId('move-1').hover()
  await page.getByTestId('move-1').click()
  await expect(page.getByTestId('move-1')).toHaveClass(/current/)
})

test('the preview stays fully inside the viewport at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await play(page, [['e2', 'e4']])
  await page.getByTestId('tab-moves').click()
  await page.getByTestId('move-1').hover()

  const box = await page.getByTestId('move-preview').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
  expect(box!.y + box!.height).toBeLessThanOrEqual(900)
})

/**
 * A tap on a move both focuses AND clicks it (jumping immediately), so a
 * hover-style reveal is meaningless on touch — there's no real "hovering
 * without acting" gesture. The chosen fallback: the preview still opens on
 * focus (a real keyboard/switch-access user gets it), and it still stays
 * fully clamped inside a phone-width viewport when it does. Tapping to jump
 * is completely unchanged.
 */
test('at phone width the preview stays inside the viewport when reached by focus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await play(page, [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3']])
  await page.getByTestId('tab-moves').click()

  await page.getByTestId('move-3').focus()
  const preview = page.getByTestId('move-preview')
  await expect(preview).toBeVisible()

  const box = (await preview.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(375)
  expect(box.y + box.height).toBeLessThanOrEqual(812)
})

/**
 * The true edge case: the anchor itself sits right at the bottom of a SHORT
 * viewport, so clampToViewport's ceiling branch (`top = innerHeight -
 * MOVE_PREVIEW_SIZE - MARGIN`) actually engages, rather than the popover
 * simply having room to sit below the anchor unclamped (every test above
 * this one never gets close enough to the edge to exercise that branch).
 * This is exactly the case review round 1 flagged: MOVE_PREVIEW_SIZE (168)
 * didn't match `.move-preview`'s real rendered footprint (168 content +
 * 12 padding + 2 border = 182, `box-sizing` was content-box, no global
 * border-box reset in this codebase) — so the clamp let the box land up to
 * 14px past the viewport edge. Confirmed red against the pre-fix CSS
 * (`box-sizing` removed from `.move-preview`): this test failed with
 * `box.y + box.height` (~507.6) > viewport height (500); every other test in
 * this file still passed, since none of them pin the anchor to the true
 * edge. Green again with `box-sizing: border-box` restored.
 */
test('the preview never overflows a short viewport, even at the very bottom of a long move list', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 500 })

  // 30 plies of ordinary, always-progressing development (mirrored King's
  // Indian-ish setup, captures included) — comfortably enough rows to
  // overflow the move list's own 420px max-height and force internal
  // scrolling. Deliberately NOT a repeated shuffle: importPgn replays each
  // move through our own Position (game-core/position.ts), which refuses
  // to play into a position it considers game-over — including a
  // threefold-repeated one — so a naive back-and-forth knight shuffle
  // stops importing partway through even though chess.js's own PGN parser
  // accepts it fine. Verified legal end-to-end with chess.js directly
  // before use.
  const moves =
    '1. g3 g6 2. Bg2 Bg7 3. Nf3 Nf6 4. O-O O-O 5. d3 d6 6. c4 c5 7. Nc3 Nc6 ' +
    '8. a3 a6 9. Rb1 Rb8 10. b4 b5 11. cxb5 axb5 12. bxc5 dxc5 13. Bb2 Bb7 ' +
    '14. Qc2 Qc7 15. Rfd1 Rfd8'

  await page.getByTestId('import-text').fill(moves)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-error')).toHaveText('')

  await page.getByTestId('tab-moves').click()
  const lastMove = page.getByTestId('move-29') // ply 29: move 15's white Rfd1
  // Pin the anchor's bottom to the viewport's bottom edge — the tightest
  // case the clamp exists for, and the one nothing above this test reaches.
  await lastMove.evaluate((el) => el.scrollIntoView({ block: 'end' }))
  await lastMove.hover()

  const box = (await page.getByTestId('move-preview').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(500)
  expect(box.y + box.height).toBeLessThanOrEqual(500)
})
