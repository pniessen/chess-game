import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { centerOf, readGhostPhases, twoPlayer, watchGhostPhases } from './drag-helpers'

/**
 * Task 2 review finding: a 375px-wide viewport dragged with `page.mouse`
 * (drag-polish.spec.ts's "drag stays usable at phone width") proves the
 * LAYOUT survives a narrow screen, but nothing about it is touch — Chromium
 * still reports `pointerType: 'mouse'`, and `touch-action: none` (board.css)
 * is never exercised, since nothing ever asks the browser to pan/scroll in
 * response to a touch.
 *
 * `test.use` below gives this whole file a touch-capable, mobile-sized
 * context; `dispatchTouchDrag` drives it through Chrome DevTools Protocol's
 * `Input.dispatchTouchEvent`, which Chromium turns into real
 * pointerdown/pointermove/pointerup events carrying `pointerType: 'touch'`
 * — the same path a finger on a real phone takes, not a JS-constructed
 * event. The first test below reads that pointerType back out of the page
 * to prove it.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

async function cdpFor(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page)
}

/**
 * Dispatches a single-finger touch drag from `from` to `to` via CDP. Leaves
 * the touch DOWN when `release` is false, so a test can inspect the board
 * mid-gesture before calling `touchUp` itself.
 */
async function touchDragTo(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { release = true }: { release?: boolean } = {},
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  })
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    })
  }
  if (release) await touchUp(cdp)
}

async function touchUp(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('a touch drag completes a legal move, with real touch pointer events and no page scroll', async ({
  page,
}) => {
  await twoPlayer(page)

  // Prove the events are genuinely touch, not mouse-emulated-as-touch: read
  // the pointerType straight off the board's own pointerdown/pointermove.
  await page.evaluate(() => {
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board')
    const types = new Set<string>()
    ;(window as unknown as { __pointerTypes: Set<string> }).__pointerTypes = types
    board.addEventListener('pointerdown', (e) => types.add((e as PointerEvent).pointerType))
    board.addEventListener('pointermove', (e) => types.add((e as PointerEvent).pointerType))
  })

  const cdp = await cdpFor(page)
  // centerOf scrolls the board into view — measure the scroll position
  // AFTER that settles, so the assertion below is about what the DRAG
  // itself does, not about getting the board on screen in the first place.
  const from = await centerOf(page, 'e2')
  const to = await centerOf(page, 'e4')
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await touchDragTo(cdp, from, to)

  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)

  const pointerTypes = await page.evaluate(() => [...(window as unknown as { __pointerTypes: Set<string> }).__pointerTypes])
  expect(pointerTypes).toEqual(['touch'])

  // touch-action: none (board.css) did its job: the page never panned in
  // response to the drag.
  const scrollAfter = await page.evaluate(() => window.scrollY)
  expect(scrollAfter).toBe(scrollBefore)
})

test('an illegal touch drop snaps the ghost back, and nothing moves', async ({ page }) => {
  await twoPlayer(page)
  await watchGhostPhases(page)

  const cdp = await cdpFor(page)
  const from = await centerOf(page, 'e2')
  // d2 — White's own pawn: illegal for the same reason as the mouse-driven
  // spec's equivalent test.
  const to = await centerOf(page, 'd2')
  await touchDragTo(cdp, from, to)

  await expect(page.getByTestId('drag-ghost')).toHaveCount(0)
  await expect(page.locator('[data-square="e2"] [data-piece="wP"]')).toBeVisible()
  await expect(page.locator('[data-square="d2"] [data-piece="wP"]')).toBeVisible()
  await expect(page.getByTestId('ply-count')).toHaveText('0')

  expect(await readGhostPhases(page)).toEqual(['none', 'dragging', 'returning', 'none'])
})

// Phase 1's pointer-capture bug broke click-to-move; a touch tap goes
// through the same suppression flag a mouse click does (see useDragMove's
// shouldSuppressClick), so it needs the same "still works right after a
// drag" proof under real touch input.
test('click-to-move (tap-tap) keeps working immediately after a touch drag', async ({ page }) => {
  await twoPlayer(page)

  const cdp = await cdpFor(page)
  const from = await centerOf(page, 'e2')
  const to = await centerOf(page, 'e4')
  await touchDragTo(cdp, from, to)
  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()

  // A real tap (touchstart+touchend at the same point, no motion) is
  // exactly what a click-to-move selection is made of on a touchscreen.
  await page.touchscreen.tap(...(await centerOf(page, 'e7').then((p) => [p.x, p.y] as const)))
  await page.touchscreen.tap(...(await centerOf(page, 'e5').then((p) => [p.x, p.y] as const)))

  await expect(page.getByTestId('ply-count')).toHaveText('2')
})
