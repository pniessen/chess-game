import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('a piece set change updates the board pieces and persists', async ({ page }) => {
  await page.goto('/')
  const e1King = page.locator('[data-square="e1"] [data-piece="wK"]')
  await expect(e1King).toHaveAttribute('src', '/pieces/rhosgfx/wK.svg')

  await page.getByTestId('piece-set').selectOption('cburnett')
  await expect(e1King).toHaveAttribute('src', '/pieces/cburnett/wK.svg')

  await page.reload()
  await expect(page.getByTestId('piece-set')).toHaveValue('cburnett')
  await expect(page.locator('[data-square="e1"] [data-piece="wK"]')).toHaveAttribute(
    'src',
    '/pieces/cburnett/wK.svg',
  )
})

test('the promotion picker uses the chosen piece set', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('piece-set').selectOption('cburnett')

  // A White pawn one step from promotion, kings placed so the position is legal.
  await page.getByTestId('import-text').fill('8/P7/8/8/8/8/8/K6k w - - 0 1')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-error')).toHaveText('')

  await page.locator('[data-square="a7"]').click()
  await page.locator('[data-square="a8"]').click()

  const dialog = page.getByRole('dialog', { name: /choose a promotion piece/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Queen' }).locator('img')).toHaveAttribute(
    'src',
    '/pieces/cburnett/wQ.svg',
  )
  await expect(dialog.getByRole('button', { name: 'Knight' }).locator('img')).toHaveAttribute(
    'src',
    '/pieces/cburnett/wN.svg',
  )
})

test('the captured-pieces tray uses the chosen piece set', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('piece-set').selectOption('cburnett')

  // 1. e4 d5 2. exd5 - White's pawn captures Black's, so a black pawn
  // appears in White's ("captured-by-white") tray.
  await page.getByTestId('import-text').fill('1. e4 d5 2. exd5')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-error')).toHaveText('')

  const tray = page.getByTestId('captured-by-white')
  await expect(tray.locator('[data-piece="bP"]')).toHaveAttribute('src', '/pieces/cburnett/bP.svg')
})
