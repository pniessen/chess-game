import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('Scholar’s Mate ends in checkmate', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()

  const moves: Array<[string, string]> = [
    ['e2', 'e4'], ['e7', 'e5'],
    ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'],
    ['h5', 'f7'],
  ]
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }

  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await expect(page.getByTestId('result')).toContainText(/white/i)

  // The board must stop accepting input once the game is over.
  await page.locator('[data-square="e8"]').click()
  await page.locator('[data-square="e7"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('7')
})
