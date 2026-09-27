import { expect, test, type Page } from '@playwright/test'
import { coachOffline, importGame, startOnePlayer } from './helpers'

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

// Task 2: Controls moved out of .board-column (where Pause/Step were
// clipped by the fold and Hint was entirely below it) into .left-column,
// re-laid out for its 232px width. Red before this task: with Controls
// still under a 610px board, Pause/Step/Speed and Hint sit well past
// y=800 at 1440x800 — verified live (see task-2-report.md). Its own
// "every control is inside the viewport" check is now folded into Task
// 7's full id sweep, at the bottom of this file (same 8 ids, same
// viewport, a strictly stronger assertion) — deleted here rather than
// duplicated.

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

/**
 * Task 3: NewGame moved out of .board-column (below a 610px board, entirely
 * below the fold) into .right-column, above <RightTabs>, laid out as a
 * single-column stack of labelled selects for the 280px column (a 2x2 grid
 * was measured and rejected — see task-3-report.md — "Engine vs engine" and
 * "Classical 30+0" visibly clip in a ~118px-wide grid cell even though a
 * <select>'s own scrollWidth never reports it, which is why this file
 * checks both the DOM metric the brief asks for AND relies on the report's
 * screenshots for the visual signal that metric can't catch).
 *
 * Red before this task: with NewGame still under the board, `mode`,
 * `level`, `color`, `time-control`, `new-game` and `open-puzzles` all sit
 * well past y=800 at 1440x800 (the same fold `.board-column`'s Controls
 * used to be stuck behind — see the Task 2 test above) — verified live
 * before this task's change. The bounding-box-inside-viewport half of this
 * check (all six ids) is folded into Task 7's full id sweep, at the bottom
 * of this file, and deleted here rather than duplicated; the select-
 * clipping check below is a distinct mechanism (a `<select>`'s own
 * `scrollWidth` never reports the 2x2-grid clipping this task's report
 * measured visually), so it stays.
 */
test('at 1440x800, no New game select is clipped (scrollWidth check)', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('mode').waitFor()

  for (const id of ['mode', 'level', 'color', 'time-control']) {
    const overflow = await page.getByTestId(id).evaluate((el: HTMLSelectElement) => el.scrollWidth > el.clientWidth)
    expect(overflow, `${id} clipped (scrollWidth > clientWidth)`).toBe(false)
  }
})

// Red before this task: NewGame rendered inside .board-column, after the
// board and before .game-io, so it came AFTER the tabs in document order
// too (.right-column, with only RightTabs in it, preceded .board-column's
// trailing children in the DOM). Asserting NewGame's card precedes .tabs
// pins the "above <RightTabs>" placement the brief calls for, independent
// of the viewport-rect check above (which would pass even if the two
// swapped position, since both are still on-screen either way).
test('the New game card is above the tabs in the right column', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  // page.goto only waits for `load`, not for React's first render — the
  // evaluate below reads the DOM directly (no locator auto-wait), so it
  // needs its own wait for the app to have mounted.
  await page.getByTestId('mode').waitFor()

  const order = await page.evaluate(() => {
    const rightColumn = document.querySelector('.right-column')
    if (!rightColumn) return null
    const newGame = rightColumn.querySelector('.new-game')
    const tabs = rightColumn.querySelector('.tabs')
    if (!newGame || !tabs) return null
    // DOCUMENT_POSITION_FOLLOWING (4) means `tabs` comes after `newGame`.
    return Boolean(newGame.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(order).toBe(true)
})

/* ====================================================================
   Task 5: both side columns flex to the board's height.

   Tasks 2-4 moved every card into the two side columns; this is what
   makes them fit. `.left-column` and `.right-column` are capped at
   `--board-size` and scroll inside that cap, and the tab card's PANEL —
   not the document — is the scroll container for the moves, history and
   explorer lists, replacing the three fixed px caps (420px on the moves
   list, 420px on `.history-list`, 280px on `.explorer-results`) that
   used to push the page past the fold.

   Measured live before this task, with the game below loaded: the page
   was 948px tall inside BOTH an 800px and a 720px viewport (148px and
   228px of overflow), all of it `.right-column` at 826px against a
   ~702px budget. After: 800/800 and 720/720.

   Scope note: Task 7 owns the full viewport matrix and may subsume
   these. What is pinned here is the mechanism, at the sizes this task
   actually changed.
   ==================================================================== */

/**
 * A real 70-move game (140 plies), generated legal-move-by-legal-move
 * with the repo's own chess.js dependency from a fixed seed and replayed
 * back through it to check — not a stub, because what is being measured
 * is a moves list long enough to overflow (2,097px of content) and a
 * captured card with most of the material on it (that is what takes the
 * left column from 504px to 613px).
 */
const LONG_GAME = [
  '1. b3 h6 2. h3 c5 3. Nf3 d5 4. c4 Bg4 5. hxg4 d4 6. g5 Qc8 7. a4 Qd8 8. Rxh6 Nxh6 9. Nxd4',
  'Nd7 10. gxh6 Rxh6 11. b4 Qb8 12. e3 cxd4 13. exd4 Re6+ 14. Qe2 Rf6 15. d5 Rxf2 16. Qxe7+',
  'Bxe7 17. Nc3 Rxg2 18. Bxg2 Qc8 19. Bh1 Bd6 20. Be4 Qxc4 21. Bg6 Qxd5 22. Bh5 Nf8 23. Bxf7+',
  'Kd7 24. Nxd5 Bxb4 25. Bh5 Bxd2+ 26. Kd1 Bxc1 27. Rb1 Bh6 28. Rb3 Nh7 29. Rb2 Rh8 30. Rxb7+',
  'Kc6 31. Nc7 Kxb7 32. Na8 Rxa8 33. a5 Nf8 34. a6+ Kxa6 35. Be2+ Kb7 36. Bf3+ Kb6 37. Bxa8 Bc1',
  '38. Kxc1 Kc5 39. Bd5 Kxd5 40. Kb1 Kc5 41. Kc2 Kb4 42. Kb1 a5 43. Kc2 Kc4 44. Kb2 Kb4 45. Kc2',
  'Ng6 46. Kb1 Nh4 47. Kb2 g5 48. Ka2 Kc4 49. Ka3 Kd3 50. Kb2 Ng2 51. Kc1 Nf4 52. Kb1 Kd2 53.',
  'Ka1 Ng6 54. Kb1 Ke1 55. Ka2 Ke2 56. Ka1 Kd2 57. Kb2 a4 58. Kb1 Kd1 59. Ka1 Nf8 60. Kb2 Ng6',
  '61. Ka2 Ne7 62. Ka1 Ng6 63. Kb1 Ke1 64. Ka1 Nh8 65. Kb2 Ng6 66. Ka2 Nf8 67. Kb2 Nd7 68. Kc3',
  'Nc5 69. Kd4 Kf1 70. Kxc5 Kg1 *',
].join(' ')

/** How far the DOCUMENT can scroll. 0 means the page fits the viewport. */
const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

async function withLongGame(page: Page, size: { width: number; height: number }): Promise<void> {
  await coachOffline(page)
  await page.setViewportSize(size)
  await page.goto('/')
  await importGame(page, LONG_GAME)
  await expect(page.getByTestId('ply-count')).toHaveText('140')
}

for (const size of [
  { width: 1440, height: 800 },
  { width: 1280, height: 720 },
]) {
  // Red before this task: the moves list's `max-height: 420px` let
  // `.right-column` grow to 826px, and the document — not the panel —
  // was what scrolled (measured: scrollHeight 948 at both viewports).
  test(`with a 70-move game at ${size.width}x${size.height}, the moves list scrolls and the page does not`, async ({
    page,
  }) => {
    await withLongGame(page, size)

    expect(await pageOverflow(page)).toBe(0)

    const list = page.getByTestId('move-list')
    const metrics = await list.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      // The old fixed cap, computed. `none` is the point: the height now
      // comes from the panel, not from a constant in the stylesheet.
      maxHeight: getComputedStyle(el).maxHeight,
    }))
    expect(metrics.overflowY).toBe('auto')
    expect(metrics.maxHeight).toBe('none')
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

    // ...and it is genuinely usable, not a technically-scrolling sliver:
    // at least six move rows, which is the floor the plan's ruling names.
    const row = await page.getByTestId('move-1').evaluate((el) => el.getBoundingClientRect().height)
    expect(metrics.clientHeight / row).toBeGreaterThan(6)

    // Both columns end inside the viewport, which is the whole point.
    for (const selector of ['.left-column', '.right-column']) {
      const box = await page.locator(selector).boundingBox()
      if (!box) throw new Error(`${selector} has no bounding box`)
      expect(box.y + box.height, `${selector} bottom edge`).toBeLessThanOrEqual(size.height)
    }
  })
}

