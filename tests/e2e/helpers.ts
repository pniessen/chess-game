import { expect, type Page, type Route } from '@playwright/test'
import { PUZZLE_FIXTURE } from '../fixtures/puzzles'

/** One-player game, human White, at the given level. */
export async function startOnePlayer(page: Page, level = '1'): Promise<void> {
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption(level)
  await page.getByTestId('color').selectOption('white')
  await page.getByTestId('new-game').click()
}

/**
 * Task 12: settings moved from an always-open card under the board into a
 * popover on the status row, so a spec that changes a setting has to open
 * it first. `openSettings` leaves it open; `withSettings` opens it, runs
 * the assertions/clicks, and closes it again with Escape.
 */
export async function openSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-toggle').click()
  await expect(page.getByTestId('settings')).toBeVisible()
}

export async function withSettings(page: Page, body: () => Promise<void>): Promise<void> {
  await openSettings(page)
  await body()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings')).toHaveCount(0)
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

/**
 * Pin `Math.random()` to a constant on every future navigation, so the
 * controller's book and blunder draws (both seeded from `Math.random` by
 * default — see MatchController's `random` param) become deterministic.
 *
 * Must be called (awaited) BEFORE `page.goto()`: Playwright only applies an
 * init script to navigations that happen after it is registered.
 *
 * Why 0, and why it is safe for a long-running zero-player game: at level 1
 * `bookChance` is 0.9, so `0 < 0.9` always takes the book, and index
 * `floor(0 * n) = 0` always takes the position's FIRST listed continuation.
 * Walking public/openings/openings.json that way from the start position
 * (1. Nh3 d5 2. g3 e5 3. f4 Bxh3 4. Bxh3 exf4 5. O-O fxg3 6. hxg3, verified
 * with a one-off script against the real dataset) runs out of book only at
 * ply 11 — long past the 4-9 ply thresholds these specs wait for — and is
 * not a short forced mate, unlike some other book lines (e.g. 1.f3 e5 2.g4
 * Qh4#, which this constant value never reaches because it never plays f3).
 * Once out of book, `0 < blunderChance` also always takes the engine's own
 * "weaker" candidate from its real MultiPV search, which still plays
 * legally through real Stockfish — just consistently the weaker choice.
 */
export async function pinRandom(page: Page, value = 0): Promise<void> {
  await page.addInitScript((v) => {
    Math.random = () => v
  }, value)
}

/** Serve a known puzzle set instead of the bundled 3,000 (deterministic puzzle specs). */
export async function servePuzzles(page: Page, data: unknown = PUZZLE_FIXTURE): Promise<void> {
  await page.route('**/puzzles/puzzles.json', (r) => r.fulfill({ json: data }))
}

export async function openPuzzles(page: Page): Promise<void> {
  await page.getByTestId('open-puzzles').click()
  await expect(page.getByTestId('puzzle-screen')).toBeVisible()
}
