import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 4: a pulsing red glow on the king in check, held (not pulsing) and
 * paired with a one-off board shake on checkmate — and neither the pulse
 * nor the shake stop the plain, flat indicator that already existed. No
 * assertion here depends on catching a mid-animation frame: every check is
 * either a class/attribute (present/absent), or a computed `animationName`
 * (which CSS keyframes are wired up — not what frame they are on).
 */

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

async function twoPlayer(page: Page): Promise<void> {
  await coachOffline(page)
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
})

// Red if the check indicator stops pulsing (reverts to the old flat tint)
// or starts holding/shaking on a plain check that is not mate.
test('a plain check pulses the king square and does not shake the board', async ({ page }) => {
  await twoPlayer(page)
  // White king on e1, in check from the rook on e8 (RULE_FIXTURES.castlingWhileInCheck).
  await page.getByTestId('import-text').fill('4r2k/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQ - 0 1')
  await page.getByTestId('import-submit').click()

  const king = page.locator('[data-square="e1"]')
  await expect(king).toHaveClass(/check/)
  await expect(king).not.toHaveClass(/mated/)
  await expect(page.locator('.board')).not.toHaveClass(/checkmate-shake/)

  const animationName = await king.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName).toBe('check-pulse')
})

// Red if checkmate stops marking the mated king, stops shaking the board,
// or leaves the glow pulsing instead of holding once the game is over.
test('checkmate holds the glow and shakes the board once', async ({ page }) => {
  await twoPlayer(page)
  for (const [from, to] of [
    ['e2', 'e4'], ['e7', 'e5'],
    ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'],
    ['h5', 'f7'],
  ] as const) {
    await move(page, from, to)
  }
  await expect(page.getByTestId('result')).toHaveText(/checkmate/i)

  const king = page.locator('[data-square="e8"]')
  await expect(king).toHaveClass(/check/)
  await expect(king).toHaveClass(/mated/)
  await expect(page.locator('.board')).toHaveClass(/checkmate-shake/)

  const animationName = await king.evaluate((el) => getComputedStyle(el).animationName)
  expect(animationName).toBe('none')
})

// Red if stalemate (or any other draw) is wrongly treated as check/checkmate.
test('stalemate never shows a check glow or a shake', async ({ page }) => {
  await twoPlayer(page)
  // Black to move, stalemated (RULE_FIXTURES.stalemate).
  await page.getByTestId('import-text').fill('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toHaveText(/stalemate/i)

  await expect(page.locator('.square.check')).toHaveCount(0)
  await expect(page.locator('.board')).not.toHaveClass(/checkmate-shake/)
})

// Red if `prefers-reduced-motion: reduce` stops suppressing either
// animation — the check glow must fall back to the original static
// indicator, and the board must never shake.
test('reduced motion drops the pulse and the shake, leaving the static indicator', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await twoPlayer(page)
  for (const [from, to] of [
    ['e2', 'e4'], ['e7', 'e5'],
    ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'],
    ['h5', 'f7'],
  ] as const) {
    await move(page, from, to)
  }
  await expect(page.getByTestId('result')).toHaveText(/checkmate/i)

  const king = page.locator('[data-square="e8"]')
  await expect(king).toHaveClass(/check/)
  const style = await king.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { animationName: cs.animationName, backgroundImage: cs.backgroundImage }
  })
  expect(style.animationName).toBe('none')
  // The static indicator itself is still there — just not animated.
  expect(style.backgroundImage).toContain('gradient')

  const boardAnimation = await page.locator('.board').evaluate((el) => getComputedStyle(el).animationName)
  expect(boardAnimation).toBe('none')
})
