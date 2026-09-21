import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

const NAJDORF = 'B90 Sicilian Defense: Najdorf Variation'

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('search, pick, and start a two-player game from an opening', async ({ page }) => {
  await page.getByTestId('tab-explorer').click()
  await page.getByTestId('explorer-search').fill('Najdorf')
  await page.getByTestId('explorer-results').getByRole('button', { name: NAJDORF, exact: true }).click()
  await expect(page.getByTestId('explorer-detail')).toContainText(
    '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6',
  )
  await page.getByTestId('explorer-start').click()

  await expect(page.getByTestId('ply-count')).toHaveText('10')
  await expect(page.getByTestId('opening')).toContainText('Najdorf Variation')
  await expect(page.getByTestId('tab-moves')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('turn')).toContainText(/white/i)
  // A live game: play 6.Be3.
  await page.locator('[data-square="c1"]').click()
  await page.locator('[data-square="e3"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('11')
})

test('in one-player mode as Black, the engine continues the opening', async ({ page }) => {
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('color').selectOption('black')
  await page.getByTestId('tab-explorer').click()
  await page.getByTestId('explorer-search').fill('Najdorf')
  await page.getByTestId('explorer-results').getByRole('button', { name: NAJDORF, exact: true }).click()
  await page.getByTestId('explorer-start').click()
  await expect(page.getByTestId('ply-count')).toHaveText('11', { timeout: 30_000 })
  await expect(page.getByTestId('turn')).toContainText(/black/i)
})
