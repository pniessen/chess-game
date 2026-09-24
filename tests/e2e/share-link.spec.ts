import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 14: the shareable position link.
 *
 * Each test names the change that turns it red:
 *  - the copy tests turn red if the Share button stops writing a working
 *    URL to the clipboard, or stops degrading to a manual copy box when the
 *    Clipboard API is unavailable/refused.
 *  - the load tests turn red if opening a shared URL stops reconstructing
 *    the position (and, where cheap, the move list), or starts throwing /
 *    corrupting state on a malformed one.
 *  - the resume-conflict tests turn red if a shared link ever destroys a
 *    saved in-progress game, or stops offering the existing resume choice
 *    once the share offer is resolved.
 */

async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

const TWO_PLAYER_SETUP = {
  white: { kind: 'human' },
  black: { kind: 'human' },
  timeControl: { kind: 'untimed' },
}

test.beforeEach(async ({ page }) => coachOffline(page))

test.describe('the Share button', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
  })

  test('copies a URL carrying the current position and confirms it', async ({ page }) => {
    await move(page, 'e2', 'e4')
    await move(page, 'e7', 'e5')

    await page.getByTestId('share-link').click()
    await expect(page.getByTestId('share-status')).toBeVisible()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain('?fen=')
    expect(new URL(url).origin).toBe(new URL(page.url()).origin)
  })

  test('degrades to a manual copy box when the clipboard write is refused', async ({ page, context }) => {
    await context.clearPermissions()
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      })
    })
    await page.goto('/')
    await page.getByTestId('share-link').click()
    const box = page.getByTestId('share-manual')
    await expect(box).toBeVisible()
    await expect(box.locator('input')).toHaveValue(/\?fen=/)
  })
})

test.describe('opening a shared link', () => {
  // Review round 1 (Task 14) polish: this title used to claim it exercised
  // "the deploy base path used in dev" — it doesn't. The dev server here
  // always serves at `/` (BASE_PATH is a build-time-only env var; Vite's
  // build workflow sets it to `/chess-game/` for GitHub Pages), so this
  // test never actually navigates under a subpath. That's fine, because
  // parsing a share link (`parseShareLink`/`useShareLink`) only ever reads
  // `location.search` — a page's own query string is identical whatever
  // path prefix it was served under. What DOES need to carry the base
  // path is the URL `buildShareUrl` WRITES (the Share button), and that is
  // what `src/ui/share.test.ts`'s `buildShareUrl` describe block actually
  // exercises, with `vi.stubEnv('BASE_URL', '/chess-game/')`.
  test('reconstructs the position and the move list from the query string', async ({ page }) => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    await page.goto(`/?fen=${encodeURIComponent(fen)}&moves=${encodeURIComponent('e4 e5')}`)

    await expect(page.getByTestId('ply-count')).toHaveText('2')
    await expect(page.getByTestId('move-1')).toHaveText('e4')
    await expect(page.getByTestId('move-2')).toHaveText('e5')
    // The query string is gone: a reload starts a normal game, not the same offer again.
    await expect(page).toHaveURL((u) => u.search === '')
  })

  test('a malformed fen param never throws, starts a normal game, and shows a dismissible message', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('/?fen=not-a-real-fen')

    expect(errors).toHaveLength(0)
    await expect(page.getByTestId('ply-count')).toHaveText('0')
    const notice = page.getByTestId('share-link-error')
    await expect(notice).toBeVisible()
    await notice.getByTestId('share-link-dismiss').click()
    await expect(notice).toHaveCount(0)
  })
})

test.describe('a shared link alongside a saved in-progress game', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      (setup) => {
        window.localStorage.setItem(
          'chess-game:in-progress',
          JSON.stringify({ v: 2, pgn: '1. d4 d5 *', setup, scored: false }),
        )
      },
      TWO_PLAYER_SETUP,
    )
  })

  test('offers a choice instead of silently loading either one', async ({ page }) => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    await page.goto(`/?fen=${encodeURIComponent(fen)}&moves=${encodeURIComponent('e4 e5')}`)

    await expect(page.getByTestId('share-conflict-banner')).toBeVisible()
    await expect(page.getByTestId('resume-banner')).toHaveCount(0)
  })

  test('accepting loads the shared position and never destroys the saved game', async ({ page }) => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    await page.goto(`/?fen=${encodeURIComponent(fen)}&moves=${encodeURIComponent('e4 e5')}`)

    await page.getByTestId('share-accept').click()
    await expect(page.getByTestId('move-1')).toHaveText('e4')
    await expect(page.getByTestId('share-conflict-banner')).toHaveCount(0)
    // The saved game was never destroyed, so the ordinary resume banner
    // reappears, still offering it.
    await expect(page.getByTestId('resume-banner')).toBeVisible()

    const saved = await page.evaluate(() => window.localStorage.getItem('chess-game:in-progress'))
    expect(JSON.parse(saved ?? 'null').pgn).toContain('d4')

    await page.getByTestId('resume-accept').click()
    await expect(page.getByTestId('move-1')).toHaveText('d4')
  })

  test('declining falls through to the ordinary resume banner, unmodified', async ({ page }) => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
    await page.goto(`/?fen=${encodeURIComponent(fen)}&moves=${encodeURIComponent('e4 e5')}`)

    await page.getByTestId('share-decline').click()
    await expect(page.getByTestId('share-conflict-banner')).toHaveCount(0)
    await expect(page.getByTestId('resume-banner')).toBeVisible()
    await page.getByTestId('resume-accept').click()
    await expect(page.getByTestId('move-1')).toHaveText('d4')
  })
})

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the Share button and the manual copy box fit without overflowing', async ({ page, context }) => {
    await context.clearPermissions()
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    })
    await page.goto('/')
    const pageOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const before = await pageOverflow()

    await page.getByTestId('share-link').click()
    await expect(page.getByTestId('share-manual')).toBeVisible()
    expect(await pageOverflow()).toBeLessThanOrEqual(before)
  })
})
