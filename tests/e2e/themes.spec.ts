import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test('a board theme recolours the squares and persists', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  const a1 = page.locator('[data-square="a1"]') // a dark square
  const h1 = page.locator('[data-square="h1"]') // a light square
  await expect(a1).toHaveCSS('background-color', 'rgb(181, 136, 99)')

  await page.getByTestId('board-theme').selectOption('green')
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
  await expect(h1).toHaveCSS('background-color', 'rgb(238, 238, 210)')

  await page.reload()
  await expect(page.getByTestId('board-theme')).toHaveValue('green')
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
})
