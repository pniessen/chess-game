import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 2: drag polish. None of these assert a mid-flight pixel or frame —
 * either the settled end state, or a class/attribute the code sets
 * deliberately (the ghost's `data-drag-phase`, `.drag-target`), watched
 * with a MutationObserver exactly the way Task 1's move-animation.spec.ts
 * watches the flight layer, so the recording is complete however fast or
 * slow the browser runs the CSS.
 */

async function twoPlayer(page: Page): Promise<void> {
  await coachOffline(page)
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

async function centerOf(page: Page, square: string): Promise<{ x: number; y: number }> {
  const locator = page.locator(`[data-square="${square}"]`)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`could not locate ${square} on the board`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Presses down on `from` and drags to `to` with real intermediate pointer
 * moves (so the 6px drag threshold is clearly exceeded before arriving),
 * but does NOT release — the caller decides when (and where) to
 * `page.mouse.up()`, so a test can inspect the board mid-drag.
 */
async function pressAndDragTo(page: Page, from: string, to: string): Promise<void> {
  const start = await centerOf(page, from)
  const end = await centerOf(page, to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t)
  }
}

/** Record every value `data-drag-phase` takes on the ghost, from before the
 *  drag starts (`'none'`, when there is no ghost) to after it is gone. */
async function watchGhostPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __ghostLog: string[] }).__ghostLog = log
    const record = () => {
      const ghost = document.querySelector('[data-testid="drag-ghost"]')
      const phase = ghost?.getAttribute('data-drag-phase') ?? 'none'
      if (log[log.length - 1] !== phase) log.push(phase)
    }
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board to watch')
    new MutationObserver(record).observe(board, { childList: true, subtree: true, attributes: true })
    record()
  })
}

async function readGhostPhases(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ghostLog: string[] }).__ghostLog)
}

/** Record whether the flight layer (Task 1's move animation) is present. */
async function watchFlightPresence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __flightLog: string[] }).__flightLog = log
    const record = () => {
      const present = document.querySelector('[data-testid="flight-layer"]') ? 'present' : 'absent'
      if (log[log.length - 1] !== present) log.push(present)
    }
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board to watch')
    new MutationObserver(record).observe(board, { childList: true, subtree: true })
    record()
  })
}

async function readFlightPresence(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __flightLog: string[] }).__flightLog)
}

test('the dragged piece lifts, and the square under the pointer gets a target ring', async ({ page }) => {
  await twoPlayer(page)
  await pressAndDragTo(page, 'e2', 'e4')

  const ghost = page.getByTestId('drag-ghost')
  await expect(ghost).toBeVisible()
  await expect(ghost).toHaveAttribute('data-drag-phase', 'dragging')
  await expect(ghost).toHaveClass(/dragging/)

  // The square under the pointer (e4, where the drag currently sits).
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/drag-target/)
  // Nowhere else does.
  await expect(page.locator('[data-square="e3"]')).not.toHaveClass(/drag-target/)

  // The source square keeps a faint placeholder — the real piece fades, it
  // is never removed from the DOM.
  await expect(page.locator('[data-square="e2"]')).toHaveClass(/dragging/)
  await expect(page.locator('[data-square="e2"] [data-piece="wP"]')).toBeVisible()

  await page.mouse.up()
  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expect(ghost).toHaveCount(0)
  await expect(page.locator('[data-square="e2"]')).not.toHaveClass(/dragging/)
})

test('a legal drag-drop still plays the move animation, with no leftover ghost', async ({ page }) => {
  await twoPlayer(page)
  await watchFlightPresence(page)
  await watchGhostPhases(page)

  await pressAndDragTo(page, 'e2', 'e4')
  await page.mouse.up()

  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('flight-layer')).toHaveCount(0)
  await expect(page.locator('.square.arriving')).toHaveCount(0)
  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)

  // The move animation really did play — this is Task 1's slide, not
  // something the ghost stood in for.
  expect(await readFlightPresence(page)).toEqual(['absent', 'present', 'absent'])
  // The ghost handed off to it instantly: it never entered 'returning'.
  expect(await readGhostPhases(page)).toEqual(['none', 'dragging', 'none'])
})

