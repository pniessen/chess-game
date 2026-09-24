import { expect, test } from '@playwright/test'
import {
  centerOf,
  pressAndDragTo,
  readFlightPresence,
  readGhostPhases,
  twoPlayer,
  watchFlightPresence,
  watchGhostPhases,
} from './drag-helpers'

/**
 * Task 2: drag polish, driven by a mouse (see touch-drag.spec.ts for the
 * genuine-touch-input coverage of the same ghost/target-ring/snap-back
 * behaviour). None of these assert a mid-flight pixel or frame — either the
 * settled end state, or a class/attribute the code sets deliberately (the
 * ghost's `data-drag-phase`, `.drag-target`), watched with a
 * MutationObserver exactly the way Task 1's move-animation.spec.ts watches
 * the flight layer, so the recording is complete however fast or slow the
 * browser runs the CSS.
 */

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
