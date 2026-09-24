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
