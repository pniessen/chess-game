import { expect, test, type Page } from '@playwright/test'
import { coachOffline, importGame } from './helpers'

/**
 * The 769-1020px band (docs/superpowers/specs/2026-09-28-mid-width-layout-design.md).
 *
 * Two modes, chosen by orientation rather than width alone: landscape puts
 * one 280px panel beside the board and holds desktop's zero-scroll
 * invariant; portrait stacks, keeping the board, both clocks and every
 * Controls button on screen without scrolling. Every test here opens a
 * fresh context — a reused one carries a resume banner that shifts every
 * measurement.
 */

/** The same 70-move game above-the-fold.spec.ts imports: enough to force
 * every list in the side panel to scroll. */
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

/** How far the document can scroll, each way. `{ x: 0, y: 0 }` means it fits. */
const pageOverflow = (page: Page) =>
  page.evaluate(() => ({
    y: document.documentElement.scrollHeight - window.innerHeight,
    x: document.documentElement.scrollWidth - window.innerWidth,
  }))

/** Usable the way a person meets it: wholly on screen with nothing painted
 * over its centre. `toBeVisible()` would pass for a button clipped away by
 * a scrolling ancestor. */
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

/** Every measurement waits for the header's final shape: the engine's
 * "Loading engine…" chip leaves and the "coaching offline" badge arrives
 * (the health probe fails under `coachOffline`), and in this band either
 * can re-wrap the header and resize the board under a measurement taken
 * mid-way. Same helper as above-the-fold.spec.ts. */
async function settledHeader(page: Page): Promise<void> {
  await expect(page.locator('.board')).toBeVisible()
  await expect(page.getByTestId('engine-status')).toHaveCount(0)
  await expect(page.getByTestId('coach-badge')).toBeVisible()
}

async function open(page: Page, size: { width: number; height: number }, long: boolean): Promise<void> {
  await coachOffline(page)
  await page.setViewportSize(size)
  await page.goto('/')
  await settledHeader(page)
  if (long) {
    await importGame(page, LONG_GAME)
    await expect(page.getByTestId('ply-count')).toHaveText('140')
    // Playwright's own click on Import scrolls a stacked page before it
    // presses (measured: 188px at 769x1024, and 282px on the stacked
    // layout this replaced), which a person's click does not: the same
    // import through DOM `click()`s leaves scrollY at 0, and
    // `elementFromPoint` finds Import itself at its centre. Undo it, so the
    // fold is measured where a person would see it.
    await page.evaluate(() => window.scrollTo(0, 0))
  }
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox()
  if (!b) throw new Error(`${selector} has no bounding box`)
  return b
}

const LANDSCAPE = [
  { width: 800, height: 600 },
  { width: 900, height: 800 },
  { width: 1020, height: 700 },
]

for (const size of LANDSCAPE) {
  for (const long of [false, true]) {
    test(`landscape ${size.width}x${size.height}${long ? ' with a long game' : ''}: board and side panel, no page scroll`, async ({
      page,
    }) => {
      await open(page, size, long)
      expect(await pageOverflow(page)).toEqual({ x: 0, y: 0 })

      // One evaluate, so no relayout can land between the three reads.
      const { board, left, right } = await page.evaluate(() => {
        const r = (s: string) => {
          const b = document.querySelector(s)!.getBoundingClientRect()
          return { x: b.x, y: b.y, width: b.width, height: b.height }
        }
        return { board: r('.board'), left: r('.left-column'), right: r('.right-column') }
      })
      expect(board.width).toBeGreaterThanOrEqual(320)
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
      expect(left.x, 'side panel right of the board').toBeGreaterThanOrEqual(board.x + board.width)
      expect(Math.abs(right.x - left.x), 'one panel: both columns share its x').toBeLessThanOrEqual(1)
      expect(right.y, 'right column under the left').toBeGreaterThanOrEqual(left.y + left.height)

      for (const id of ['clocks', 'new-game-toggle', 'tab-moves', 'tab-history']) await hitTestable(page, id)

      if (long) {
        const m = await page
          .getByTestId('move-list')
          .evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        expect(m.sh, 'the move list scrolls inside its panel').toBeGreaterThan(m.ch)
        expect(await page.evaluate(() => window.scrollY)).toBe(0)
      }
    })
  }
}

const PORTRAIT = [
  { width: 769, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1000, height: 1100 },
]
/** Everything a player touches mid-game: the spec's criterion A. */
const PLAY_IDS = ['clocks', 'undo', 'redo', 'flip', 'resign', 'pause', 'step', 'speed', 'hint']

for (const size of PORTRAIT) {
  for (const long of [false, true]) {
    test(`portrait ${size.width}x${size.height}${long ? ' with a long game' : ''}: board, clocks and Controls on screen`, async ({
      page,
    }) => {
      await open(page, size, long)
      expect((await pageOverflow(page)).x).toBe(0)
      const board = await box(page, '.board')
      expect(board.width).toBeGreaterThanOrEqual(320)
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
      await expect(page.locator('.board')).toBeInViewport({ ratio: 1 })
      for (const id of PLAY_IDS) await hitTestable(page, id)
    })
  }
}

test('turning a 900px-wide window from landscape to portrait switches mode without a reload', async ({ page }) => {
  await open(page, { width: 900, height: 800 }, false)
  let board = await box(page, '.board')
  expect((await box(page, '.left-column')).x).toBeGreaterThanOrEqual(board.x + board.width)

  await page.setViewportSize({ width: 900, height: 1000 })
  board = await box(page, '.board')
  expect((await box(page, '.left-column')).y).toBeGreaterThanOrEqual(board.y + board.height)
  for (const id of PLAY_IDS) await hitTestable(page, id)
})