// Red before this task: reaching ply 140 meant scrolling the DOCUMENT
// (the list stopped at its 420px cap and the rest of the column ran off
// the bottom of the page), so `window.scrollY` ended up non-zero and the
// board scrolled out from under the reader.
test('reaching the last move, and jumping back to the first, never scrolls the page', async ({
  page,
}) => {
  await withLongGame(page, { width: 1440, height: 800 })

  const list = page.getByTestId('move-list')
  await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  const last = page.getByTestId('move-140')
  await expect(last).toBeInViewport()
  await last.click()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // Home is the move list's own keyboard jump to the start of the game
  // (useShortcuts). The panel keeps its scroll; the page still has none.
  await page.keyboard.press('Home')
  // Ply 0: the board is back at the start and no move carries the
  // current-ply highlight any more.
  await expect(page.locator('.move-list .move.current')).toHaveCount(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await pageOverflow(page)).toBe(0)
})

// The move preview is `position: fixed` and places itself from the
// anchor row's viewport rect, so it had to be re-checked against a panel
// that scrolls. Red before this task's MovePreview.tsx change: the
// popover placed itself once, on hover/focus, and a scroll of the panel
// left it stranded at its old viewport position while the move it points
// at slid away underneath (measured: anchor top 537.8 -> 417.8 with the
// popover still at 539.8). Focus, not hover, because scrolling the list
// under a stationary cursor moves a DIFFERENT move under it.
test('the move preview follows its move when the panel scrolls', async ({ page }) => {
  await withLongGame(page, { width: 1440, height: 800 })

  const anchor = page.getByTestId('move-6')
  await anchor.focus()
  const preview = page.getByTestId('move-preview')
  await expect(preview).toBeVisible()

  const gap = async () => {
    const a = await anchor.boundingBox()
    const p = await preview.boundingBox()
    if (!a || !p) throw new Error('move-6 or its preview has no bounding box')
    return { offset: Math.abs(p.y - a.y), anchorY: a.y }
  }

  const before = await gap()
  expect(before.offset).toBeLessThan(8)

  await page.getByTestId('move-list').evaluate((el) => el.scrollTo({ top: 120 }))
  // Polled, not read once: the popover re-places itself from a scroll
  // listener through React state, so it catches up a render later rather
  // than synchronously with the scroll. Without the fix this never
  // converges — measured, it stays 122px adrift, which is the 120px of
  // scroll plus the 2px the popover sits above its row.
  await expect.poll(async () => (await gap()).offset).toBeLessThan(8)
  // ...and the anchor really did move that far, so the assertion above is
  // about the popover tracking it and not about nothing having happened.
  const after = await gap()
  expect(Math.abs(after.anchorY - before.anchorY)).toBeGreaterThan(50)
})

// The explorer's results used to stop at `max-height: 280px`, which kept
// the detail block underneath it on screen. Now that the cap is gone,
// the results take the panel's leftover height and scroll there — the
// detail has to stay pinned below, not scroll away with them.
test('the explorer results scroll inside the panel with the detail pinned below', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('tab-explorer').click()

  const results = page.locator('.explorer-results')
  await expect(results.locator('button').first()).toBeVisible()
  await results.locator('button').first().click()

  const detail = page.locator('.explorer-detail')
  await expect(detail).toBeVisible()

  const metrics = await page.evaluate(() => {
    const panel = document.querySelector('.tab-panel:not([hidden])')
    const list = document.querySelector('.explorer-results')
    const det = document.querySelector('.explorer-detail')
    if (!panel || !list || !det) return null
    return {
      listScrolls: list.scrollHeight > list.clientHeight + 1,
      panelScrolls: panel.scrollHeight > panel.clientHeight + 1,
      detailBottom: det.getBoundingClientRect().bottom,
      panelBottom: panel.getBoundingClientRect().bottom,
    }
  })
  if (!metrics) throw new Error('explorer panel, results or detail missing')
  expect(metrics.listScrolls).toBe(true)
  expect(metrics.panelScrolls).toBe(false)
  expect(metrics.detailBottom).toBeLessThanOrEqual(metrics.panelBottom + 1)
  expect(await pageOverflow(page)).toBe(0)
})

// `.history-list` lost its own `max-height: 420px` too. Entries are
// stored newest-FIRST (storage.ts's addHistoryEntry prepends), so the
// one thing shrinking this list must never do is push the most recent
// game out of sight: it lives at scrollTop 0. Seeded through
// localStorage because the alternative is playing a dozen games out.
test('the history list scrolls inside the panel with the newest game on top', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.addInitScript(() => {
    const games = Array.from({ length: 14 }, (_, i) => ({
      id: `seed-${i}`,
      date: new Date(Date.UTC(2026, 0, 14 - i)).toISOString(),
      result: i === 0 ? '1-0' : '0-1',
      termination: 'normal',
      opening: `Seeded opening ${i}`,
      pgn: '1. e4 e5 *',
      accuracy: null,
      white: 'You',
      black: 'Engine',
    }))
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 1, games }))
  })
  await page.goto('/')
  await page.getByTestId('tab-history').click()

  const entries = page.getByTestId('history-entry')
  await expect(entries).toHaveCount(14)
  // Newest first, and visible without scrolling anything.
  await expect(entries.first()).toContainText('Seeded opening 0')
  await expect(entries.first()).toBeInViewport()

  const list = page.getByTestId('history-list')
  const metrics = await list.evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight + 1,
    scrollTop: el.scrollTop,
    maxHeight: getComputedStyle(el).maxHeight,
  }))
  expect(metrics.maxHeight).toBe('none')
  expect(metrics.scrolls).toBe(true)
  expect(metrics.scrollTop).toBe(0)
  expect(await pageOverflow(page)).toBe(0)
})

