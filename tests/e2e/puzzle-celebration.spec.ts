import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openPuzzles, pinRandom, servePuzzles } from './helpers'

/**
 * Task 7: the puzzle-solved celebration (a green ring sweep on the board
 * plus a rising, fading rating echo) and the wrong-move piece shake. Same
 * fixture and rating expectations as blunder-puzzles.spec.ts/puzzles.spec.ts
 * (0000D drawn first with Math.random pinned to 0, K = 40).
 *
 * No assertion here depends on catching a mid-animation frame: every check
 * is either a class/attribute (present/absent) or a computed `animationName`
 * — which CSS keyframes are wired up, never which frame they are on.
 */
async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

/** Waits out the opponent's setup move (played after a delay) before the solver's first click. */
async function ready(page: Page) {
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for Black.')
}

const SEEDED_MISTAKE = {
  v: 1,
  puzzles: [
    {
      id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
      fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
      solution: 'd1d8',
      bestSan: 'Qd8#',
      blunderLabel: '25. h3',
      solver: 'w',
      gameId: 'g1',
      gameDate: '2026-09-20T10:00:00.000Z',
      opening: null,
      createdAt: '2026-09-20T10:05:00.000Z',
      solved: false,
    },
  ],
}
const KEY = 'chess-game:blunder-puzzles'

test.beforeEach(async ({ page }) => {
  await pinRandom(page, 0)
  await coachOffline(page)
  await servePuzzles(page)
  await page.goto('/')
})

test('solving a rated puzzle sweeps a green ring and rises a fading rating echo, once', async ({ page }) => {
  await openPuzzles(page)
  await ready(page)
  await move(page, 'f8', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.') // the reply (400ms) has landed
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(+33)')

  await expect(page.locator('.board')).toHaveClass(/celebrate-solved/)
  const ringAnimation = await page
    .locator('.board')
    .evaluate((el) => getComputedStyle(el, '::after').animationName)
  expect(ringAnimation).toBe('celebrate-ring')

  const pop = page.locator('.rating-pop')
  await expect(pop).toHaveText('+33')
  const popAnimation = await pop.evaluate((el) => getComputedStyle(el).animationName)
  expect(popAnimation).toBe('rating-rise')

  // The permanent delta text is untouched by any of this.
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(+33)')
})

test('a wrong move shakes the piece and shows the red square; no celebration ring', async ({ page }) => {
  await openPuzzles(page)
  await ready(page)
  await move(page, 'b6', 'c7')
  await expect(page.getByTestId('puzzle-status')).toHaveText("That's not it. Retry, or show the solution.")

  const wrongSquare = page.locator('[data-square="c7"]')
  await expect(wrongSquare).toHaveClass(/wrong-move/)
  await expect(page.locator('[data-annotation="square"][data-tone="blunder"]')).toHaveAttribute(
    'data-annotation-square',
    'c7',
  )
  await expect(page.locator('.board')).not.toHaveClass(/celebrate-solved/)

  // The wrong move is itself flown in like any other move — the square is
  // briefly `arriving` too, while the real piece stays hidden under the
  // flying ghost (Task 1) — and `.square.wrong-move:not(.arriving) .piece`
  // (board.css) deliberately waits that out rather than fighting it for the
  // `animation` property. This polls for the end state (the shake taking
  // over once the piece has actually landed), never a mid-flight frame of
  // either animation.
  await expect
    .poll(() => wrongSquare.locator('[data-piece]').evaluate((el) => getComputedStyle(el).animationName))
    .toBe('piece-shake')

  // Retrying and solving clears the wrong-move shake and does play the ring.
  await page.getByTestId('puzzle-retry').click()
  await expect(wrongSquare).not.toHaveClass(/wrong-move/)
  await move(page, 'f8', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.locator('.board')).toHaveClass(/celebrate-solved/)
})

test('My mistakes celebrates the ring on solving, but no rating text ever appears', async ({ page }) => {
  await page.addInitScript(
    ({ k, v }) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    },
    { k: KEY, v: JSON.stringify(SEEDED_MISTAKE) },
  )
  await page.reload()
  await openPuzzles(page)
  // Historical note, kept because it explains this wait: PuzzleScreen.tsx's
  // set-arrival effect (`useEffect(..., [set])`) used to close over
  // `source` instead of reading a live ref, so switching to My mistakes
  // while the rated puzzle set's fetch was still pending could — once that
  // fetch resolved — silently reset `current` back to the rated puzzle
  // (0000D) while the <select> itself stayed on 'mistakes', if the
  // effect's flush landed after the switch. That is now fixed at the
  // source (see PuzzleScreen.tsx's set-arrival effect and
  // PuzzleScreen.race.test.tsx). This wait — for the rated puzzle to be
  // visibly on screen before switching — is no longer required for
  // correctness, but is kept anyway: it is what actually turned up the bug
  // on a full-suite run (never reproduced re-running this file alone,
  // which starts far less loaded) and remains a reasonable, low-cost
  // guard against unrelated timing flakiness in this same screen.
  await expect(page.getByTestId('puzzle-id')).toHaveText('0000D')
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  // Wait on something only THIS seeded mistake puzzle can satisfy — its
  // origin text names the exact blunder label and game date. Waiting on
  // `puzzle-side-to-move` reading "White to move" alone (as an earlier
  // version of this test did) is not specific enough on its own: DEFENCE
  // (0000D) is Black-to-move, but that is not a hard guarantee against
  // every possible stale-content window, so the origin text — unique to
  // this exact seeded puzzle — is the primary wait.
  await expect(page.getByTestId('puzzle-origin')).toContainText('you played 25. h3??')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('White to move')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveCount(0)

  await move(page, 'd1', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.locator('.board')).toHaveClass(/celebrate-solved/)
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveCount(0)
  await expect(page.locator('.rating-pop')).toHaveCount(0)
})

test('reduced motion drops the ring sweep, the rating rise and the wrong-move shake', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPuzzles(page)
  await ready(page)

  await move(page, 'b6', 'c7')
  await expect(page.getByTestId('puzzle-status')).toHaveText("That's not it. Retry, or show the solution.")
  const wrongSquare = page.locator('[data-square="c7"]')
  await expect(wrongSquare).toHaveClass(/wrong-move/) // the class is still a true signal…
  expect(await wrongSquare.locator('[data-piece]').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none', // …but the animation itself never runs
  )

  await page.getByTestId('puzzle-retry').click()
  await move(page, 'f8', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.locator('.board')).toHaveClass(/celebrate-solved/)
  expect(await page.locator('.board').evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none')
  await expect(page.locator('.rating-pop')).toBeHidden()
  // The existing, informative delta text is exactly what remains — still
  // the wrong move's own -7 (the once-only outcome rule this task must not
  // touch: retrying and solving afterwards never refunds it).
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(-7)')
})