test('an illegal drop animates the ghost back to its origin instead of vanishing, and nothing moves', async ({
  page,
}) => {
  await twoPlayer(page)
  await watchGhostPhases(page)

  // e2's pawn can never land on d2 — occupied by White's own pawn, and not
  // even a pawn-shaped move to begin with. A clean "illegal drop", not a
  // legal-but-blocked edge case.
  await pressAndDragTo(page, 'e2', 'd2')
  await page.mouse.up()

  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
  await expect(page.locator('[data-square="e2"] [data-piece="wP"]')).toBeVisible()
  await expect(page.locator('[data-square="d2"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('ply-count')).toHaveText('0')

  // The ghost visibly returned before it disappeared — it did not just
  // vanish on release.
  expect(await readGhostPhases(page)).toEqual(['none', 'dragging', 'returning', 'none'])
})

test('releasing off the board cancels the drag without a snap-back', async ({ page }) => {
  await twoPlayer(page)
  await watchGhostPhases(page)

  const start = await centerOf(page, 'e2')
  // Measured AFTER e2 (inside centerOf) has already scrolled the page into
  // place — an earlier measurement could describe a scroll position that
  // no longer holds.
  const boardGrid = page.getByRole('grid', { name: 'Chess board' })
  const board = await boardGrid.boundingBox()
  if (!board) throw new Error('no board box')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // The drag threshold must be crossed WHILE still over a real square, so
  // useDragMove takes pointer capture before the gesture ever leaves the
  // board — without capture, a pointermove whose target is some unrelated
  // sibling element (the left column, here) never bubbles to the board's
  // own listener at all, and the gesture would never be seen as a drag in
  // the first place. Only once capture is in effect does a further move to
  // a point outside the board keep reaching it.
  await page.mouse.move(start.x + 15, start.y + 15)
  // Off the board (to its left, where the clocks/captured-pieces column
  // is), but still inside the viewport — a coordinate outside the
  // viewport does not reliably deliver pointer events at all, which would
  // test nothing.
  await page.mouse.move(board.x - 30, board.y + board.height / 2)
  await page.mouse.up()

  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
  await expect(page.locator('[data-square="e2"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('ply-count')).toHaveText('0')
  // A release off the board is a plain cancel — no 'returning' phase, since
  // there was no drop to animate back from.
  expect(await readGhostPhases(page)).toEqual(['none', 'dragging', 'none'])
})

// Phase 1 shipped a real pointer-capture bug that broke click-to-move.
// Task 2 touches the same drag machinery, so both input paths are covered
// side by side, in the same test, right after one another.
test('click-to-move keeps working immediately after a completed drag', async ({ page }) => {
  await twoPlayer(page)
  await pressAndDragTo(page, 'e2', 'e4')
  await page.mouse.up()
  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()

  await page.locator('[data-square="e7"]').click()
  await page.locator('[data-square="e5"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2')
})

// Same pairing, the other order: click-to-move right after an ILLEGAL
// drag's snap-back, which leaves the ghost mounted (in 'returning') for a
// beat after pointerup — exactly the state most likely to strand the
// trailing-click suppression flag if the ordering were wrong.
test('click-to-move keeps working immediately after an illegal drag', async ({ page }) => {
  await twoPlayer(page)
  await pressAndDragTo(page, 'e2', 'd2')
  await page.mouse.up()
  await expect(page.getByTestId('ply-count')).toHaveText('0')

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})

test('drag stays usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await twoPlayer(page)

  await pressAndDragTo(page, 'e2', 'e4')
  await expect(page.getByTestId('drag-ghost')).toBeVisible()
  await expect(page.locator('[data-square="e4"]')).toHaveClass(/drag-target/)
  await page.mouse.up()

  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
})

test('reduced motion: the snap-back plays no transition, but the ghost still disappears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await twoPlayer(page)

  await pressAndDragTo(page, 'e2', 'd2') // illegal: White's own pawn
  await page.mouse.up()

  const ghost = page.getByTestId('drag-ghost')
  // It may still exist for an instant mid-return; if so, it must not be
  // easing there — reduced motion disables the transition, not the ghost.
  if (await ghost.count()) {
    const duration = await ghost.evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(duration).toBe('0s')
  }
  await expect(ghost).toHaveCount(0)
  await expect(page.locator('[data-square="e2"] [data-piece="wP"]')).toBeVisible()
})
