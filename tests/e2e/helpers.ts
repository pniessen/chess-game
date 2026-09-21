import type { Page, Route } from '@playwright/test'

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

/** A healthy coach server with Claude configured; hint/review handlers overridable. */
export async function coachOnline(
  page: Page,
  handlers: { hint?: (route: Route) => Promise<void>; review?: (route: Route) => Promise<void> } = {},
): Promise<void> {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  await page.route('**/api/hint', handlers.hint ?? ((r) => r.fulfill({ json: { text: 'MOCK hint reasoning.' } })))
  await page.route('**/api/review', handlers.review ?? ((r) => r.fulfill({ json: { text: 'MOCK review summary.' } })))
}
