import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('engine vs engine runs, pauses, and steps', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('zero-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()

  // The speed slider reflects the running match's own state and is disabled
  // until a game is actually in progress (phase 'idle'), so it can only be
  // set after New game starts the match, not before.
  await page.getByTestId('speed').fill('0')

  const plies = page.getByTestId('ply-count')

  // It should play on its own.
  await expect(plies).toHaveText(/[6-9]|\d\d/, { timeout: 45_000 })

  await page.getByTestId('pause').click()
  const atPause = await plies.textContent()

  // Paused means paused: the count must not move.
  await page.waitForTimeout(2_000)
  await expect(plies).toHaveText(atPause ?? '')

  // One step is exactly one move.
  await page.getByTestId('step').click()
  await expect(plies).toHaveText(String(Number(atPause) + 1), { timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await expect(plies).toHaveText(String(Number(atPause) + 1))
})
