import type { Page } from '@playwright/test'

/** One-player game, human White, at the given level. */
export async function startOnePlayer(page: Page, level = '1'): Promise<void> {
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption(level)
  await page.getByTestId('color').selectOption('white')
  await page.getByTestId('new-game').click()
}

/** Make every /api call fail at the network level: the coaching server is "down". */
export async function coachOffline(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => route.abort())
}
