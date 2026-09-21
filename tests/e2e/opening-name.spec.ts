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

test('the opening is named as you play, and keeps its name after leaving theory', async ({ page }) => {
  const opening = page.getByTestId('opening')
  await play(page, [['e2', 'e4'], ['c7', 'c5']])
  await expect(opening).toHaveText('B20 Sicilian Defense')
  await play(page, [['g1', 'f3'], ['d7', 'd6'], ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['g8', 'f6'], ['b1', 'c3'], ['a7', 'a6']])
  await expect(opening).toContainText('Sicilian Defense: Najdorf Variation')
  // Browsing back re-names the displayed position.
  await page.getByTestId('move-2').click()
  await expect(opening).toHaveText('B20 Sicilian Defense')
})

test('a transposed move order reaches the same name', async ({ page }) => {
  await play(page, [
    ['e2', 'e4'], ['c7', 'c5'], ['b1', 'c3'], ['d7', 'd6'], ['g1', 'f3'], ['g8', 'f6'],
    ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['a7', 'a6'],
  ])
  await expect(page.getByTestId('opening')).toContainText('Sicilian Defense: Najdorf Variation')
})
