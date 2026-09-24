import { expect, test, type Page } from '@playwright/test'
import { coachOffline, coachOnline, pinRandom, startOnePlayer } from './helpers'

const SCHOLAR = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'
/**
 * A 100-ply (seeded random, legal) game, resigned after import: long enough
 * that its review is still running when the test clicks Cancel / New game.
 */
const LONG_GAME =
  'f4 a5 e4 a4 Ke2 d6 Qe1 h5 f5 a3 c3 Nc6 Nh3 Ra7 bxa3 Bd7 e5 g6 Qd1 Na5 g4 Qa8 Kf3 Bc8 a4 Nc4 f6 Na5 gxh5 Qb8 ' +
  'Qb3 exf6 Bd3 fxe5 Na3 f6 hxg6 Bh6 Qb5+ Kd8 Nc4 Ne7 Ng1 Ra8 h4 Nf5 Qd5 c6 Be2 Re8 Qb5 Ne7 Kg3 Rf8 Bf3 Nf5+ ' +
  'Kh3 Bg7 Qb2 Qc7 a3 Qe7 Kg4 Rh8 Qb3 Ra6 d4 Rh5 Ne3 Nxd4+ Qe6 Nab3 Nh3 Qd7 Bd5 Ra5 Ng5 Rh8 Bxb3 Rf8 Ng2 Kc7 ' +
  'Kg3 Rxa4 Rb1 Bh8 Nf3 c5 Qxd6+ Kd8 Bf4 Qxd6 Kh2 Bf5 Ra1 Bb1 Ba2 Re8 Raxb1 Qc7'

async function importFinished(page: Page, pgn: string) {
  await page.getByTestId('import-text').fill(pgn)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
}

async function importLongAndResign(page: Page) {
  await page.getByTestId('import-text').fill(LONG_GAME)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('ply-count')).toHaveText('100')
  await page.getByTestId('resign').click()
  await expect(page.getByTestId('result')).toContainText(/resigns/i)
}

async function reviewNow(page: Page) {
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  // The source line appears only once the summary text is in (analysis + summary done).
  await expect(page.getByTestId('review-summary-source')).toBeVisible({ timeout: 60_000 })
}

async function clickMove(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

/**
 * One-player, human White, level 1: after 1.e4, the engine must reply
 * promptly. The page must be pinned with pinRandom(page, 0.99) first: at
 * level 1 that is >= bookChance (0.9) and >= blunderChance, so the reply is
 * a real Stockfish search through the worker the review was using — never
 * an instant book move that would pass without touching the engine.
 */
async function engineRepliesPromptly(page: Page) {
  await startOnePlayer(page, '1')
  await clickMove(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 10_000 })
}

