# Mid-width Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Between 769 and 1020px wide, stack the page in portrait (board, clocks and Controls on
screen) and put one side panel beside the board in landscape (zero page scroll).

**Architecture:** CSS only, in `src/ui/app.css`: two new media blocks after the existing
`(max-width: 1020px)` structural block, keyed on `orientation`. New e2e spec
`tests/e2e/mid-width-layout.spec.ts`. No DOM, component or JS change.

**Tech Stack:** CSS grid, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-28-mid-width-layout-design.md`

## Global Constraints

- Scope `@media (min-width: 769px) and (max-width: 1020px)` only. Phones (≤768) and desktop (≥1021) unchanged.
- `NewGameControl.tsx`'s `(max-width: 1020px)` query is not touched.
- No DOM order or Tab order change; `order` only.
- Board floor 320px in both modes.
- Run e2e with `PW_PORT=5199` and prove the served tree (`lsof` the port's cwd).
- Stage explicit paths. Never commit `.claude/`, `.superpowers/`, `.env`.

---

### Task 1: Side-panel mode (landscape)

**Files:**
- Create: `tests/e2e/mid-width-layout.spec.ts`
- Modify: `src/ui/app.css` (new block after the `(min-width: 769px) and (max-width: 1020px)` block)
- Modify: `tests/e2e/above-the-fold.spec.ts` (the 769…1020 × 800 sweep: "stacked below" → "beside")

**Interfaces:**
- Produces: helpers `hitTestable(page, testId)`, `pageOverflow(page)`, `LONG_GAME` in the new spec (Task 2 reuses them).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline, importGame } from './helpers'

const LONG_GAME = /* copy verbatim from above-the-fold.spec.ts */ ''

const pageOverflow = (page: Page) =>
  page.evaluate(() => ({
    y: document.documentElement.scrollHeight - window.innerHeight,
    x: document.documentElement.scrollWidth - window.innerWidth,
  }))

async function hitTestable(page: Page, id: string): Promise<void> {
  const locator = page.getByTestId(id)
  await expect(locator, `${id} fully in viewport`).toBeInViewport({ ratio: 1 })
  const hit = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return at === el || el.contains(at)
  })
  expect(hit, `${id} hit-testable at its centre`).toBe(true)
}

async function open(page: Page, size: { width: number; height: number }, long: boolean) {
  await coachOffline(page)
  await page.setViewportSize(size)
  await page.goto('/')
  await page.getByTestId('undo').waitFor()
  if (long) {
    await importGame(page, LONG_GAME)
    await expect(page.getByTestId('ply-count')).toHaveText('140')
  }
}

const LANDSCAPE = [
  { width: 800, height: 600 },
  { width: 900, height: 800 },
  { width: 1020, height: 700 },
]

for (const size of LANDSCAPE) {
  for (const long of [false, true]) {
    test(`landscape ${size.width}x${size.height}${long ? ' with a long game' : ''}: board and side panel, no page scroll`, async ({ page }) => {
      await open(page, size, long)
      expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 })

      const board = await page.locator('.board').boundingBox()
      const left = await page.locator('.left-column').boundingBox()
      const right = await page.locator('.right-column').boundingBox()
      if (!board || !left || !right) throw new Error('missing box')
      expect(board.width).toBeGreaterThanOrEqual(320)
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
      expect(left.x, 'side panel right of the board').toBeGreaterThanOrEqual(board.x + board.width)
      expect(right.x).toBeCloseTo(left.x, 0)
      expect(right.y, 'right column under the left').toBeGreaterThanOrEqual(left.y + left.height)

      for (const id of ['clocks', 'tab-moves', 'tab-history', 'new-game-toggle']) await hitTestable(page, id)

      if (long) {
        const list = page.getByTestId('move-list')
        const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        expect(m.sh).toBeGreaterThan(m.ch)
        expect(await page.evaluate(() => window.scrollY)).toBe(0)
      }
    })
  }
}
```

- [ ] **Step 2: Run to verify red**

Run: `PW_PORT=5199 npx playwright test tests/e2e/mid-width-layout.spec.ts --project=chromium`
Expected: FAIL — page overflow `y` > 0 (stacked today: 1499 − 800 at 900×800).

- [ ] **Step 3: Implement**

```css
@media (min-width: 769px) and (max-width: 1020px) and (orientation: landscape) {
  .layout {
    --board-size: clamp(320px, min(640px, calc(100svh - var(--chrome, 180px)), calc(100vw - 398px)), 640px);
    max-width: none;
    height: calc(var(--board-size) + var(--coord-gutter));
    grid-template-columns: minmax(0, calc(var(--board-size) + 50px)) 280px;
    grid-template-rows: minmax(0, auto) minmax(160px, 1fr);
    grid-template-areas: 'board left' 'board right';
    column-gap: 20px;
    row-gap: 12px;
    justify-content: center;
  }
  .board-column { display: block; grid-area: board; }
  .left-column { grid-area: left; order: 0; max-height: none; overflow-y: auto; min-height: 0;
    display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-content: start; }
  .left-column .clocks, .left-column .controls { grid-column: 1 / -1; }
  .clocks { flex-direction: row; }
  .clocks .clock { flex: 1 1 0; min-width: 0; }
  .right-column { grid-area: right; order: 0; min-height: 0; max-height: none; overflow-y: auto; }
  .move-list, .history-list { max-height: none; }
  .explorer-results { max-height: none; }
}
```

