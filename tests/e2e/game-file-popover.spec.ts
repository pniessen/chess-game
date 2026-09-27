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
   * Fix round 1 closed that at the root: `usePopover`'s `focusout` guard
   * catches focus landing nowhere and puts it back inside the popover, so
   * the inert state the React `onKeyDown` cannot serve no longer exists.
   * That is the first half of this test, and it goes red if the guard is
   * removed — `blur()` then leaves focus on `<body>` for good.
   *
   * The second half pins `documentEscape`, which is now belt and braces:
   * it has to be dispatched inside the same task as the blur, because by
   * the time Playwright hands control back the guard has already run.
   * That is the point — there are two independent defences, and this
   * checks both.
   */
  test('focus that drifts out to <body> is recovered, and Escape closes it regardless', async ({ page }) => {
    await withoutClipboard(page)
    await page.goto('/')
    await openGameFile(page)
    await page.getByTestId('share-link').click()
    await page.getByTestId('share-url').focus()
    await expect(page.getByTestId('share-url')).toBeFocused()

    // Escape delivered to `document` while focus really is on <body>,
    // which is the window `documentEscape` exists for.
    const closedFromBody = await page.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      const onBody = document.activeElement === document.body
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return { onBody, stillOpen: !!document.querySelector('[data-testid="game-file"]') }
    })
    expect(closedFromBody.onBody).toBe(true)
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()

    // And with no Escape at all, the guard alone recovers the drift.
    await openGameFile(page)
    await page.getByTestId('share-link').click()
    await page.getByTestId('share-url').focus()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(page.getByTestId('game-file')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()
  })

  /**
   * Fix round 1, the root fix behind the one above. `documentEscape`
   * patched Escape; nothing patched Tab. The trap is a React `onKeyDown`
   * on the popover element, so from `<body>` it is inert and Shift+Tab
   * walks the page behind — as far as `settings-toggle`, where Enter
   * would open a SECOND popover with a second live focus trap.
   *
   * `usePopover`'s `focusout` guard closes that at the root by never
   * letting focus rest on `<body>` while a popover is open. Remove it and
   * this goes red at the first assertion.
   */
  test('focus cannot walk out to the other popover once it has drifted to <body>', async ({ page }) => {
    await withoutClipboard(page)
    await page.goto('/')
    await openGameFile(page)
    await page.getByTestId('share-link').click()
    await page.getByTestId('share-url').focus()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

    // Back inside, rather than stranded on <body> where Tab is unguarded.
    await expect(page.getByTestId('game-file')).toBeFocused()

    for (let i = 0; i < 10; i += 1) await page.keyboard.press('Shift+Tab')
    const inside = await page.evaluate(
      () => document.querySelector('[data-testid="game-file"]')?.contains(document.activeElement) ?? false,
    )
    expect(inside).toBe(true)
    await expect(page.getByTestId('settings-toggle')).not.toBeFocused()
    await expect(page.getByTestId('settings')).toHaveCount(0)
  })

  /**
   * Fix round 1, item 9: verified in a real browser rather than reasoned
   * about. The game-end card and this popover BOTH carry a
   * `document`-level Escape listener, so one keystroke could plausibly
   * have dismissed both, each restoring focus to its own idea of where it
   * came from. It does not: with focus inside the popover, its React
   * `onKeyDown` calls `stopPropagation`, and because React 17+ listens at
   * the root container rather than at `document`, the card's listener
   * never sees the event. One Escape per layer, innermost first.
   */
  test('Escape closes the popover and the game-end card one layer at a time', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-square="e2"]').click()
    await page.locator('[data-square="e4"]').click()
    await page.getByTestId('resign').click()
    await expect(page.getByTestId('game-end-card')).toBeVisible()

    await openGameFile(page)
    await expect(page.getByTestId('game-end-card')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()
    // The card is still there — it did not go down with the popover.
    await expect(page.getByTestId('game-end-card')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('game-end-card')).toHaveCount(0)
    await expect(page.getByTestId('new-game')).toBeFocused()
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

  /**
   * The pointerdown mechanism above is only half the guarantee; this is
   * the other half. There is no keyboard route from inside one popover to
   * the other's trigger: the trap cycles, so Tab never gets there, and
   * the only way out — Escape — has already closed the first one.
   */
  test('there is no keyboard route from one popover to the other', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('game-file-toggle').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('game-file')).toBeVisible()

    // Tab all the way round the popover and past where the triggers are
    // in document order: it never lands on Settings, and never opens it.
    for (let i = 0; i < 9; i += 1) await page.keyboard.press('Tab')
    await expect(page.getByTestId('settings-toggle')).not.toBeFocused()
    await expect(page.getByTestId('settings')).toHaveCount(0)

    // Escape is the only way out, and it closes Game file on the way — so
    // by the time Settings is reachable there is nothing left to collide
    // with.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('game-file')).toHaveCount(0)
    await expect(page.getByTestId('game-file-toggle')).toBeFocused()

    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('settings-toggle')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('settings')).toBeVisible()
    await expect(page.getByTestId('game-file')).toHaveCount(0)
  })
})

/**
 * Fix round 1. The phone check used to run at 375px only and cover only
 * the Game file popover — and 375px is one of the two widths where the
 * Settings regression this task caused happened NOT to show, which is
 * exactly why it went undetected. Both popovers, and the widths either
 * side: 320 (the narrowest phone still in use, where Settings went to
 * x = -176, ~60% off-screen), 375 (the width that hid it), and 414 (where
 * it went to x = -77).
 */
for (const width of [320, 375, 414]) {
  test.describe(`phone viewport ${width}px`, () => {
    test.use({ viewport: { width, height: 812 } })

    test('both popovers open fully inside the viewport', async ({ page }) => {
      await page.goto('/')
      const overflowX = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const before = await overflowX()

      for (const [trigger, popover] of [
        ['game-file-toggle', 'game-file'],
        ['settings-toggle', 'settings'],
      ] as const) {
        await page.getByTestId(trigger).click()
        await expect(page.getByTestId(popover)).toBeVisible()

        const box = await page.getByTestId(popover).boundingBox()
        expect(box, `${popover} has no box at ${width}px`).not.toBeNull()
        // Nothing hangs off either edge. There is no horizontal page
        // scroll to go and find it with, so off-screen means unreachable.
        expect(box!.x, `${popover} left edge at ${width}px`).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, `${popover} right edge at ${width}px`).toBeLessThanOrEqual(width)
        expect(await overflowX()).toBeLessThanOrEqual(before)

        await page.keyboard.press('Escape')
        await expect(page.getByTestId(popover)).toHaveCount(0)
      }
    })

    test('the controls at the far end of the Settings popover are reachable', async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('settings-toggle').click()
      await expect(page.getByTestId('settings')).toBeVisible()
      // The regression left these three past the left edge of the screen.
      for (const id of ['appearance-dark', 'sound-toggle', 'volume']) {
        await page.getByTestId(id).scrollIntoViewIfNeeded()
        const box = await page.getByTestId(id).boundingBox()
        expect(box, `${id} has no box at ${width}px`).not.toBeNull()
        expect(box!.x, `${id} left edge at ${width}px`).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width, `${id} right edge at ${width}px`).toBeLessThanOrEqual(width)
      }
    })
  })
}