test.describe('post-game review (coach offline unless stated)', () => {
  test('marks the blunder, scores accuracy, draws the better move, and summarises (offline)', async ({ page }) => {
    await coachOffline(page)
    await page.goto('/')
    await importFinished(page, SCHOLAR)
    await reviewNow(page)

    await expect(page.getByTestId('review-summary-source')).toHaveText('Built-in summary')
    await expect(page.getByTestId('review-summary')).toContainText('Accuracy: White')
    const w = Number(await page.getByTestId('accuracy-w').textContent())
    const b = Number(await page.getByTestId('accuracy-b').textContent())
    expect(Number.isFinite(w) && Number.isFinite(b)).toBe(true)
    expect(b).toBeLessThan(w)

    await page.getByTestId('tab-moves').click()
    await expect(page.getByTestId('mark-6')).toHaveText('??')

    await page.getByTestId('move-6').click()
    await expect(page.locator('[data-annotation="arrow"][data-tone="best"]')).toHaveCount(1)
    await expect(page.locator('[data-annotation="square"][data-tone="blunder"]')).toHaveAttribute('data-annotation-square', 'f6')
    await page.getByTestId('tab-review').click()
    await expect(page.getByTestId('review-current')).toContainText('3... Nf6?? is a blunder')

    // Browsing elsewhere keeps the review; a non-flagged move shows no arrow.
    await page.getByTestId('tab-moves').click()
    await page.getByTestId('move-1').click()
    await expect(page.locator('[data-annotation="arrow"]')).toHaveCount(0)
    await expect(page.getByTestId('mark-6')).toHaveText('??')
  })

  // Task 10: the whole-game evaluation line. Red if it ever renders before a
  // review exists, if it stops covering one point per ply on a short AND a
  // long game, or if the mate-ending row/marker never show up.
  test('the evaluation line is absent until reviewed, then plots one point per ply with an accessible table', async ({ page }) => {
    await coachOffline(page)
    await page.goto('/')
    await importFinished(page, SCHOLAR)
    await page.getByTestId('tab-review').click()
    // No review yet: the line must not exist at all (not an empty chart).
    await expect(page.getByTestId('eval-line')).toHaveCount(0)

    await reviewNow(page)
    const line = page.getByTestId('eval-line')
    await expect(line).toBeVisible()
    // Decorative chart, real content lives in the caption + table.
    await expect(line.locator('svg')).toHaveAttribute('aria-hidden', 'true')
    await expect(page.getByTestId('eval-line-summary')).toContainText('Ended at 1-0')
    const points = await line.locator('polyline').getAttribute('points')
    expect(points!.trim().split(' ')).toHaveLength(8) // start + 7 plies
    const rows = line.locator('[data-testid="eval-line-table"] tbody tr')
    await expect(rows).toHaveCount(8)
    await expect(rows.last()).toContainText('1-0')
    // The blunder (3...Nf6??) gets a marker dot in the same colour class
    // MoveList's own chip uses.
    await expect(line.locator('circle.mark-blunder')).toHaveCount(1)
  })

  test('a long game’s evaluation line still plots every ply', async ({ page }) => {
    await pinRandom(page, 0.99)
    await coachOffline(page)
    await page.goto('/')
    await importLongAndResign(page)
    await reviewNow(page)
    const points = await page.getByTestId('eval-line').locator('polyline').getAttribute('points')
    expect(points!.trim().split(' ')).toHaveLength(101) // start + 100 plies
  })

  test('with the server up, the summary comes from Claude and carries the flagged moves', async ({ page }) => {
    // A holder object: TS does not see assignments made inside callbacks to a plain `let`.
    const sent: { body: { flagged: Array<{ ply: number; classification: string }> } | null } = { body: null }
    await coachOnline(page, {
      review: async (route) => {
        sent.body = route.request().postDataJSON()
        await route.fulfill({ json: { text: 'MOCK review summary.' } })
      },
    })
    await page.goto('/')
    await importFinished(page, SCHOLAR)
    await reviewNow(page)
    await expect(page.getByTestId('review-summary')).toHaveText('MOCK review summary.')
    await expect(page.getByTestId('review-summary-source')).toHaveText('Summary by Claude')
    expect(sent.body?.flagged).toContainEqual(expect.objectContaining({ ply: 6, classification: 'blunder' }))
  })

  test('undo after a review, then a different move: the old marks and arrows are gone', async ({ page }) => {
    await coachOffline(page)
    await page.goto('/')
    await importFinished(page, SCHOLAR)
    await reviewNow(page)
    await page.getByTestId('tab-moves').click()
    await expect(page.getByTestId('mark-6')).toHaveText('??')

    // Take back 4.Qxf7# and play 4.Qxe5+ instead: plies 1..6 are unchanged,
    // but the move list — and so the game being reviewed — is not.
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('ply-count')).toHaveText('6')
    await clickMove(page, 'h5', 'e5')
    await expect(page.getByTestId('ply-count')).toHaveText('7')

    await expect(page.getByTestId('move-6')).toHaveText('Nf6')
    await expect(page.locator('[data-testid^="mark-"]')).toHaveCount(0)
    await page.getByTestId('move-6').click()
    await expect(page.locator('[data-annotation]')).toHaveCount(0)
    await page.getByTestId('tab-review').click()
    await expect(page.getByTestId('review-start')).toBeDisabled()
    await expect(page.getByTestId('accuracy-w')).toHaveCount(0)
    await expect(page.getByTestId('review-summary')).toHaveCount(0)
  })

  test('cancelling a review frees the engine for the next game', async ({ page }) => {
    await pinRandom(page, 0.99)
    await coachOffline(page)
    await page.goto('/')
    await importLongAndResign(page)
    await page.getByTestId('tab-review').click()
    await page.getByTestId('review-start').click()
    await expect(page.getByTestId('review-progress')).toBeVisible()
    await page.getByTestId('review-cancel').click()
    await expect(page.getByTestId('review-start')).toBeVisible()

    await engineRepliesPromptly(page)
  })

  test('a new game mid-review supersedes it: the review is dropped and the engine replies promptly', async ({ page }) => {
    await pinRandom(page, 0.99)
    await coachOffline(page)
    await page.goto('/')
    await importLongAndResign(page)
    await page.getByTestId('tab-review').click()
    await page.getByTestId('review-start').click()
    await expect(page.getByTestId('review-progress')).toBeVisible()

    await engineRepliesPromptly(page) // no cancel click
    // The old review neither kept running nor finished into the new game.
    await page.getByTestId('tab-review').click()
    await expect(page.getByTestId('review-start')).toBeVisible()
    await expect(page.getByTestId('review-start')).toBeDisabled()
    await expect(page.getByTestId('review-progress')).toHaveCount(0)
    await expect(page.getByTestId('accuracy-w')).toHaveCount(0)
    await expect(page.locator('[data-testid^="mark-"]')).toHaveCount(0)
  })
})
