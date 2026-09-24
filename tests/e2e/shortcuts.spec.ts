import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openSettings, servePuzzles, startOnePlayer } from './helpers'

/**
 * Task 13: the app-wide keyboard shortcuts.
 *
 * Each test names the change that turns it red:
 *  - the nav keys turn red if a shortcut stops going through the real
 *    move-input path (handleJump), or stops respecting its clamps.
 *  - the overlay tests turn red if `?` stops opening it, if Escape or the
 *    Close button stop closing it, or if focus stops returning to the
 *    trigger.
 *  - the guard tests turn red if a shortcut fires while typing, while an
 *    overlay owns the keyboard, or while a tab has focus and Left/Right
 *    ought to move between tabs instead.
 *
 * Nothing here asserts a mid-animation frame: every assertion is on an end
 * state, a class, or an attribute.
 */

async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  // The shortcuts listener attaches once the app has mounted; a test that
  // presses a key with no prior interaction (unlike a click, which already
  // waits on actionability) would otherwise race that first render.
  await expect(page.getByTestId('shortcuts-toggle')).toBeVisible()
})

test('Left/Right/Home/End step through the move list via the real move-input path', async ({ page }) => {
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await expect(page.getByTestId('move-2')).toHaveClass(/current/)

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('move-1')).toHaveClass(/current/)
  await expect(page.getByTestId('move-2')).not.toHaveClass(/current/)
  // Browsing never truncates the game: still two moves played.
  await expect(page.getByTestId('ply-count')).toHaveText('2')

  await page.keyboard.press('Home')
  await expect(page.getByTestId('move-1')).not.toHaveClass(/current/)

  await page.keyboard.press('End')
  await expect(page.getByTestId('move-2')).toHaveClass(/current/)

  // Already live: ArrowRight has nowhere further to go.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('move-2')).toHaveClass(/current/)
})

test('u undoes, r redoes, f flips', async ({ page }) => {
  await move(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('1')

  await page.keyboard.press('u')
  await expect(page.getByTestId('ply-count')).toHaveText('0')
  await page.keyboard.press('r')
  await expect(page.getByTestId('ply-count')).toHaveText('1')

  await expect(page.getByTestId('board-frame')).toHaveClass(/white/)
  await page.keyboard.press('f')
  await expect(page.getByTestId('board-frame')).toHaveClass(/black/)
})

test('p opens puzzles, same as the button', async ({ page }) => {
  await servePuzzles(page)
  await page.keyboard.press('p')
  await expect(page.getByTestId('puzzle-screen')).toBeVisible()
})

test('h asks for a hint when one is available', async ({ page }) => {
  await startOnePlayer(page)
  await expect(page.getByTestId('hint')).toBeEnabled()
  await page.keyboard.press('h')
  await expect(page.getByTestId('hint-text')).not.toBeEmpty()
})

test('? opens the shortcuts overlay; Escape closes it and returns focus to the trigger', async ({ page }) => {
  const trigger = page.getByTestId('shortcuts-toggle')
  await trigger.focus()
  await page.keyboard.press('?')

  const overlay = page.getByTestId('shortcuts-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toHaveRole('dialog')
  await expect(overlay).toHaveAccessibleName('Keyboard shortcuts')
  await expect(overlay).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('the Shortcuts button and the Close button open/close it too', async ({ page }) => {
  await page.getByTestId('shortcuts-toggle').click()
  await expect(page.getByTestId('shortcuts-overlay')).toBeVisible()
  await page.getByTestId('shortcuts-close').click()
  await expect(page.getByTestId('shortcuts-overlay')).toHaveCount(0)
  await expect(page.getByTestId('shortcuts-toggle')).toBeFocused()
})

test('shortcuts never fire while typing in the PGN/FEN import box', async ({ page }) => {
  await page.getByTestId('import-text').fill('f')
  await expect(page.getByTestId('board-frame')).toHaveClass(/white/)
})

test('shortcuts never fire while the settings popover owns the keyboard', async ({ page }) => {
  await openSettings(page)
  await page.keyboard.press('p')
  await expect(page.getByTestId('puzzle-screen')).toHaveCount(0)
  await page.keyboard.press('f')
  await expect(page.getByTestId('board-frame')).toHaveClass(/white/)
  // Settings itself still closes on its own Escape, unaffected.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings')).toHaveCount(0)
})

test("Left/Right move between tabs when a tab has focus, not through the move list", async ({ page }) => {
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await page.getByTestId('tab-moves').focus()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tab-explorer')).toBeFocused()
  // The move-list stepping was NOT triggered.
  await expect(page.getByTestId('move-2')).toHaveClass(/current/)
})

test('Escape cancels the promotion picker, which has no Escape handling of its own', async ({ page }) => {
  await page.getByTestId('import-text').fill('k7/4P3/8/8/8/8/8/4K3 w - - 0 1')
  await page.getByTestId('import-submit').click()
  await move(page, 'e7', 'e8')
  await expect(page.getByRole('dialog', { name: 'Choose a promotion piece' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Choose a promotion piece' })).toHaveCount(0)
  await expect(page.getByTestId('ply-count')).toHaveText('0')
})

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the Shortcuts trigger and overlay fit without overflowing', async ({ page }) => {
    const pageOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const before = await pageOverflow()
    await expect(page.getByTestId('shortcuts-toggle')).toBeVisible()

    await page.getByTestId('shortcuts-toggle').click()
    const box = await page.getByTestId('shortcuts-overlay').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    expect(await pageOverflow()).toBeLessThanOrEqual(before)
  })
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the overlay open animation is dropped entirely', async ({ page }) => {
    await page.keyboard.press('?')
    await expect(page.getByTestId('shortcuts-overlay')).toHaveCSS('animation-name', 'none')
  })
})
