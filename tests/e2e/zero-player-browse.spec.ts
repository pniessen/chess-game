import { expect, test } from '@playwright/test'

test('zero-player: pause, browse an earlier move, resume — play continues', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('zero-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()
  await page.getByTestId('speed').fill('0')

  const plies = page.getByTestId('ply-count')
  await expect(plies).toHaveText(/^([4-9]|\d\d+)$/, { timeout: 45_000 })

  await page.getByTestId('pause').click()
  await expect(page.getByTestId('pause')).toHaveText('Resume')
  const atPause = Number(await plies.textContent())

  // Browse to an early position (Black to move after 1. ...).
  await page.getByTestId('move-1').click()
  await expect(page.getByTestId('turn')).toContainText(/black/i)

  await page.getByTestId('pause').click() // Resume
  await expect(page.getByTestId('pause')).toHaveText('Pause')

  // It must keep playing from the LIVE position...
  await expect
    .poll(async () => Number(await plies.textContent()), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(atPause + 2)
  // ...and must not have halted.
  await expect(page.getByTestId('result')).not.toContainText(/engine error/i)
})
