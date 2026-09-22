import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openPuzzles, pinRandom, servePuzzles } from './helpers'

/**
 * Fixture (tests/fixtures/puzzles.ts): 0000D (1468, solver Black) then
 * T0001 (1500, solver White, Qd8# or Ra8#). With Math.random pinned to 0 and
 * a fresh 1200 rating, both fall in the ±400 window and the first in data
 * order — 0000D — is drawn first; Next then gives T0001.
 * Expected ratings (K = 40): 1200 vs 1468 win -> 1233, loss -> 1193;
 * 1200 vs 1500 loss -> 1194.
 */
async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}
const piece = (page: Page, sq: string) => page.locator(`[data-square="${sq}"] [data-piece]`)
const seconds = (t: string | null) => {
  const [m, s] = (t ?? '0:0').split(':').map(Number)
  return (m ?? 0) * 60 + (s ?? 0)
}

test.beforeEach(async ({ page }) => {
  await pinRandom(page, 0)
  await coachOffline(page)
  await servePuzzles(page)
  await page.goto('/')
})

// Breaks if the setup move, the opponent's reply or the rating update stops happening.
test('solve a rated puzzle: setup plays itself, the opponent replies, the rating rises and persists', async ({ page }) => {
  await openPuzzles(page)
  await expect(page.getByTestId('puzzle-id')).toHaveText('0000D')
  await expect(page.getByTestId('puzzle-rating')).toHaveText('1468')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1200')
  await expect(page.getByTestId('puzzle-themes')).toHaveText('Advantage, Endgame, Short')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('Black to move')
  await expect(page.locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')

  await expect(piece(page, 'd6')).toHaveAttribute('data-piece', 'wQ')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for Black.')
  await move(page, 'f8', 'd8')
  await expect(piece(page, 'd8')).toHaveAttribute('data-piece', 'wQ')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1233')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(+33)')

  await page.reload()
  await openPuzzles(page)
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1233')
  await expect(page.getByTestId('puzzle-id')).toHaveText('T0001') // 0000D was seen
})

// Breaks if a wrong move is free, hidden, or refunded by a retry.
test('a wrong move fails the puzzle and drops the rating; retry does not refund it', async ({ page }) => {
  await openPuzzles(page)
  await expect(piece(page, 'd6')).toHaveAttribute('data-piece', 'wQ')
  await move(page, 'b6', 'c7')
  await expect(page.getByTestId('puzzle-status')).toHaveText("That's not it. Retry, or show the solution.")
  await expect(page.locator('[data-annotation="square"][data-tone="blunder"]')).toHaveAttribute('data-annotation-square', 'c7')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1193')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(-7)')

  await page.getByTestId('puzzle-retry').click()
  await expect(piece(page, 'b6')).toHaveAttribute('data-piece', 'bQ')
  await move(page, 'f8', 'd8')
  await expect(piece(page, 'd8')).toHaveAttribute('data-piece', 'wQ')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1193')
})

// Breaks if the hint overlay is not reused, the hint is free, or an alternative mate is rejected.
test('hint highlights the piece, then the move, and costs the rated result; any mate solves', async ({ page }) => {
  await openPuzzles(page)
  await page.getByTestId('puzzle-next').click()
  await expect(page.getByTestId('puzzle-id')).toHaveText('T0001')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1200') // skipping is free
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('White to move')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for White.')

  await page.getByTestId('puzzle-hint').click()
  await expect(page.locator('[data-annotation="square"][data-tone="hint"]')).toHaveAttribute('data-annotation-square', 'd1')
  await expect(page.getByTestId('puzzle-hint-text')).toHaveText('Look at your queen.')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1194')
  await expect(page.getByTestId('puzzle-hint')).toHaveText('Show move')
  await page.getByTestId('puzzle-hint').click()
  await expect(page.locator('[data-annotation="arrow"][data-tone="hint"]')).toHaveCount(1)
  await expect(page.getByTestId('puzzle-hint')).toBeDisabled()

  await move(page, 'a1', 'a8') // Ra8# — not the listed Qd8#
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1194')
})

// Breaks if puzzle mode loses the game or lets its clock run.
test('exit returns to the preserved game; its clock did not run meanwhile, and play continues', async ({ page }) => {
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('time-control').selectOption('blitz-3-2')
  await page.getByTestId('new-game').click()
  await move(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('1')
  const black = page.getByTestId('clock-b')
  await expect(black).toHaveText(/^(3:00|2:5\d)$/)
  const before = seconds(await black.textContent())

  await openPuzzles(page)
  await page.waitForTimeout(3_000)
  await page.getByTestId('puzzle-exit').click()

  await expect(page.getByTestId('ply-count')).toHaveText('1')
  await expect(piece(page, 'e4')).toHaveAttribute('data-piece', 'wP')
  await expect(page.getByTestId('turn')).toHaveText('Black to move')
  const resumedAt = await black.textContent()
  expect(before - seconds(resumedAt)).toBeLessThanOrEqual(1)
  await expect(black).not.toHaveText(resumedAt ?? '', { timeout: 5_000 }) // running again
  await move(page, 'e7', 'e5')
  await expect(page.getByTestId('ply-count')).toHaveText('2')
})

// Breaks if a failed puzzles.json takes anything down with it.
test('a puzzle set that fails to load shows a clear message and leaves the game alone', async ({ page }) => {
  await page.unroute('**/puzzles/puzzles.json')
  await page.route('**/puzzles/puzzles.json', (r) => r.fulfill({ status: 404, body: 'missing' }))
  await openPuzzles(page)
  await expect(page.getByTestId('puzzle-load-error')).toContainText('could not be loaded')
  await page.getByTestId('puzzle-exit').click()
  await move(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})
