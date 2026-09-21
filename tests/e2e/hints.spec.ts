import { expect, test } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

test('graded hints: nudge, then the move, then the reasoning; a move clears them', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await startOnePlayer(page)

  const hint = page.getByTestId('hint')
  const text = page.getByTestId('hint-text')
  const highlight = page.locator('[data-annotation="square"][data-tone="hint"]')
  const arrow = page.locator('[data-annotation="arrow"][data-tone="hint"]')

  // 1: the nudge — a highlighted piece and its name, but not the move.
  await hint.click()
  await expect(text).toContainText('Look at your', { timeout: 30_000 })
  await expect(highlight).toHaveCount(1)
  await expect(arrow).toHaveCount(0)
  await expect(hint).toHaveText('Show move')

  // 2: the move — an arrow from the highlighted square.
  await hint.click()
  await expect(arrow).toHaveCount(1)
  const from = await arrow.getAttribute('data-from')
  const to = await arrow.getAttribute('data-to')
  expect(await highlight.getAttribute('data-annotation-square')).toBe(from)
  await expect(text).toContainText('Try ')

  // 3: the reasoning.
  await hint.click()
  await expect(text).not.toContainText('Look at your', { timeout: 30_000 })
  await expect(text).toHaveText(/\S/)
  await expect(hint).toBeDisabled()

  // Play the suggested move by clicking THROUGH the overlay. If the overlay
  // took pointer events, Playwright would refuse: "<svg> intercepts pointer events".
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
  await expect(page.getByTestId('ply-count')).toHaveText(/^[12]$/)
  await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await expect(text).toHaveText('')
})
