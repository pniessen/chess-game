import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 1 of the above-the-fold plan: the board's edge length derives from
 * `--board-size` (app.css's `.layout`) — `clamp(360px, min(640px, calc(100svh
 * - var(--chrome))), 640px)` — instead of a hard 640px that never reacted to
 * viewport HEIGHT. This is Task 1's own spec only: later tasks in the plan
 * append their own tests to this file, and Task 7 owns the full viewport
 * matrix — this test is deliberately narrow (board geometry only, not "the
 * page never scrolls", which stays true until Task 5 fills the side
 * columns: with a measured `--chrome` of 122px, `.board-row`'s own bottom
 * edge already fits inside all three viewports below even with the OLD
 * fixed-640px board — verified live in a real browser, both before and
 * after this task's change — because the side columns, not the board, are
 * what pushes the page past the fold today).
 */
for (const { width, height } of [
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(`the board is square, at least 360px, and .board-row fits the viewport at ${width}x${height}`, async ({
    page,
  }) => {
    await coachOffline(page)
    await page.setViewportSize({ width, height })
    await page.goto('/')

    const board = page.locator('.board')
    await expect(board).toBeVisible()
    const boardBox = await board.boundingBox()
    if (!boardBox) throw new Error('.board has no bounding box')

    // Square: aspect-ratio: 1 in board.css should hold at every --board-size.
    expect(Math.abs(boardBox.width - boardBox.height)).toBeLessThan(1)
    // The clamp's own floor.
    expect(boardBox.width).toBeGreaterThanOrEqual(360)

    const boardRow = page.locator('.board-row')
    const rowBox = await boardRow.boundingBox()
    if (!rowBox) throw new Error('.board-row has no bounding box')
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(height)
  })
}

// Reverting `--board-size` to a fixed 640px turns THIS red at 1280x720:
// measured live (both before and after this task's change), the 640px-capped
// board renders at a constant 590px square there regardless of viewport
// height — the same 590px it renders at 1440x800 and 1920x1080. The fix
// (--board-size reacting to `100svh - --chrome`, clamped to [360, 640])
// measurably shrinks it below that at the shortest of the three viewports,
// which is the one observable signal that the derivation is live rather than
// silently re-clamped back to one fixed number.
test('at the shortest of the three viewports, the board is measurably smaller than the 640px-capped render', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')

  const boardBox = await page.locator('.board').boundingBox()
  if (!boardBox) throw new Error('.board has no bounding box')
  // A fixed 640px cap renders this board at 590px at every viewport height
  // (see the 1440x800/1920x1080 cases above); the reactive --board-size
  // renders it at 548px at 1280x720 (100svh(720) - --chrome(122) = 598,
  // under the 640px cap) — well clear of any rendering-engine rounding.
  expect(boardBox.width).toBeLessThan(580)
})