// The left column gets the same treatment, and at 1280x720 it is the one
// that needs it: a 70-move game's captured card takes it to 613px
// against a 598px cap. The accepted cost (see the plan's decisions) is a
// small in-column scroll to reach Hint — strictly better than the page
// scroll it replaces, which moved the board too.
test('at 1280x720 a long game scrolls the left column, not the page', async ({ page }) => {
  await withLongGame(page, { width: 1280, height: 720 })

  const column = page.locator('.left-column')
  const metrics = await column.evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight + 1,
    overflowY: getComputedStyle(el).overflowY,
  }))
  expect(metrics.overflowY).toBe('auto')
  expect(metrics.scrolls).toBe(true)

  const boardTop = async () => (await page.locator('.board').boundingBox())?.y

  const before = await boardTop()
  await column.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(page.getByTestId('hint')).toBeInViewport()
  // The board did not move, and neither did the page.
  expect(await boardTop()).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await pageOverflow(page)).toBe(0)
})

/* --------------------------------------------------------------------
   Task 5, fix round 1: the explorer's results list needs a floor.

   Dropping `max-height: 280px` left `.explorer-results` as the only
   child of `.explorer` that can give — `.explorer-detail` is `flex:
   none` at a natural 97px — so it absorbed the whole shortfall by
   itself. Measured before `min-height: 90px`: 55.7px at 1280x720,
   3.7px at 1366x668, and a flat 0px at 1440x660 and below, where
   `clientHeight` is 0 and the list cannot even be scrolled. `.tabs`'
   own 160px floor does nothing about it, because the fixed detail
   block eats the panel whatever height the card has.

   1366x768 is a mainstream laptop; its inner height once browser
   chrome is taken off is around 668, which is why that is the size
   below.
   -------------------------------------------------------------------- */
for (const size of [
  { width: 1366, height: 668 },
  { width: 1440, height: 600 },
]) {
  test(`the explorer results stay usable and scrollable at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await coachOffline(page)
    await page.setViewportSize(size)
    await page.goto('/')
    await page.getByTestId('tab-explorer').click()

    const results = page.locator('.explorer-results')
    const firstRow = results.locator('button').first()
    await expect(firstRow).toBeVisible()
    await firstRow.click()
    await expect(page.locator('.explorer-detail')).toBeVisible()

    const rowHeight = await firstRow.evaluate((el) => el.getBoundingClientRect().height)
    const metrics = await results.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }))

    // The bug this pins: clientHeight 0 is a list that cannot be scrolled
    // at all, whatever is in it.
    expect(metrics.clientHeight).toBeGreaterThan(0)
    // Three rows, which is the floor's stated value.
    expect(metrics.clientHeight / rowHeight).toBeGreaterThanOrEqual(3)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    // The first row is whole, not sliced by the list's own edge.
    const rowBox = await firstRow.boundingBox()
    const listBox = await results.boundingBox()
    if (!rowBox || !listBox) throw new Error('explorer results or first row has no bounding box')
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1)

    // And the overflow goes where it is supposed to: into the panel, not
    // into the page.
    const panelScrolls = await page.evaluate(() => {
      const panel = document.querySelector('.tab-panel:not([hidden])')
      return panel ? panel.scrollHeight > panel.clientHeight + 1 : null
    })
    expect(panelScrolls).toBe(true)
    expect(await pageOverflow(page)).toBe(0)
  })
}

/* ====================================================================
   Task 6: the mobile pass, plus two items ruled over from Task 5 —
   auto-scrolling the move list to the current ply, and a scroll
   affordance on `.left-column`.
   ==================================================================== */

/**
 * The brief's own target: "the status row, the board, and the primary
 * actions (undo, hint)" fit above the fold at 375x812; everything else is
 * allowed to scroll. Red before this task: Controls sat AFTER
 * Clocks/Captured/Scoreboard in `.left-column` (Task 2's order), and while
 * that measured in bounds too, the brief calls for Controls to lead —
 * "status -> board -> controls -> clocks/captured/score -> tabs" — which
 * only `.left-column .controls { order: -1 }` (app.css) delivers.
 */
test('at 375x812, the board and the primary actions are above the fold', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')

  const board = await page.locator('.board').boundingBox()
  if (!board) throw new Error('.board has no bounding box')
  expect(board.width).toBeGreaterThanOrEqual(300)
  expect(board.y).toBeGreaterThanOrEqual(0)
  expect(board.y + board.height).toBeLessThanOrEqual(812)

  for (const id of ['undo', 'hint']) {
    const box = await page.getByTestId(id).boundingBox()
    if (!box) throw new Error(`[data-testid="${id}"] has no bounding box`)
    expect(box.y, `${id}.y`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${id} bottom edge`).toBeLessThanOrEqual(812)
  }

  // And Controls really does lead the column — Clocks (the next card) is
  // BELOW the fold-worthy stuff, not above it.
  const controlsTop = (await page.locator('.controls').boundingBox())?.y
  const clocksTop = (await page.locator('.clocks').boundingBox())?.y
  if (controlsTop === undefined || clocksTop === undefined) throw new Error('missing bounding box')
  expect(controlsTop).toBeLessThan(clocksTop)
})

// Red before this task at any of these (a fixed 232px/280px side-column
// pair, or an un-collapsed New game card, was never tuned for a phone this
// narrow): the brief calls for zero horizontal scroll at 320/375/414/430.
for (const width of [320, 375, 414, 430]) {
  test(`no horizontal page scroll at ${width}px wide`, async ({ page }) => {
    await coachOffline(page)
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await page.getByTestId('undo').waitFor()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `${width}px: scrollWidth - innerWidth`).toBe(0)
  })
}

/**
 * New game is the entry point to every session on desktop (a prior binding
 * ruling — task-6-report.md) and stays inline there; below 900px it
 * collapses into a popover, exactly like Game file. Red before this task:
 * `NewGame` rendered inline unconditionally at every width, so `mode`
 * would already be in the document at 500px with no `new-game-toggle`
 * anywhere, and `new-game` (the popover's OWN accordion) is unrelated to
 * this).
 */
