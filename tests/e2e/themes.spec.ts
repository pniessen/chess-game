import { expect, test } from '@playwright/test'
import { coachOffline, openSettings, withSettings } from './helpers'

// Task 12 changed the selector here: the board theme is no longer a
// <select> but a grid of preview tiles (each a radio) inside the settings
// popover, so the spec opens the popover and checks a tile. What it
// asserts — the squares recolour, and the choice survives a reload — is
// unchanged.
test('a board theme recolours the squares and persists', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  const a1 = page.locator('[data-square="a1"]') // a dark square
  const h1 = page.locator('[data-square="h1"]') // a light square
  await expect(a1).toHaveCSS('background-color', 'rgb(181, 136, 99)')

  await withSettings(page, async () => {
    await page.getByTestId('board-theme-green').check()
  })
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
  await expect(h1).toHaveCSS('background-color', 'rgb(238, 238, 210)')

  await page.reload()
  await openSettings(page)
  await expect(page.getByTestId('board-theme-green')).toBeChecked()
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
})
