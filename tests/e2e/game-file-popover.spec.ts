import { expect, test, type Page } from '@playwright/test'
import { coachOffline, importGame, openGameFile, openSettings } from './helpers'

/**
 * Task 4 (above the fold): Export PGN / Share position / Import behind the
 * `Game file` trigger on the status row.
 *
 * Rendering GameIO back in the board column, or dropping the focus trap,
 * turns this file red. Test by test:
 *  - the board column test turns red the moment anything but the board is
 *    stacked under it again.
 *  - export/share/import turn red if any of those three flows stops
 *    working through the popover — the whole point of the move is that the
 *    controls are behind one more click, not that they changed.
 *  - the keyboard tests turn red if focus stops entering the popover, if
 *    Tab stops cycling inside it, if Escape stops closing it or stops
 *    returning focus to the trigger, or if the `document`-level Escape
 *    fallback is removed.
 *  - the exclusion test turns red if either popover stops dismissing
 *    itself on an outside pointerdown.
 */

test.beforeEach(async ({ page }) => coachOffline(page))

/** Deny the Clipboard API outright, so Share takes its manual fallback. */
async function withoutClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })
}

test('the board column holds nothing but the board', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').waitFor()

  // Red before this task: `.game-io` was the last card stacked under the
  // board, 287px of it, which is exactly what this asserts is gone.
  const cards = await page.evaluate(() =>
    [...(document.querySelector('.board-column')?.children ?? [])]
      .map((el) => el.className)
      .filter((c) => typeof c === 'string' && c.length > 0 && !c.includes('board-row') && !c.includes('sr-only')),
  )
  expect(cards).toEqual([])
  await expect(page.getByTestId('game-file')).toHaveCount(0)
})

test('the trigger sits in the header beside Shortcuts and Settings', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByTestId('game-file-toggle')
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveText('Game file')
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  const order = await page.evaluate(() =>
    [...(document.querySelector('.status-row')?.children ?? [])]
      .map((el) => el.className)
      .filter((c) => /game-file-anchor|shortcuts-trigger|settings-anchor/.test(String(c))),
  )
  expect(order).toEqual(['game-file-anchor', 'shortcuts-trigger', 'settings-anchor'])
})

test.describe('the three flows still work through the popover', () => {
  test('Export PGN downloads the game', async ({ page }) => {
    await page.goto('/')
    await importGame(page, '1. e4 e5 2. Nf3 Nc6 *')
    await openGameFile(page)

    const download = page.waitForEvent('download')
    await page.getByTestId('export-pgn').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.pgn$/)

    const stream = await file.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const pgn = Buffer.concat(chunks).toString('utf8')
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6')
  })

  test('Share position copies a link to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await openGameFile(page)

    await page.getByTestId('share-link').click()
    await expect(page.getByTestId('share-status')).toBeVisible()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain('?fen=')
  })

  test('Share position falls back to a manual copy box with no Clipboard API', async ({ page }) => {
    await withoutClipboard(page)
    await page.goto('/')
    await openGameFile(page)

    await page.getByTestId('share-link').click()
    await expect(page.getByTestId('share-manual')).toBeVisible()
    await expect(page.getByTestId('share-url')).toHaveValue(/\?fen=/)
    // Still inside the popover, not leaking out of it.
    await expect(page.getByTestId('game-file').getByTestId('share-url')).toBeVisible()
  })

  test('Import changes the position on the board and closes the popover', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-square="e4"] [data-piece]')).toHaveCount(0)

    // `importGame` itself asserts the popover closes on success.
    await importGame(page, '8/P7/8/8/4B3/8/8/K6k w - - 0 1')

    await expect(page.locator('[data-square="e4"] [data-piece]')).toHaveCount(1)
    await expect(page.locator('[data-square="a7"] [data-piece]')).toHaveCount(1)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()
  })

  test('a file picked with Choose File lands in the paste box', async ({ page }) => {
    await page.goto('/')
    await openGameFile(page)
    await page.getByTestId('import-file').setInputFiles({
      name: 'game.pgn',
      mimeType: 'application/x-chess-pgn',
      buffer: Buffer.from('1. d4 d5 2. c4 *'),
    })
    await expect(page.getByTestId('import-text')).toHaveValue('1. d4 d5 2. c4 *')
    await page.getByTestId('import-submit').click()
    await expect(page.getByTestId('ply-count')).toHaveText('3')
  })
})

test.describe('the keyboard contract', () => {
  test('focus enters the popover, Tab cycles inside it, Escape returns focus to the trigger', async ({ page }) => {
    await page.goto('/')
    const trigger = page.getByTestId('game-file-toggle')
    await openGameFile(page)

    const pop = page.getByTestId('game-file')
    await expect(pop).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // Not a modal: the game behind is still live and still announced.
    await expect(pop).not.toHaveAttribute('aria-modal', /.*/)

    // Forward from the popover walks its own controls, in order...
    for (const id of ['export-pgn', 'share-link', 'import-text', 'import-file', 'import-submit', 'game-file-done']) {
      await page.keyboard.press('Tab')
      await expect(page.getByTestId(id)).toBeFocused()
    }
    // ...and one more Tab wraps back to the first, rather than escaping
    // into the page behind.
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('export-pgn')).toBeFocused()
    // Backwards off the front wraps to the last.
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId('game-file-done')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  /**
   * The GameEndCard hole, which this popover can reach too. GameIO tears
   * its own contents down as the game moves: the `share-manual` box — and
   * the focusable URL input inside it, which you focus to copy by hand —
   * unmounts the instant `game.ply` changes. An engine reply does that
   * with no click anywhere, so the focused input can vanish while the
   * popover is still open and leave focus on `<body>`.
   *
   * The blur below stands in for that (driving a real engine reply into a
   * narrow window would be a race, not a test), exactly as
   * App.shortcuts.test.tsx stands in for a board click on the game-end
   * card. The assertion is the real one: from `<body>`, nothing bubbles
   * through the popover, so without the `document`-level listener in
   * `usePopover` this goes red — Escape does nothing, and because the
   * popover reports itself through `overlayOpen` every other shortcut is
   * dead with it.
   */
  test('Escape still closes it once focus has drifted out to <body>', async ({ page }) => {
    await withoutClipboard(page)
    await page.goto('/')
    await openGameFile(page)
    await page.getByTestId('share-link').click()
    await page.getByTestId('share-url').focus()
    await expect(page.getByTestId('share-url')).toBeFocused()

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    // Still open: nothing outside it was clicked.
    await expect(page.getByTestId('game-file')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()
  })

  test('a click on the board dismisses it and plays the move', async ({ page }) => {
    await page.goto('/')
    await openGameFile(page)

    await page.locator('[data-square="e2"]').click()
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await page.locator('[data-square="e4"]').click()
    await expect(page.getByTestId('ply-count')).toHaveText('1')
  })
})

test.describe('two popovers are never open at once', () => {
  test('opening Settings closes Game file, and the other way round', async ({ page }) => {
    await page.goto('/')
    await openGameFile(page)
    await openSettings(page)
    await expect(page.getByTestId('game-file')).toHaveCount(0)

    await openGameFile(page)
    await expect(page.getByTestId('settings')).toHaveCount(0)
    await expect(page.getByTestId('game-file')).toBeVisible()
  })
})

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the popover fits a 375px viewport without overflowing the page', async ({ page }) => {
    await page.goto('/')
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const before = await overflow()
    await openGameFile(page)
    expect(await overflow()).toBeLessThanOrEqual(before)

    const box = await page.getByTestId('game-file').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  })
})
