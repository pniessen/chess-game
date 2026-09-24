import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 8: move-quality chips in the move list. Same Scholar's mate fixture
 * as review.spec.ts, for the same reason review.spec.ts uses it: 3...Nf6??
 * allows mate in one, so it is a blunder at any search depth — deterministic
 * regardless of Stockfish build (see review.spec.ts's own comment on the
 * same fixture). That is the ONLY per-ply classification this spec
 * hardcodes: REVIEW_BUDGET caps each position's search at a 150ms wall-clock
 * moveTime alongside its depth (run.ts), so which exact move the engine
 * calls "best" for an ordinary developing move — and so whether a move
 * other than 3...Nf6 gets a chip at all — is not guaranteed stable run to
 * run under real scheduling. Everything else here checks structure
 * (presence, persistence, colour-scheme wiring), never a specific ply's
 * classification beyond the one loss-driven, depth-independent blunder.
 */
const SCHOLAR = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'

async function importFinished(page: Page, pgn: string) {
  await page.getByTestId('import-text').fill(pgn)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
}

async function reviewNow(page: Page) {
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('review-summary-source')).toBeVisible({ timeout: 60_000 })
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('chips appear only after a review, with the right classification, colour and swing tooltip', async ({ page }) => {
  await importFinished(page, SCHOLAR)
  await page.getByTestId('tab-moves').click()
  // No review yet: no chips at all.
  await expect(page.locator('[data-testid^="mark-"]')).toHaveCount(0)

  await reviewNow(page)
  await page.getByTestId('tab-moves').click()

  const blunder = page.getByTestId('mark-6') // 3... Nf6
  await expect(blunder).toHaveText('??')
  await expect(blunder).toHaveClass(/mark-blunder/)
  const blunderTitle = await blunder.getAttribute('title')
  expect(blunderTitle).toMatch(/^Blunder \(−\d+% win\)$/) // the eval swing, on hover

  // Not every one of the 7 plies gets a chip — only the ones the review
  // actually flags (or calls the engine's own top choice) do; an "ok" move
  // has no MARK glyph and so renders no chip at all (MoveList.test.tsx
  // covers that exact case with fixed data, deterministically).
  const count = await page.locator('[data-testid^="mark-"]').count()
  expect(count).toBeGreaterThanOrEqual(1)
  expect(count).toBeLessThan(7)
})

test('chips survive clicking through the move list', async ({ page }) => {
  await importFinished(page, SCHOLAR)
  await reviewNow(page)
  await page.getByTestId('tab-moves').click()
  await expect(page.getByTestId('mark-6')).toHaveText('??')

  await page.getByTestId('move-1').click()
  await expect(page.getByTestId('mark-6')).toHaveText('??')
  await page.getByTestId('move-6').click()
  await expect(page.getByTestId('mark-6')).toHaveText('??')
})

// The actual WCAG 4.5:1 math (blending each chip's translucent background
// onto the exact surfaces the move list uses) lives in
// moveMarkContrast.test.ts, computed straight from app.css's own rules —
// that is where "clears AA" is really proven. This is the live-app half of
// the guarantee: the dark-mode colours are real overrides that take effect
// in the running page, not dead CSS nobody reaches (a `data-theme`
// attribute could exist without ever being toggled, or `prefers-color-
// scheme` could fail to match) — and that the chip is genuinely a filled
// pill (a non-transparent background), not the pre-Task-8 plain coloured
// text.
test('the blunder chip actually swaps to its dark-mode colours in the live page', async ({ page }) => {
  await importFinished(page, SCHOLAR)
  await reviewNow(page)
  await page.getByTestId('tab-moves').click()
  const chip = page.getByTestId('mark-6')

  await page.emulateMedia({ colorScheme: 'light' })
  const light = await chip.evaluate((el) => ({
    color: getComputedStyle(el).color,
    bg: getComputedStyle(el).backgroundColor,
  }))
  expect(light.bg).not.toMatch(/rgba?\([^)]*,\s*0\)$/) // an actual filled pill, not transparent

  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = await chip.evaluate((el) => ({
    color: getComputedStyle(el).color,
    bg: getComputedStyle(el).backgroundColor,
  }))
  expect(dark.bg).not.toMatch(/rgba?\([^)]*,\s*0\)$/)
  expect(dark.color).not.toBe(light.color) // the dark override really took effect
})