test('New game is inline at 900px and wider, and a popover below it', async ({ page }) => {
  await coachOffline(page)

  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('mode')).toBeVisible()
  await expect(page.getByTestId('new-game-toggle')).toHaveCount(0)

  await page.setViewportSize({ width: 899, height: 800 })
  // A resize alone has to flip it — useMediaQuery's `change` listener, not
  // just the initial mount.
  await expect(page.getByTestId('new-game-toggle')).toBeVisible()
  await expect(page.getByTestId('mode')).toHaveCount(0)

  await page.getByTestId('new-game-toggle').click()
  const popover = page.getByTestId('new-game-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('mode')).toBeVisible()

  // Starting a game closes the popover behind it, same as Game file
  // closing on a successful import.
  await popover.getByTestId('new-game').click()
  await expect(popover).toHaveCount(0)

  // Red before the fix (`close(true)`, not `close(false)`, in
  // NewGameControl.tsx): the click that starts the game lands on a button
  // INSIDE the popover, and the very next render removes that button (and
  // the popover) from the DOM — measured, focus landed on `<body>` there,
  // the same hole `usePopover`'s own focusout guard and `documentEscape`
  // exist to close elsewhere in this file.
  await expect(page.getByTestId('new-game-toggle')).toBeFocused()
})

/**
 * Fix round 1, Critical: the FIRST version of the popover was
 * `position: absolute` inside `.new-game-anchor`, itself inside
 * `.right-column` — which Task 5 gave `overflow-y: auto`. An
 * absolutely-positioned descendant of a scrolling ancestor is clipped to
 * that ancestor's box; `z-index` does nothing about it. Measured live at
 * 899x800 on an idle game before this fix: `.right-column` `clientHeight`
 * 117 against `scrollHeight` 455, the popover 412px tall with only 73.8px
 * of it inside the clip, and the Start button 213.8px outside it —
 * `document.elementFromPoint` at its centre resolved to the `.layout` div
 * behind it, not the button. `toBeVisible()` alone does not catch this
 * (it checks the bounding box and `visibility`, not ancestor-overflow
 * clipping), and Playwright's own `.click()` auto-scrolls the clipping
 * ancestor before clicking, which is exactly why the pre-fix version of
 * "New game is inline at 900px..." above passed anyway — a real tap
 * would not have reached it. `elementFromPoint` is what actually proves
 * the button is reachable.
 */
for (const size of [
  { width: 899, height: 800 },
  { width: 800, height: 800 },
  { width: 769, height: 700 },
]) {
  test(`the New game popover is not clipped at ${size.width}x${size.height}`, async ({ page }) => {
    await coachOffline(page)
    await page.setViewportSize(size)
    await page.goto('/')
    await page.getByTestId('new-game-toggle').click()

    const popover = page.getByTestId('new-game-popover')
    await expect(popover).toBeVisible()
    const popoverBox = await popover.boundingBox()
    if (!popoverBox) throw new Error('new-game-popover has no bounding box')
    expect(popoverBox.y, 'popover top').toBeGreaterThanOrEqual(0)
    expect(popoverBox.y + popoverBox.height, 'popover bottom').toBeLessThanOrEqual(size.height)
    expect(popoverBox.x, 'popover left').toBeGreaterThanOrEqual(0)
    expect(popoverBox.x + popoverBox.width, 'popover right').toBeLessThanOrEqual(size.width)

    const start = popover.getByTestId('new-game')
    const hit = await start.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const atCentre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return atCentre === el || (el.contains(atCentre) ?? false)
    })
    expect(hit, 'Start button is hit-testable at its own centre').toBe(true)
  })
}

// Minor #5: at 375x812 the reviewer measured the popover opening straight
// below the trigger and mostly off-screen (105.8/412px visible, 306px of
// further page scroll needed). Fixed by anchoring upward when the trigger
// sits in the lower half of the viewport (NewGameControl.tsx's `place()`).
//
// Task 7 fix: this test used to open the popover from a fresh page load
// with no explicit scroll setup, then only assert that the result FIT the
// viewport — never that it actually went upward. On a fresh load the
// trigger sits entirely below the 812px fold (measured live: its
// document top is 914px), so `page.getByTestId(...).click()` has to
// auto-scroll it into view first — and measured live, that auto-scroll
// lands the trigger at the BOTTOM edge of the viewport (y ~= 777, well
// into the lower half), so this test happened to exercise the upward
// path anyway, but by accident of Playwright's own scroll-into-view
// behaviour, not by anything the test itself set up or checked. Scrolling
// explicitly here (and asserting the precondition) makes the case this
// test's name promises reproducible on its own terms, and the new
// popover-bottom-above-trigger-top assertion is what actually
// distinguishes "opened upward" from "opened downward but still fits".
test('at 375x812 the New game popover opens upward when the trigger sits in the lower half of the viewport', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByTestId('new-game-toggle').waitFor()

  await page.evaluate(() => window.scrollTo({ top: 300 }))
  const anchor = await page.getByTestId('new-game-toggle').boundingBox()
  if (!anchor) throw new Error('new-game-toggle has no bounding box')
  expect(anchor.y, 'precondition: trigger sits in the lower half of the viewport').toBeGreaterThan(812 / 2)

  await page.getByTestId('new-game-toggle').click()

  const popover = page.getByTestId('new-game-popover')
  const box = await popover.boundingBox()
  if (!box) throw new Error('new-game-popover has no bounding box')
  expect(box.y, 'popover top').toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, 'popover bottom').toBeLessThanOrEqual(812)
  // Genuinely upward, not merely on-screen: the popover's own bottom edge
  // sits at or above the trigger's own top edge.
  expect(box.y + box.height, 'popover bottom sits above the trigger').toBeLessThanOrEqual(anchor.y)
  // The whole point of anchoring upward: no further scroll needed to reach
  // the submit button.
  await expect(popover.getByTestId('new-game')).toBeInViewport()
})

// Important #2: resizing past 900px with the popover open used to strand
// it — the `!mobile` branch drops the popover's markup but never told
// `usePopover` it had closed, so `overlayOpen` (App.tsx) stayed pinned
// true and every keyboard shortcut died until the next click anywhere.
// Red before the `useEffect(() => { if (!mobile && open) close(false) },
// ...)` guard in NewGameControl.tsx.
test('resizing past 900px with the New game popover open releases the keyboard', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 500, height: 900 })
  await page.goto('/')
  await page.getByTestId('new-game-toggle').click()
  await expect(page.getByTestId('new-game-popover')).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByTestId('new-game-popover')).toHaveCount(0)
  await expect(page.getByTestId('mode')).toBeVisible()

  await page.keyboard.press('f')
  await expect(page.getByTestId('board-frame')).toHaveClass(/black/)
})

/* --------------------------------------------------------------------
   Additional item A: the move list auto-scrolls to the current ply.

   Never built before this task (Task 5 measured no `scrollIntoView`
   anywhere in src/) — genuinely missing, not a regression — but Task 5
   made the absence far more noticeable: ~14 visible pairs shrank to
   ~7-8, with no page scrollbar left to hint "there is more here".
   -------------------------------------------------------------------- */

// Red before this task: importing 140 plies left the moves panel's
// scrollTop at 0, so the current move (the last one played) sat off the
// bottom of a ~206px-tall panel, unreachable without the reader
// scrolling it themselves.
test('importing a long game scrolls the moves panel to the current ply', async ({ page }) => {
  await withLongGame(page, { width: 1440, height: 800 })

  const current = page.locator('.move-list .move.current')
  await expect(current).toHaveText('Kg1')
  await expect(current).toBeInViewport()
})

