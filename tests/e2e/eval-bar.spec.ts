import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('the bar finds a mate, flips with the board, scores the result, and can be hidden', async ({ page }) => {
  await page.goto('/')
  // Back-rank mate in one: Rd8#.
  await page.getByTestId('import-text').fill('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')
  await page.getByTestId('import-submit').click()

  const label = page.getByTestId('eval-label')
  await expect(label).toHaveText('M1', { timeout: 30_000 })
  await expect(page.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'white')
  await page.getByTestId('flip').click()
  await expect(page.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'black')

  await page.locator('[data-square="d1"]').click()
  await page.locator('[data-square="d8"]').click()
  await expect(label).toHaveText('1-0')

  await page.getByTestId('eval-toggle').uncheck()
  await expect(page.getByTestId('eval-bar')).toHaveCount(0)
  // The mated position is finished, so there is no resume banner after a reload.
  await page.reload()
  await expect(page.getByTestId('eval-toggle')).not.toBeChecked()
  await expect(page.getByTestId('eval-bar')).toHaveCount(0)
})

test('engine moves are never starved by the bar (zero-player at full speed)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('zero-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()
  await page.getByTestId('speed').fill('0')
  await expect(page.getByTestId('ply-count')).toHaveText(/[6-9]|\d\d/, { timeout: 45_000 })

  // Once the engine is idle, analysis gets its turn.
  await page.getByTestId('pause').click()
  await expect(page.getByTestId('eval-label')).not.toHaveText('…', { timeout: 15_000 })
})

test('one-player: the engine still replies with the bar analysing', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()
  await expect(page.getByTestId('eval-label')).not.toHaveText('…', { timeout: 30_000 })
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
})
