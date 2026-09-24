import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 11: captured pieces animate into their tray, and the side ahead on
 * material shows a "+N" lead. The lead TEXT and the underlying calculation
 * (material.ts) are untouched — Captured.test.tsx already covers those.
 * This spec covers the presentation wiring: the tray actually reflects a
 * real capture end-to-end, the animation is really applied (and really
 * dropped under reduced motion), and neither is asserted at a mid-flight
 * frame — only computed end-state (`animationName`), per the brief. The
 * animation lives on `.captured-piece` (app.css), the SPAN that wraps each
 * piece — not the `<img data-piece>` inside it — so that's what every
 * assertion below targets.
 */

// 1. e4 d5 2. exd5 — White's pawn captures Black's d-pawn (same fixture
// piece-sets.spec.ts already uses for the same tray).
async function importCapture(page: Page) {
  await page.getByTestId('import-text').fill('1. e4 d5 2. exd5')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-error')).toHaveText('')
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('a capture lands in the tray and the leading side shows a "+N" badge', async ({ page }) => {
  // Nothing captured yet: no `.captured-piece` in either tray ("No captures
  // yet" itself is CSS generated content — ::before — so it's not part of
  // the DOM text; the empty trays are the real, assertable signal).
  await expect(page.getByTestId('captured-by-white').locator('.captured-piece')).toHaveCount(0)
  await expect(page.getByTestId('captured-by-black').locator('.captured-piece')).toHaveCount(0)

  await importCapture(page)

  const whiteTray = page.getByTestId('captured-by-white')
  await expect(whiteTray.locator('.captured-piece')).toHaveCount(1)
  await expect(whiteTray.locator('[data-piece="bP"]')).toBeVisible()
  await expect(page.getByTestId('material-balance')).toHaveText('White +1')
})

test('a captured piece really animates in, and reduced motion really drops it', async ({ page }) => {
  await importCapture(page)
  const piece = page.getByTestId('captured-by-white').locator('.captured-piece')
  await expect(piece).toBeVisible()
  const animationName = await piece.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName).toBe('capture-enter')
})

test('reduced motion: the captured piece is simply present, no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await importCapture(page)
  const piece = page.getByTestId('captured-by-white').locator('.captured-piece')
  await expect(piece).toBeVisible()
  const animationName = await piece.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName).toBe('none')
})

test('the material-lead badge also animates in, and reduced motion drops it too', async ({ page }) => {
  await importCapture(page)
  const badge = page.getByTestId('material-balance')
  await expect(badge).toBeVisible()
  expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe('capture-enter')

  await page.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await importCapture(page)
  expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

test('scrubbing history back past a capture and forward again still shows it correctly, with no console error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await importCapture(page)
  const whiteTray = page.getByTestId('captured-by-white')
  await expect(whiteTray.locator('.captured-piece')).toHaveCount(1)

  await page.getByTestId('tab-moves').click()
  await page.getByTestId('move-1').click() // back to just after 1. e4 — no capture yet
  await expect(whiteTray.locator('.captured-piece')).toHaveCount(0)

  await page.getByTestId('move-3').click() // forward again, past the capture (2. exd5)
  await expect(whiteTray.locator('.captured-piece')).toHaveCount(1)
  await expect(page.getByTestId('material-balance')).toHaveText('White +1')

  expect(errors).toEqual([])
})
