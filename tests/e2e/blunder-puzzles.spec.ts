import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openPuzzles, servePuzzles } from './helpers'

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

// Breaks if saved blunders never reach the puzzle screen, or show the wrong side/origin.
test('the saved blunder appears in My mistakes with its origin; Show solution plays it; rating untouched', async ({ page }) => {
  await servePuzzles(page)
  await playScholarsMateAndReview(page)
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  const item = page.getByTestId('mistake-item').filter({ hasText: '3... Nf6' })
  await expect(item).toHaveCount(1)
  await item.getByRole('button').click()
  await expect(page.getByTestId('puzzle-origin')).toContainText('you played 3... Nf6??')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('Black to move')
  await expect(page.locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
  await expect(page.getByTestId('puzzle-unrated')).toContainText('(1200)')
  await page.getByTestId('puzzle-solution').click()
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solution shown.')
  await expect(page.getByTestId('puzzle-unrated')).toContainText('(1200)')
})

const SEEDED = {
  v: 1,
  puzzles: [
    {
      id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
      fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
      solution: 'd1d8',
      bestSan: 'Qd8#',
      blunderLabel: '25. h3',
      solver: 'w',
      gameId: 'g1',
      gameDate: '2026-09-20T10:00:00.000Z',
      opening: null,
      createdAt: '2026-09-20T10:05:00.000Z',
      solved: false,
    },
  ],
}

/**
 * Seeded rather than driven: solving needs the engine's exact best move,
 * which a real review may pick differently between Stockfish builds; the
 * driven path to the store is covered by the tests above.
 */
test('a solved mistake is marked solved, the rating is untouched, and it stays solved after a reload', async ({ page }) => {
  await page.addInitScript(
    ({ k, v }) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    },
    { k: KEY, v: JSON.stringify(SEEDED) },
  )
  await servePuzzles(page)
  await page.reload()
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  await expect(page.getByTestId('puzzle-origin')).toContainText('you played 25. h3??')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('White to move')
  await page.locator('[data-square="a1"]').click()
  await page.locator('[data-square="a8"]').click() // Ra8# also mates
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('mistake-solved')).toHaveCount(1)
  // No stats record at all is also "untouched": it exists only if the rated
  // source drew a puzzle (marking it seen) before we switched to My mistakes.
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('chess-game:puzzles') ?? 'null'))
  expect({ rating: stats?.rating ?? 1200, games: stats?.games ?? 0 }).toEqual({ rating: 1200, games: 0 })

  await page.reload()
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  await expect(page.getByTestId('mistake-solved')).toHaveCount(1)
})

// Regression guard (Task 4 review fix): PuzzleScreen used to build its own
// Highlights inline, duplicating — and, on checkmate, losing — the
// `status.kind === 'in-progress'` gate that src/ui/app/highlights.ts also
// had. Solving this same mate-in-1 (Ra8#, mating the black king on g8) used
// to leave it with no check glow at all.
//
// Final-review fix: most puzzles ARE solved by delivering mate, so
// `checkmate` (from the shared highlightsFor) and `celebrate` (set by
// PuzzleScreen on `phase === 'solved'`) are both true here — the board
// used to play `checkmate-shake` AND `celebrate-solved` at once, two
// concurrent transforms for what is a win, not a loss. The check glow and
// `mated` square styling stay; only the shake is suppressed in favour of
// the celebration ring.
test('solving a mate-in-1 puzzle holds the check glow on the mated king and celebrates, without also shaking', async ({ page }) => {
  await page.addInitScript(
    ({ k, v }) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    },
    { k: KEY, v: JSON.stringify(SEEDED) },
  )
  await servePuzzles(page)
  await page.reload()
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  await page.locator('[data-square="a1"]').click()
  await page.locator('[data-square="a8"]').click() // Ra8#
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')

  const king = page.locator('[data-square="g8"]')
  await expect(king).toHaveClass(/check/)
  await expect(king).toHaveClass(/mated/)
  await expect(page.locator('.board')).toHaveClass(/celebrate-solved/)
  await expect(page.locator('.board')).not.toHaveClass(/checkmate-shake/)
})
