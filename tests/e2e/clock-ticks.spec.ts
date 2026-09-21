import { expect, test } from '@playwright/test'

test('a running clock visibly counts down between moves', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('time-control').selectOption('blitz-3-2')
  await page.getByTestId('new-game').click()

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')

  const black = page.getByTestId('clock-b')
  await expect(black).toHaveText(/^(3:00|2:59)$/)

  // Nothing else happens on the page: only the display's own polling can
  // move this text. Over ~2 seconds it must reach 2:58 or lower.
  await expect(black).toHaveText(/^2:(5[0-8]|[0-4]\d)$/, { timeout: 5_000 })

  // White is not running: it keeps whatever it had after 1.e4 (3:00 less
  // the second or so spent moving, plus the 2s increment) and stays there.
  const white = page.getByTestId('clock-w')
  await expect(white).toHaveText(/^3:0[0-2]$/)
  const whiteAfterMove = await white.textContent()
  await page.waitForTimeout(1_500)
  await expect(white).toHaveText(whiteAfterMove ?? '')
})
