import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * The THIRD popover — New game — which the sibling spec deliberately does
 * not cover, and which is the one most likely to break a trap.
 *
 * Two things make it different from the two header popovers:
 *  - it exists only below the layout's stacking breakpoint, so it needs a
 *    mobile viewport to exist at all; and
 *  - it is the codebase's only `createPortal`, rendered into
 *    `document.body` rather than inside `.app`, because `.right-column`'s
 *    `overflow-y: auto` clipped it to a sliver when it was an absolutely
 *    positioned child. A trap that works by walking the DOM from the app
 *    root, or that assumes the popover shares an ancestor with the page
 *    behind it, would pass for the other two and fail here.
 *
 * The assertions are deliberately NOT a copy of the sibling spec's. That
 * one asserts Tab never reaches `mode`, `time-control`, `tab-moves` or
 * `new-game` — but at this width `mode`, `time-control` and `new-game`
 * live INSIDE this popover, so reusing it would either assert nothing or
 * fail on a missing locator. The inverse is what matters here: focus must
 * stay within the portal node, and must never reach the board or either
 * of the other two triggers.
 *
 * Breaking change this catches: reverting `usePopover`'s roving Tab back
 * to the ends-only trap, in WebKit — where `new-game-popover-done` is a
 * button, Safari's default tab mode makes no button a tab stop, and the
 * wrap therefore never fires.
 */

const MOBILE = { width: 375, height: 812 }

/** Where focus is, as a test id (or the tag name when it carries none). */
const focusedTestId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.dataset['testid'] ?? el?.tagName ?? null
  })

const focusInsidePortal = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector('[data-testid="new-game-popover"]')?.contains(document.activeElement) ??
      false,
  )

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize(MOBILE)
})

async function openNewGame(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('new-game-toggle').click()
  await expect(page.getByTestId('new-game-popover')).toBeVisible()
}

test('the portaled New game popover really is portaled, and focus starts inside it', async ({
  page,
}) => {
  await openNewGame(page)

  // If this ever fails, the popover has been moved back under `.app` and
  // the clipping bug it was portaled to escape is likely back too.
  const parentIsBody = await page.evaluate(
    () => document.querySelector('[data-testid="new-game-popover"]')?.parentElement?.tagName,
  )
  expect(parentIsBody).toBe('BODY')

  expect(await focusedTestId(page)).toBe('new-game-popover')
})

/**
 * The controls Tab must visit, in order, with the default Two-players
 * mode selected — Level and Play-as are disabled there, so they are not
 * tab stops. Measured, not guessed.
 *
 * Asserting the ORDER rather than mere containment is the whole point,
 * and the first version of this test got it wrong. Containment cannot
 * fail here: the portal is the last node in `body`, and WebKit's native
 * tab order happens to keep focus inside it even with the trap reverted.
 * The sequence it produced was
 *
 *   mode -> time-control -> new-game-popover -> mode -> ...
 *
 * which never escapes and so passed a containment check — while silently
 * skipping `new-game`, `open-puzzles` and `Done`, because Safari's
 * default tab mode makes no button a tab stop. The real defect for this
 * popover is not that focus gets out; it is that a Safari user can reach
 * the two selects and NONE of the three buttons, so they cannot start a
 * game from the keyboard. That is what this order pins.
 */
const ORDER = ['mode', 'time-control', 'new-game', 'open-puzzles', 'new-game-popover-done'] as const

test('Tab reaches every control in the portal, including the buttons, and wraps', async ({
  page,
}) => {
  await openNewGame(page)

  // Two laps: the first proves the order, the second proves the wrap is a
  // cycle rather than a one-off bounce off the end.
  for (const lap of [1, 2]) {
    for (const id of ORDER) {
      await page.keyboard.press('Tab')
      expect(await focusedTestId(page), `lap ${lap}, forward`).toBe(id)
      expect(await focusInsidePortal(page)).toBe(true)
    }
  }

  // Backwards too, from the first control off the front to the last.
  await page.keyboard.press('Tab')
  expect(await focusedTestId(page)).toBe(ORDER[0])
  for (const id of [...ORDER].reverse()) {
    await page.keyboard.press('Shift+Tab')
    expect(await focusedTestId(page), 'backward').toBe(id)
    expect(await focusInsidePortal(page)).toBe(true)
  }

  // Nothing outside the portal was reached — not the board behind it, not
  // the two header triggers that own the other popovers.
  for (const id of ['game-file-toggle', 'settings-toggle']) {
    await expect(page.getByTestId(id)).not.toBeFocused()
  }
  const onBoard = await page.evaluate(
    () => document.querySelector('.board')?.contains(document.activeElement) ?? false,
  )
  expect(onBoard, 'focus should never land on the board behind').toBe(false)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('new-game-popover')).toHaveCount(0)
  await expect(page.getByTestId('new-game-toggle')).toBeFocused()
})