// Fix round 1, item 3: the auto-scroll used to walk ancestors via the
// native `Element.scrollIntoView`, including `.right-column` on a short
// viewport; it now writes only `.move-list`'s own `scrollTop`, computed
// from `offsetTop` (see MoveList.tsx). This test now asserts something
// stronger than "the board and page didn't move": that `.right-column`'s
// OWN scrollTop is untouched too — the scroll happened in exactly one
// place, not merely without visible side effects two ancestors up.
test('jumping to a far-away ply scrolls only the moves panel, never an ancestor, the board or the page', async ({
  page,
}) => {
  await withLongGame(page, { width: 1280, height: 720 })

  const list = page.getByTestId('move-list')
  const rightColumn = page.locator('.right-column')
  await list.evaluate((el) => el.scrollTo({ top: 0 }))
  const boardBefore = await page.locator('.board').boundingBox()
  if (!boardBefore) throw new Error('.board has no bounding box')
  const rightColumnScrollBefore = await rightColumn.evaluate((el) => el.scrollTop)

  // Home: jump to the very start (ply 0) with the panel scrolled to the
  // opposite end — nothing to auto-scroll TO (no move carries `.current`),
  // so this leg is really about the jump below not disturbing anything.
  await page.keyboard.press('Home')
  await expect(page.locator('.move-list .move.current')).toHaveCount(0)

  // End: back to the last move, from the panel's top — this is the leg
  // that actually exercises the auto-scroll.
  await page.keyboard.press('End')
  const current = page.locator('.move-list .move.current')
  await expect(current).toBeInViewport()
  // The list really did scroll — the assertion below is about WHERE the
  // scroll happened, not about nothing having happened at all.
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  const boardAfter = await page.locator('.board').boundingBox()
  if (!boardAfter) throw new Error('.board has no bounding box')
  expect(boardAfter.x).toBe(boardBefore.x)
  expect(boardAfter.y).toBe(boardBefore.y)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await pageOverflow(page)).toBe(0)
  expect(await rightColumn.evaluate((el) => el.scrollTop)).toBe(rightColumnScrollBefore)
})

// `prefers-reduced-motion` is satisfied by construction (the scroll is
// always instant — see MoveList.tsx's own comment on why), but this pins
// that the feature still WORKS under it, rather than merely not crashing.
test('the auto-scroll still lands on the current ply under prefers-reduced-motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await withLongGame(page, { width: 1440, height: 800 })

  await expect(page.locator('.move-list .move.current')).toBeInViewport()
})

// Originally red under the first version of the auto-scroll (native
// `Element.scrollIntoView`, which walks every scrollable ANCESTOR): below
// 768px `.right-column` gives up its own cap/scroll (Task 5's mobile
// override), so the walk had nothing to stop at before the PAGE itself,
// which genuinely can scroll there. Measured live: playing a move while
// the (default-active) Moves tab held a move off-panel yanked
// `window.scrollY` from 0 to over 300px — moving the board out from under
// whatever the reader was just doing on it, exactly what
// tests/e2e/touch-drag.spec.ts's "no page scroll" assertion caught this
// with in practice. Fix round 1, item 3 replaced that with a container-
// local `list.scrollTop` write (MoveList.tsx) that structurally cannot
// reach an ancestor at any width, which is what this test now guards —
// kept rather than deleted, since "never touches the page" is worth
// pinning at the one width where the page is SUPPOSED to be able to
// scroll (everywhere else, Task 5 already guarantees it can't).
test('at 375x812, playing a move never scrolls the page even though the moves tab is active', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByTestId('tab-moves')).toHaveAttribute('aria-selected', 'true')

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')

  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

/* --------------------------------------------------------------------
   Additional item B: the left column's scroll affordance.
   -------------------------------------------------------------------- */

// Red before this task: `.left-column` has no `mask-image` rule at all,
// so `getComputedStyle` reports 'none' regardless of overflow, and the
// Controls card is simply sliced flat at the column's bottom edge.
test('the left column fades at the bottom only while there is more to scroll to', async ({
  page,
}) => {
  await withLongGame(page, { width: 1280, height: 720 })

  const column = page.locator('.left-column')
  await expect(column).toHaveAttribute('data-fade-bottom', '')
  const maskImage = await column.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)
  expect(maskImage).not.toBe('none')

  // Scrolled all the way down: nothing left below, so the affordance lifts.
  await column.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(column).not.toHaveAttribute('data-fade-bottom', '')

  // ...and back up, it returns.
  await column.evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(column).toHaveAttribute('data-fade-bottom', '')
})

// The column that does NOT overflow (an idle, empty game) must never carry
// the affordance — otherwise it would misreport "there is more below" on
// a card that is simply sitting there whole.
test('the left column never fades when its content already fits', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('undo').waitFor()

  await expect(page.locator('.left-column')).not.toHaveAttribute('data-fade-bottom', '')
})

/* ====================================================================
   Task 7: the fold regression net, plus three carried items.

   Everything below is new in this task. Tasks 1-6 each pinned the
   mechanism THEY changed, at the sizes that mechanism happened to need;
   this section owns the full viewport matrix and the full id sweep the
   brief calls for, corrected against what NewGameControl.tsx and
   GameFilePopover.tsx actually render today (the brief predates both
   popovers) rather than the brief's own stale id list.

   Breaking change this whole section exists to catch: adding any card
   back into `.board-column` turns this red — verified live (injecting a
   400px div there produced 348px of overflow and exactly one failure
   across the specs in this file, the right one).

   Fix round 1 correction: restoring a fixed `max-height` on the tab panel
   does NOT turn THIS matrix red, and an earlier draft of this comment
   claimed it would — verified live, and the full story is more precise
   than a flat "leaves everything green":

   - `.tabs { max-height: 480px }` alone: every test in this file stays
     green, no exceptions.
   - `.move-list { max-height: 420px }` alone (the exact historical value
     `.move-list`'s own app.css comment names): the page-scroll matrix
     ITSELF still stays green — `pageOverflow` is still 0 — but a
     different, pre-existing test earlier in this file ("with a 70-move
     game ..., the moves list scrolls and the page does not") fails, on
     purpose and for an unrelated, correct reason: it separately pins
     `.move-list`'s own computed `max-height` as `'none'`, i.e. that THIS
     list no longer uses a fixed cap at all — restoring one is exactly
     the regression that test exists to catch, and it does, just not via
     a page overflow.

   Either way, the page itself does not scroll, because `.right-column`'s
   OWN `max-height: var(--board-size)` / `overflow-y: auto` cap (below)
   is what actually absorbs a fixed cap on `.tabs` or `.move-list` today
   — it just makes `.right-column` grow an internal scrollbar instead,
   invisible to `document.documentElement.scrollHeight` (the tab header
   stays `flex: none` and visible regardless, so nothing above the fold
   moves either). `.right-column`'s cap is what is actually load-bearing
   for THIS matrix; it is pinned directly, by computed style, in the very
   next test — removing IT (not `.tabs`'s own sizing) is what reproduces
   a page overflow again: verified both alone (1811px, with neither inner
   cap restored — nothing bounds `.tabs`'s growth any more) and combined
   with both inner fixed caps restored (138px — smaller because the inner
   caps at least bound how far `.tabs` grows, but still real overflow).
   A cap severe enough to clip the tab header itself (`.tabs { max-height:
   20px }`) does still fail the id sweep's hit-test below, by a different,
   correct route. No test is added for the moderate, harmless `.tabs`
   case, nor for the "harmless to THIS matrix, but a distinct test
   already catches it" `.move-list` case — asserting that something
   harmless is harmless, or duplicating a check that already exists, is
   noise.
   ==================================================================== */

