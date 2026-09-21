import { expect, test } from '@playwright/test'

test('dragging a pawn onto a promotion square raises the picker', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()

  // A White pawn one step from promotion, kings placed so the position is
  // legal. Drag mechanics, not chess logic, are under test here.
  await page.getByTestId('import-text').fill('8/P7/8/8/8/8/8/K6k w - - 0 1')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('import-error')).toHaveText('')
  await expect(page.locator('[data-square="a7"] [data-piece="wP"]')).toBeVisible()

  const from = page.locator('[data-square="a7"]')
  const to = page.locator('[data-square="a8"]')
  // The board can render below the fold; bring it fully into view first so
  // the bounding boxes below are in on-screen viewport coordinates.
  await from.scrollIntoViewIfNeeded()
  const fromBox = await from.boundingBox()
  const toBox = await to.boundingBox()
  if (!fromBox || !toBox) throw new Error('Could not locate a7/a8 on the board')

  const fromCenter = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 }
  const toCenter = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 }

  // A real pointer sequence with intermediate moves, so the drag threshold
  // (6px) is clearly exceeded before the pointer reaches a8.
  await page.mouse.move(fromCenter.x, fromCenter.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(
      fromCenter.x + (toCenter.x - fromCenter.x) * t,
      fromCenter.y + (toCenter.y - fromCenter.y) * t,
    )
  }
  await page.mouse.up()

  const dialog = page.getByRole('dialog', { name: /choose a promotion piece/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Queen' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Rook' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Bishop' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Knight' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Knight' }).click()

  await expect(page.locator('[data-square="a8"] [data-piece="wN"]')).toBeVisible()
})
