import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('the engine replies to the human’s first move', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()

  // Stockfish must load, think, and answer. Generous timeout for a cold
  // wasm fetch on a slow machine.
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
  await expect(page.getByTestId('turn')).toContainText(/white/i)
})