/**
 * Fix round 1: nothing above tested `.right-column`'s own cap directly —
 * only incidentally, via the matrix, if someone removed it entirely. Two
 * mechanisms now exist for the same invariant: `.tabs`'s flex-shrink
 * (the preferred path — no scrollbar appears in the common case) and
 * `.right-column`'s `max-height`/`overflow-y: auto` backstop (what
 * actually still holds the line if the preferred path is ever reverted,
 * per the banner correction above). Computed style, not stylesheet
 * source text, so a refactor that moves the declaration under a
 * different selector but keeps the effect still passes, and a refactor
 * that drops the EFFECT fails whether or not some rule still "looks"
 * present in a text diff. Cross-checked against `.left-column`'s own
 * cap rather than a hardcoded number: both derive from the same
 * `var(--board-size)`, so if they ever disagree, the point of a shared
 * token has already been lost.
 *
 * Red before this fix: temporarily deleted `.right-column`'s own
 * `max-height: var(--board-size);` declaration (app.css) — this test
 * failed on `.right-column max-height` (`none` !== the `.left-column`
 * figure); separately, with that deletion in place, "the page never
 * scrolls" reappeared too (measured live: 1811px of overflow at 1440x800
 * with a long game imported and no other change, or 138px with both
 * `.tabs`'s and `.move-list`'s fixed caps restored alongside it —
 * smaller because those caps at least bound how far `.tabs` grows, but
 * still real overflow either way), confirming the cap is not merely
 * present but load-bearing.
 */
test("the right column's own height cap is what keeps a tall tab panel from pushing the page, not the tab panel's own sizing", async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('undo').waitFor()

  const [rightColumn, leftColumn] = await Promise.all([
    page.locator('.right-column').evaluate((el) => {
      const s = getComputedStyle(el)
      return { maxHeight: s.maxHeight, overflowY: s.overflowY }
    }),
    // Same `var(--board-size)` source as `.right-column` — the
    // cross-check that this is genuinely bound to the shared token, not
    // some other number that happens to match today.
    page.locator('.left-column').evaluate((el) => getComputedStyle(el).maxHeight),
  ])

  expect(rightColumn.overflowY, '.right-column overflow-y').toBe('auto')
  expect(rightColumn.maxHeight, '.right-column max-height').not.toBe('none')
  expect(rightColumn.maxHeight, '.right-column max-height matches .left-column, the same var(--board-size)').toBe(
    leftColumn,
  )
})

/**
 * `scrollHeight <= innerHeight + 1` (the +1 absorbs sub-pixel rounding —
 * the brief's own tolerance), asserted on a fresh load AND with LONG_GAME
 * (the 70-move/140-ply fixture the rest of this file already uses)
 * imported — the brief calls for "a 60-move game imported"; this reuses
 * the one long-game fixture already established above rather than adding
 * a second one that exists only to be nominally closer to "60".
 */
async function assertPageNeverScrolls(page: Page, size: { width: number; height: number }): Promise<void> {
  await coachOffline(page)
  await page.setViewportSize(size)
  await page.goto('/')
  await page.getByTestId('undo').waitFor()
  expect(await pageOverflow(page), `${size.width}x${size.height}, fresh load`).toBeLessThanOrEqual(1)

  await importGame(page, LONG_GAME)
  await expect(page.getByTestId('ply-count')).toHaveText('140')
  expect(await pageOverflow(page), `${size.width}x${size.height}, long game imported`).toBeLessThanOrEqual(1)
}

// The brief's own four viewports.
for (const size of [
  { width: 1280, height: 720 },
  { width: 1440, height: 800 },
  { width: 1512, height: 860 },
  { width: 1920, height: 1080 },
]) {
  test(`the page never scrolls at ${size.width}x${size.height}, fresh and with a long game imported`, async ({
    page,
  }) => {
    await assertPageNeverScrolls(page, size)
  })
}

/**
 * The brief called out "zero margin at 1280x720" as though it were a
 * special case. It is not: `--board-size` (app.css's `.layout`) is
 * `clamp(360px, min(640px, calc(100svh - 122px)), 640px)`, so wherever
 * the middle term wins the clamp — every viewport HEIGHT from 482
 * (360+122, the floor) to 762 (640+122, the cap) — the page is exactly
 * `100svh` tall the instant either side column reaches its own
 * `max-height: var(--board-size)` cap, at any width wide enough for the
 * inline (>=900px) desktop layout. 1280x720 is one point 40px inside that
 * 280px-wide band; sampling only it would say nothing about the other
 * 279px of it. Sampled at a fixed width (1440, matching the rest of this
 * file) across the band, per the task: 760, 700, 620 and 500 — the last
 * one past the 482px edge, where `--board-size` is pinned at its own
 * 360px floor instead of tracking height any more, which is its own
 * separate thing worth a sample.
 */
for (const height of [760, 700, 620, 500]) {
  test(`the page never scrolls at 1440x${height} (the zero-margin band), fresh and with a long game imported`, async ({
    page,
  }) => {
    await assertPageNeverScrolls(page, { width: 1440, height })
  })
}

/**
 * The full id sweep, at 1440x800 — the brief's own chosen size for it,
 * corrected against what actually renders there today: at 1440px
 * (>=900px wide), `mode`/`level`/`color`/`time-control`/`new-game`/
 * `open-puzzles` render INLINE (NewGameControl's own
 * `useMediaQuery('(max-width: 899px)')`), not behind a popover — the
 * popover trigger (`new-game-toggle`) does not even exist at this width.
 * `export-pgn`/`share-link`/`import-text`/`import-file`/`import-submit`
 * live inside the Game file popover at every width (GameFilePopover.tsx
 * has no width-conditional branch) — swept separately below, for their
 * own one-click reachability rather than raw geometry, since opening that
 * popover reflows nothing else on the page but is a precondition these
 * other ids don't share.
 *
 * Bounding-box-inside-viewport is necessary but not sufficient (ruling:
 * "a test that cannot fail is worse than no test" — Task 6 shipped a
 * `toBeVisible()` popover check that could not see a popover clipped to
 * 18% of its height by an ancestor's `overflow`, because `toBeVisible()`
 * ignores ancestor-overflow clipping, and Playwright's own `.click()`
 * auto-scrolls the clipping ancestor before landing, masking exactly this
 * failure — see this file's "the New game popover is not clipped" tests).
 * Both side columns have their own `overflow-y: auto` (Task 5), so the
 * same failure mode is possible here even though every one of these ids
 * sits in plain document flow, never a portal — `document.elementFromPoint`
 * at each control's own centre is what a real tap actually resolves to,
 * checked alongside the bounding box for exactly that reason.
 */
