import { expect, test } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

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

/**
 * Task 2: Controls moved out of .board-column (where Pause/Step were
 * clipped by the fold and Hint was entirely below it) into .left-column,
 * re-laid out for its 232px width. Red before this task: with Controls
 * still under a 610px board, Pause/Step/Speed and Hint sit well past
 * y=800 at 1440x800 — verified live (see task-2-report.md) — so their
 * bounding boxes would fail the "inside the viewport" assertion below.
 */
test('at 1440x800, every control is inside the viewport', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')

  for (const id of ['undo', 'redo', 'flip', 'resign', 'pause', 'step', 'speed', 'hint']) {
    const box = await page.getByTestId(id).boundingBox()
    if (!box) throw new Error(`[data-testid="${id}"] has no bounding box`)
    expect(box.y, `${id}.y`).toBeGreaterThanOrEqual(0)
    expect(box.x, `${id}.x`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${id} bottom edge`).toBeLessThanOrEqual(800)
    expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(1440)
  }
})

// Red if `.hint-text` loses its reserved min-height (app.css, `.hint-row
// .hint-text`): verified live by removing it — `.controls` grows from
// 216px to 260px (+43.5px, exactly the 2 reserved lines) once the hint
// text fills in, where WITH the reservation it stays at 260px throughout.
// `.controls`, not the board, is the direct assertion: `.left-column` and
// `.board-column` are independent CSS Grid tracks (`align-items: start`),
// so the board's own position is unaffected by `.left-column` growing
// EITHER way — asserting the board alone would pass even with the
// reservation deleted, which is why `.controls`'s height is checked too.
// The board check is kept because it's what the brief's own e2e bullet
// asks for, and stays a fair regression guard against that grid
// independence itself ever changing.
test('the hint text filling in from empty does not move the board or resize the controls card', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await startOnePlayer(page)
  // Let the engine finish its own async warm-up first (its spinner in the
  // status row disappears once ready, changing that row's height) so the
  // only thing left to move anything, below, is the hint text itself.
  const hint = page.getByTestId('hint')
  await expect(hint).toBeEnabled()

  // Viewport-relative board position isn't reliable here: clicking Hint
  // several times in a row makes Playwright re-scroll it into view between
  // clicks (a pre-existing quirk, unrelated to this task, of focus
  // handling elsewhere on the page), which moves the board's VIEWPORT
  // position without moving it in the page at all. Document-relative
  // (boundingBox().y + scrollY) cancels that out.
  const boardDocumentTop = async () => {
    const box = await page.locator('.board').boundingBox()
    if (!box) throw new Error('.board has no bounding box')
    return box.y + (await page.evaluate(() => window.scrollY))
  }
  const controlsHeight = async () => {
    const box = await page.locator('.controls').boundingBox()
    if (!box) throw new Error('.controls has no bounding box')
    return box.height
  }

  const hintText = page.getByTestId('hint-text')
  await expect(hintText).toBeEmpty()
  const topBefore = await boardDocumentTop()
  const heightBefore = await controlsHeight()

  // Three presses: nudge -> move -> reasoning (coach offline, so reasoning
  // falls back to a templated sentence built from the engine's own line —
  // no network needed, same fallback the existing hint e2e specs rely on).
  await hint.click()
  await hint.click()
  await hint.click()
  await expect(hintText).not.toBeEmpty()

  expect(await boardDocumentTop()).toBe(topBefore)
  expect(await controlsHeight()).toBe(heightBefore)
})
