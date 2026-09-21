import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

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

test('a finished game is kept across reloads, gains accuracy when reviewed, and replays', async ({ page }) => {
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-empty')).toBeVisible()

  await play(page, [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']])
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  const entries = page.getByTestId('history-entry')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('1-0')
  await expect(entries.first()).toContainText('not reviewed')

  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('tab-history').click()
  await expect(entries.first()).toContainText('Accuracy')

  await page.reload()
  await page.getByTestId('tab-history').click()
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('Accuracy')

  await entries.first().getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('ply-count')).toHaveText('7')
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await expect(page.getByTestId('tab-moves')).toHaveAttribute('aria-selected', 'true')
  // Replaying does not add a second entry.
  await page.getByTestId('tab-history').click()
  await expect(entries).toHaveCount(1)
})

test('a resigned game replays as a resignation', async ({ page }) => {
  await play(page, [['e2', 'e4']])
  await page.getByTestId('resign').click() // Black (to move) resigns
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-entry').first()).toContainText('1-0')
  await page.getByTestId('history-entry').first().getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('result')).toContainText('Black resigns')
})
