import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('arrow keys and End move focus and selection across the tab group', async ({ page }) => {
  const movesTab = page.getByTestId('tab-moves')
  const explorerTab = page.getByTestId('tab-explorer')
  const historyTab = page.getByTestId('tab-history')

  await movesTab.focus()
  await expect(movesTab).toBeFocused()
  await expect(movesTab).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('ArrowRight')
  await expect(explorerTab).toBeFocused()
  await expect(explorerTab).toHaveAttribute('aria-selected', 'true')
  await expect(movesTab).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('#panel-explorer')).toBeVisible()
  await expect(page.locator('#panel-moves')).toBeHidden()

  await page.keyboard.press('End')
  await expect(historyTab).toBeFocused()
  await expect(historyTab).toHaveAttribute('aria-selected', 'true')
  await expect(explorerTab).toHaveAttribute('aria-selected', 'false')
  await expect(page.locator('#panel-history')).toBeVisible()
  await expect(page.locator('#panel-explorer')).toBeHidden()
})
