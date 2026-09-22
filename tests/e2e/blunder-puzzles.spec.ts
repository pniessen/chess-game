import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

const KEY = 'chess-game:blunder-puzzles'
const BEFORE_NF6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

/**
 * A real two-player Scholar's mate (both sides Human in history), then a
 * real review. Driven, not seeded: 3...Nf6?? allows mate in one, so it is a
 * blunder at any search depth (review.spec relies on the same fact), which
 * keeps this deterministic while exercising the real review -> store path.
 */
async function playScholarsMateAndReview(page: Page) {
  await play(page, [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']])
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
}

const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown, KEY)

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

// Breaks if App stops handing completed reviews to blunderPuzzlesFrom/addBlunderPuzzles.
test('reviewing a finished game saves the human blunder as a puzzle with an engine best move', async ({ page }) => {
  await playScholarsMateAndReview(page)
  await expect
    .poll(() => stored(page))
    .toMatchObject({
      v: 1,
      puzzles: expect.arrayContaining([
        expect.objectContaining({ fen: BEFORE_NF6, blunderLabel: '3... Nf6', solver: 'b', solved: false }),
      ]),
    })
  const data = (await stored(page)) as { puzzles: Array<{ fen: string; solution: string }> }
  const p = data.puzzles.find((x) => x.fen === BEFORE_NF6)
  expect(p?.solution).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/)
  expect(p?.solution).not.toBe('g8f6')
})

// Breaks if imported (non-history) games start producing "my" mistakes.
test('an imported game that is not in history adds no puzzles', async ({ page }) => {
  await page.getByTestId('import-text').fill('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
  expect(await stored(page)).toBeNull()
})