test('at 1440x800, every top-level control is inside the viewport and hit-testable', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('undo').waitFor()

  const ids = [
    'undo',
    'redo',
    'flip',
    'resign',
    'pause',
    'step',
    'speed',
    'hint',
    'mode',
    'level',
    'color',
    'time-control',
    'new-game',
    'open-puzzles',
    'tab-moves',
    'tab-explorer',
    'tab-review',
    'tab-history',
    'shortcuts-toggle',
    'settings-toggle',
    'game-file-toggle',
  ]

  for (const id of ids) {
    const locator = page.getByTestId(id)
    const box = await locator.boundingBox()
    if (!box) throw new Error(`[data-testid="${id}"] has no bounding box`)
    expect(box.y, `${id}.y`).toBeGreaterThanOrEqual(0)
    expect(box.x, `${id}.x`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${id} bottom edge`).toBeLessThanOrEqual(800)
    expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(1440)

    const hit = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const atCentre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return atCentre === el || (el.contains(atCentre) ?? false)
    })
    expect(hit, `${id} is hit-testable at its own centre`).toBe(true)
  }
})

// The five Game file ids: reachable in exactly one click from the header
// (`game-file-toggle`) — GameFilePopover has no width-conditional branch,
// so this holds at every width, checked here at the same 1440x800 as the
// sweep above.
test('export-pgn, share-link, import-text, import-file and import-submit are reachable in exactly one click', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')

  await page.getByTestId('game-file-toggle').click()
  for (const id of ['export-pgn', 'share-link', 'import-text', 'import-file', 'import-submit']) {
    await expect(page.getByTestId(id), `${id} reachable in one click`).toBeVisible()
  }
})

/* --------------------------------------------------------------------
   Additional item A: clamp the New game popover into the viewport.

   NewGameControl.tsx's `place()` computed a direction (up/down) and a
   `maxHeight` from the TRIGGER's own `getBoundingClientRect()` alone, and
   never re-checked the result against the viewport once computed. That
   is fine as long as the trigger's own rect is inside the viewport when
   `place()` runs — but `place()` re-runs on every scroll (capture
   phase), and a scroll can carry the trigger anywhere, including below
   the viewport's bottom edge, before the next run.
   -------------------------------------------------------------------- */

// Red before the final clamp in NewGameControl.tsx's `place()` (the
// `Math.min(Math.max(top, MARGIN), ...)` pass at the end, working off the
// popover's own `maxHeight` rather than the anchor's rect): open the
// popover while scrolled down (the trigger sits in the lower half of the
// viewport there, so it opens upward, correctly), then wheel-scroll the
// PAGE back to the top — the trigger's viewport rect moves DOWN with it
// (it is below the popover's own trigger row in document order), past
// `window.innerHeight` entirely, and the un-clamped upward math placed
// the popover's own bottom edge measurably past the viewport's bottom
// (measured live before the fix: 51.5px past it) — Start was still
// reachable; the Done row below it was not.
test('scrolling the page after the New game popover opens keeps it inside the viewport', async ({ page }) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByTestId('new-game-toggle').waitFor()

  // Scrolled down enough that the trigger sits in the lower half of the
  // viewport (opens upward) but is not yet clipped by the fold.
  await page.evaluate(() => window.scrollTo({ top: 300 }))
  const anchorBefore = await page.getByTestId('new-game-toggle').boundingBox()
  if (!anchorBefore) throw new Error('new-game-toggle has no bounding box')
  expect(anchorBefore.y, 'precondition: trigger in the lower half').toBeGreaterThan(812 / 2)

  await page.getByTestId('new-game-toggle').click()
  const popover = page.getByTestId('new-game-popover')
  await expect(popover).toBeVisible()

  // The wheel-scroll: back to the very top. `place()`'s own scroll
  // listener re-runs synchronously with this (capture phase), but the
  // resulting React state update lands a render later — polled below,
  // not read once, for the same reason MovePreview's own re-place tests
  // poll rather than assert immediately.
  await page.evaluate(() => window.scrollTo({ top: 0 }))

  await expect.poll(async () => {
    const box = await popover.boundingBox()
    return box ? box.y + box.height : null
  }).toBeLessThanOrEqual(812)

  const box = await popover.boundingBox()
  if (!box) throw new Error('new-game-popover has no bounding box')
  expect(box.y, 'popover top').toBeGreaterThanOrEqual(0)
  expect(box.y + box.height, 'popover bottom').toBeLessThanOrEqual(812)

  // The RENDERED box alone is not a reliable proof: `.new-game-popover`
  // scrolls its own overflow (`overflow-y: auto`), so its actual on-screen
  // height is `min(content, maxHeight)` — today's content (~335px) is
  // short enough that the un-clamped bug (measured live: `top` computed
  // from a worst-case `maxHeight` of 560, landing the CSS-PERMITTED box
  // 51.5px past the viewport bottom) does not show up in the rendered box
  // at all, even though the placement math that produced it is exactly as
  // broken. Reading the inline `top`/`max-height` styles `place()` itself
  // wrote is what actually pins the contract — the box it tells the
  // browser it is allowed to grow to, not just how tall today's content
  // happens to make it.
  const worstCaseBottom = await popover.evaluate((el) => {
    const style = el.style
    return parseFloat(style.top) + parseFloat(style.maxHeight)
  })
  expect(worstCaseBottom, 'top + max-height (the CSS-permitted box)').toBeLessThanOrEqual(812)

  // Not merely in bounds on paper: the Done row (the part of the
  // regression that stayed unreachable even though Start still worked)
  // is genuinely reachable, hit-tested the way a real tap would find it.
  const done = page.getByTestId('new-game-popover-done')
  const hit = await done.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const atCentre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return atCentre === el || (el.contains(atCentre) ?? false)
  })
  expect(hit, 'Done is hit-testable at its own centre').toBe(true)
})

/* --------------------------------------------------------------------
   Additional item B: pin the mobile move-list auto-scroll.

   Task 6 fixed the auto-scroll being disabled below 768px, but the only
   mobile move-list test ("at 375x812, playing a move never scrolls the
   page even though the moves tab is active", above) asserts
   `window.scrollY === 0` after a single move — which the OLD, broken,
   guarded-off version of the auto-scroll also satisfied (one ply is
   already in view in a ~206px-tall panel; there is nothing for either
   version to scroll to). Genuinely exercising the fix needs a game long
   enough to overflow the panel, at the width the guard used to key off
   of.
   -------------------------------------------------------------------- */

// Red under the old `matchMedia('(max-width: 768px)')` early return this
// pins against (restored temporarily below to prove it — see
// task-7-report.md for the exact diff and the failure it produced):
// importing 140 plies would leave `.move-list`'s `scrollTop` at 0, so the
// current move (the last one played) sits off the bottom of the panel,
// out of view.
test('at 375x812, importing a long game scrolls the moves panel to the current ply', async ({ page }) => {
  await withLongGame(page, { width: 375, height: 812 })

  // Below 768px the Moves CARD sits further down the single-column page
  // (Task 6's mobile reorder: status -> board -> controls ->
  // clocks/captured/score -> tabs), not clipped to a scrolling ancestor —
  // reaching it at all needs a page scroll, same as a real reader would
  // do, which is a separate, expected thing from the bug this test pins
  // (the LIST failing to auto-scroll to the current ply once its card is
  // on screen). `scrollIntoViewIfNeeded` (a Playwright API, distinct from
  // the DOM's own `Element.scrollIntoView` this app deliberately never
  // calls — see MoveList.tsx and test-setup.ts) gets the card into the
  // page's own viewport first, the same way `tests/e2e/board-stacking-
  // order.spec.ts` and `drag-helpers.ts` already do elsewhere in this
  // suite.
  await page.getByTestId('move-list').scrollIntoViewIfNeeded()

  const current = page.locator('.move-list .move.current')
  await expect(current).toHaveText('Kg1')
  // In view inside the LIST specifically (`toBeInViewport()` is relative
  // to the top-level viewport, not merely truthy about visibility — see
  // the ruling on asserting things the way a user would experience them),
  // and the list's own `scrollTop` genuinely moved, not merely "happens
  // to already be in view" at scrollTop 0.
  await expect(current).toBeInViewport()
  const scrollTop = await page.getByTestId('move-list').evaluate((el) => el.scrollTop)
  expect(scrollTop, 'move-list.scrollTop').toBeGreaterThan(0)
})

/* --------------------------------------------------------------------
   CSS scroll anchoring: a header that changes height must not move the
   page under a reader who is scrolled into it.

   Found while fixing an unrelated Task 6 bug, and NOT introduced by any
   task in this plan — it predates the whole above-the-fold branch. The
   mechanism is Chromium's CSS scroll anchoring: at a nonzero
   `window.scrollY` the browser picks an anchor node among the viewport
   scroller's descendants (something visible near the top of the
   scrollport — on a phone, the board), and when layout moves that node it
   "compensates" by adjusting the scroll offset to hold it still. Anything
   in the header that changes height moves it: the opening name filling in
   (and wrapping to a second line) on move one, the engine-status spinner
   resolving, the coach badge appearing, the resume/share-conflict banners
   coming and going. The reader gets a page-and-board jump with no
   interaction of their own.

   The fix (app.css, `html, body { overflow-anchor: none }`) is at the
   SCROLL CONTAINER's scope, not on any one growing element. Measured,
   `.status-row { overflow-anchor: none }` does NOT fix this — 200 -> 229
   either way. `overflow-anchor: none` only excludes the element it is set
   on (and its subtree) from being chosen as the ANCHOR; `.status-row` is
   never the anchor here, it is the box whose growth displaces the anchor
   below it. No narrower element-level fix exists, because the anchor is
   whatever happens to be on screen — so the container is the right scope,
   and one rule there covers every growing element above it, present and
   future.

   `body` is the part that does the work: measured across both cases below,
   `html` alone fixes the growing one (200 -> 200) and leaves the shrinking
   one broken (200 -> 85). See app.css for why, and for why `html` is kept
   next to it anyway.

   The two tests deliberately use DIFFERENT elements — one inside
   `.status-row` growing, one banner above it leaving — because that is the
   claim being made: fixing this at the container's scope holds for
   elements the rule never mentions.
   -------------------------------------------------------------------- */

/**
 * Wait for the header to stop changing height on its own before measuring
 * anything. Two things in `.status-row` settle asynchronously after load
 * and would otherwise be measured mid-flight: the `engine-status` spinner
 * ("Loading engine…", present until the first handshake lands) and the
 * coach badge (`coachOffline` makes its arrival deterministic, but not
 * instant). Measured, skipping this wait is not merely flaky but actively
 * misleading: with the spinner still up the row already stands at its
 * two-line 119.48px, and the opening name then fills the space the
 * spinner vacates for a net delta of zero — the trigger under test
 * silently stops happening.
 */
async function settledHeader(page: Page): Promise<void> {
  await expect(page.locator('.board')).toBeVisible()
  await expect(page.getByTestId('engine-status')).toHaveCount(0)
  await expect(page.getByTestId('coach-badge')).toBeVisible()
}

/** Scroll the page down and report where it actually landed. */
async function scrollPageTo(page: Page, top: number): Promise<number> {
  await page.evaluate((y) => window.scrollTo(0, y), top)
  const landed = await page.evaluate(() => window.scrollY)
  // A page that cannot scroll makes every assertion below vacuous:
  // Chromium suppresses anchoring at offset 0, so the bug cannot show
  // there. Fail loudly rather than pass for the wrong reason.
  expect(landed, 'the page must actually scroll for this test to mean anything').toBeGreaterThan(0)
  return landed
}

const statusRowHeight = (page: Page) =>
  page.locator('.status-row').evaluate((el) => el.getBoundingClientRect().height)

test('the opening name filling in never moves the page under a reader scrolled into it', async ({
  page,
}) => {
  await coachOffline(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await settledHeader(page)

  const landed = await scrollPageTo(page, 200)
  const before = await statusRowHeight(page)

  // e4 c5 — the Sicilian, whose name is long enough to wrap `.status-row`
  // onto a second line at 375px wide (measured: 76.75px -> 119.48px).
  for (const [from, to] of [['e2', 'e4'], ['c7', 'c5']]) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
  await expect(page.getByTestId('opening')).toHaveText('B20 Sicilian Defense')
  await expect
    .poll(() => statusRowHeight(page), {
      message: '.status-row must actually grow, or this test proves nothing',
    })
    .toBeGreaterThan(before)

  expect(await page.evaluate(() => window.scrollY), 'window.scrollY after the status row grew').toBe(
    landed,
  )
})

test('a banner above the status row disappearing never moves the page under a reader scrolled into it', async ({
  page,
}) => {
  await coachOffline(page)
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({
        v: 2,
        pgn: '1. d4 d5 *',
        setup: {
          white: { kind: 'human' },
          black: { kind: 'human' },
          timeControl: { kind: 'untimed' },
        },
        scored: false,
      }),
    )
  })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/')
  await settledHeader(page)
  await expect(page.getByTestId('resume-banner')).toBeVisible()

  const landed = await scrollPageTo(page, 200)

  // `dispatchEvent`, not `click`: the button sits at the very top of the
  // page, and Playwright's own scroll-into-view for a real click would
  // move `window.scrollY` itself and destroy the measurement. What is
  // under test is the LAYOUT reaction to the banner leaving, which is the
  // same either way — and "a banner above me vanishes while I am looking
  // at the board" is exactly the no-interaction-of-their-own case. This
  // is the second, independent element in the test above's list: the
  // whole point of fixing this at the container's scope rather than on
  // `.status-row` is that it holds for a banner it never mentions.
  await page.getByTestId('resume-decline').dispatchEvent('click')
  await expect(page.getByTestId('resume-banner')).toHaveCount(0)

  expect(await page.evaluate(() => window.scrollY), 'window.scrollY after the banner left').toBe(
    landed,
  )
})
