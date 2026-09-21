import { expect, test } from '@playwright/test'
import { coachOffline, pinRandom } from './helpers'

const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'

// RED if App never hands the loaded book to the controller (comment out the
// `controller.setBook(book)` effect): the engine searches instead and plays a
// Stockfish move, not the dataset's first continuation from the start position.
test('a level-1 engine opens with a book move (deterministic RNG)', async ({ page }) => {
  await coachOffline(page)
  // Math.random() = 0: "use the book" (0 < 0.9) and continuation index 0, every time.
  await pinRandom(page)
  await page.goto('/')

  const data = (await (await page.request.get('/openings/openings.json')).json()) as {
    positions: Record<string, [number, string[]]>
  }
  const first = data.positions[START_EPD]?.[1][0]
  expect(first).toMatch(/^[a-h][1-8][a-h][1-8]$/)

  // Wait until the app has loaded the book: the explorer lists openings only then.
  await page.getByTestId('tab-explorer').click()
  await expect(page.getByTestId('explorer-results')).toBeVisible()
  await page.getByTestId('tab-moves').click()

  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('color').selectOption('black')
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('ply-count')).toHaveText('1', { timeout: 30_000 })
  await expect(page.locator(`[data-square="${first!.slice(2, 4)}"] [data-piece]`)).toHaveCount(1)
  await expect(page.locator(`[data-square="${first!.slice(0, 2)}"] [data-piece]`)).toHaveCount(0)
})