Then measure live at each LANDSCAPE size: `scrollHeight`, the status row's height (raise
`--chrome` in this block for any width where the header wraps, from the measured value),
clock label fit. Tune until green; note every measured number in the block's comment.

- [ ] **Step 4: Update the superseded sweep** in `above-the-fold.spec.ts` (the `for (const width of [769, 800, …, 1020])` test): assert `.left-column` sits beside the board (`left.x >= board.x + board.width`) and rewrite its doc comment to say why.

- [ ] **Step 5: Green, then red-by-revert.** Run the new spec and `above-the-fold.spec.ts`; both pass. Revert the CSS block byte-exactly, restart the server fresh, confirm the new tests fail; restore.

- [ ] **Step 6: Commit** `src/ui/app.css tests/e2e/mid-width-layout.spec.ts tests/e2e/above-the-fold.spec.ts`.

### Task 2: Stacked mode (portrait)

**Files:**
- Modify: `src/ui/app.css` (new block `(min-width: 769px) and (max-width: 1020px) and (orientation: portrait)`)
- Modify: `tests/e2e/mid-width-layout.spec.ts`

**Interfaces:**
- Consumes: `hitTestable`, `pageOverflow`, `open` from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
const PORTRAIT = [
  { width: 769, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1000, height: 1100 },
]
const PLAY_IDS = ['clocks', 'undo', 'redo', 'flip', 'resign', 'pause', 'step', 'speed', 'hint']

for (const size of PORTRAIT) {
  for (const long of [false, true]) {
    test(`portrait ${size.width}x${size.height}${long ? ' with a long game' : ''}: board, clocks and Controls on screen`, async ({ page }) => {
      await open(page, size, long)
      expect((await pageOverflow(page)).x).toBe(0)
      const board = await page.locator('.board').boundingBox()
      if (!board) throw new Error('missing board')
      expect(board.width).toBeGreaterThanOrEqual(320)
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
      await expect(page.locator('.board')).toBeInViewport({ ratio: 1 })
      for (const id of PLAY_IDS) await hitTestable(page, id)
    })
  }
}

test('turning 900px wide from landscape to portrait switches mode without a reload', async ({ page }) => {
  await open(page, { width: 900, height: 800 }, false)
  const beside = await page.locator('.left-column').boundingBox()
  const board1 = await page.locator('.board').boundingBox()
  expect(beside!.x).toBeGreaterThanOrEqual(board1!.x + board1!.width)
  await page.setViewportSize({ width: 900, height: 1000 })
  const below = await page.locator('.left-column').boundingBox()
  const board2 = await page.locator('.board').boundingBox()
  expect(below!.y).toBeGreaterThanOrEqual(board2!.y + board2!.height)
  for (const id of PLAY_IDS) await hitTestable(page, id)
})
```

- [ ] **Step 2: Run to verify red.** Expected: FAIL at 820×1180 on `hint` (Controls start at 1108 today) and at 769×1024 / 1000×1100.

- [ ] **Step 3: Implement**

```css
@media (min-width: 769px) and (max-width: 1020px) and (orientation: portrait) {
  .layout {
    --board-size: clamp(320px, min(640px, calc(100vw - 98px), calc(100svh - var(--stack-chrome))), 640px);
  }
  .left-column { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .left-column .clocks, .left-column .controls { grid-column: 1 / -1; }
  .left-column .controls { max-width: none; }
  .clocks { flex-direction: row; }
  .clocks .clock { flex: 1 1 0; min-width: 0; }
  .left-column .controls .controls-grid:first-child { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .left-column .hint-row { flex-direction: row; align-items: center; }
  .left-column .hint-row button[data-testid='hint'] { width: auto; flex: 0 0 140px; }
}
```

`--stack-chrome` is measured, not guessed: header + board gutter + gaps + clocks row +
Controls + bottom margin, read live at 820×1180 and 769×1024 with the resume banner absent.
Order in DOM is already clocks → captured → score → controls; the spec wants captured/score
after Controls: give `.left-column .captured, .left-column .scoreboard { order: 1 }`.

- [ ] **Step 4: Green; red-by-revert** as in Task 1.

- [ ] **Step 5: Commit** `src/ui/app.css tests/e2e/mid-width-layout.spec.ts`.

### Task 3: Whole suite, cross-browser, docs, land

- [ ] Run `npx vitest run` and `PW_PORT=5199 npx playwright test` (all projects). Everything green, or explained against `main`'s baseline.
- [ ] Screenshot 820×1180, 900×800 and 800×600 for the report.
- [ ] Update `docs/next-session-prompt.md`'s layout invariants (the "stacks below 1020px" bullet) to describe the two modes.
- [ ] Commit, merge to `main`, push, deploy Netlify by hand.
