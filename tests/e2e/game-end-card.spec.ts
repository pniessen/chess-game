import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 6: the game-end card.
 *
 * Every assertion below is on an end state, a class or an attribute — never
 * on a mid-animation frame. The entrance animation is only ever checked by
 * asking WHICH keyframes are wired up (`animationName`), not what frame it
 * is on.
 */

const SCHOLARS_MATE: Array<[string, string]> = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['f1', 'c4'], ['b8', 'c6'],
  ['d1', 'h5'], ['g8', 'f6'],
  ['h5', 'f7'],
]

async function play(page: Page, moves: Array<[string, string]>): Promise<void> {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

async function twoPlayer(page: Page): Promise<void> {
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

// Red if the card stops appearing on a live finish, or stops saying what
// the status header says.
test('a live checkmate raises the card, with the header’s own result text', async ({ page }) => {
  await play(page, SCHOLARS_MATE)

  const card = page.getByTestId('game-end-card')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('role', 'dialog')
  await expect(card).toHaveAttribute('aria-labelledby', 'game-end-headline')
  await expect(page.getByTestId('game-end-headline')).toHaveText('Checkmate — White wins')
  await expect(page.getByTestId('game-end-headline')).toHaveAttribute('aria-live', 'polite')
  await expect(page.getByTestId('result')).toHaveText('Checkmate — White wins')
  // The final position is still there to read: the card covers part of the
  // board, never all of it.
  const room = await page.evaluate(() => {
    const board = document.querySelector('.board')!.getBoundingClientRect()
    const card = document.querySelector('.game-end-card')!.getBoundingClientRect()
    return { boardHeight: board.height, covered: Math.max(0, board.bottom - card.top) }
  })
  expect(room.covered).toBeLessThan(room.boardHeight * 0.8)
})

// Red if a flag (whose `status.kind` never leaves 'in-progress') stops
// opening the card, or stops using describeResult's wording.
test('a game lost on time raises the card and says so', async ({ page }) => {
  // The shortest time control the app offers is a whole minute, so this one
  // test outlives the 60s default.
  test.setTimeout(150_000)
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('time-control').selectOption('bullet-1-0')
  await page.getByTestId('new-game').click()
  await play(page, [['e2', 'e4']])
  // Black is now on the clock; burn the whole minute.
  await expect(page.getByTestId('game-end-card')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId('game-end-headline')).toHaveText('White wins on time')
})

// Red if a draw stops raising the card, or reaches for new wording instead
// of the result strings that already exist.
test('a draw raises the card with the draw wording', async ({ page }) => {
  await twoPlayer(page)
  // Black to move and stalemated is reached live: White queens to f7 with
  // the black king boxed in on h8.
  await page.getByTestId('import-text').fill('7k/8/5QK1/8/8/8/8/8 w - - 0 1')
  await page.getByTestId('import-submit').click()
  // Imported already-live position: no card yet.
  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await play(page, [['f6', 'f7']])
  await expect(page.getByTestId('game-end-headline')).toHaveText('Draw — stalemate')
})

// Red if the card starts firing for a game that did not end in front of the
// user, and red if raising the card ever records a second history entry.
test('an imported finished game raises no card, and a live one records exactly one entry', async ({ page }) => {
  await page.getByTestId('import-text').fill('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-empty')).toBeVisible()

  // The same game played live: one card, one history entry.
  await twoPlayer(page)
  await play(page, SCHOLARS_MATE)
  await expect(page.getByTestId('game-end-card')).toBeVisible()
  await page.getByTestId('game-end-dismiss').click()
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-entry')).toHaveCount(1)
})

// Red if replaying from history pops a card (load() then finishAs(), in one
// handler) or adds a second entry.
test('replaying a finished game from history raises no card', async ({ page }) => {
  await play(page, [['e2', 'e4']])
  await page.getByTestId('resign').click() // Black, to move, resigns
  await expect(page.getByTestId('game-end-headline')).toHaveText('Black resigns — White wins')
  await page.getByTestId('game-end-dismiss').click()

  await page.getByTestId('tab-history').click()
  await page.getByTestId('history-entry').first().getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('result')).toContainText('Black resigns')
  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-entry')).toHaveCount(1)
})

// Red if focus stops moving into the card, stops being trapped, or Escape
// stops dismissing it.
test('focus is trapped in the card, and Escape dismisses it', async ({ page }) => {
  await play(page, SCHOLARS_MATE)
  await expect(page.getByTestId('game-end-card')).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByTestId('game-end-rematch')).toBeFocused()
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab')
  await expect(page.getByTestId('game-end-dismiss')).toBeFocused()
  // Off the end and round again — focus never leaves the card.
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('game-end-rematch')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('game-end-dismiss')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await expect(page.getByTestId('new-game')).toBeFocused()
  // The position is still on the board behind it.
  await expect(page.getByTestId('ply-count')).toHaveText('7')
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
})

// Red if Rematch stops keeping the finished game's setup, or leaves the
// card standing over the new game.
test('Rematch starts a new game with the same setup, ignoring the panel', async ({ page }) => {
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('time-control').selectOption('rapid-10-5')
  await page.getByTestId('new-game').click()
  await play(page, SCHOLARS_MATE)
  // Change the panel's mind after the game: the rematch must ignore it.
  await page.getByTestId('time-control').selectOption('untimed')

  await page.getByTestId('game-end-rematch').click()
  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await expect(page.getByTestId('ply-count')).toHaveText('0')
  await expect(page.getByTestId('result')).toHaveText('')
  await expect(page.getByTestId('clock-w')).toHaveText(/^(10:00|9:5\d)$/)
})

// Red if "Review game" stops running the existing review flow.
test('Review game runs the existing review and shows the Review tab', async ({ page }) => {
  await play(page, SCHOLARS_MATE)
  await page.getByTestId('game-end-review').click()

  await expect(page.getByTestId('game-end-card')).toHaveCount(0)
  await expect(page.getByTestId('tab-review')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
})

// Red if the entrance animation survives `prefers-reduced-motion: reduce`:
// the card must simply be present.
test('reduced motion drops the entrance animation, leaving the card present', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await play(page, SCHOLARS_MATE)

  const card = page.getByTestId('game-end-card')
  await expect(card).toBeVisible()
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

// Red if the card swallows a phone-sized board whole.
test('on a phone the card leaves the top of the board visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await play(page, SCHOLARS_MATE)
  await expect(page.getByTestId('game-end-card')).toBeVisible()

  const room = await page.evaluate(() => {
    const board = document.querySelector('.board')!.getBoundingClientRect()
    const card = document.querySelector('.game-end-card')!.getBoundingClientRect()
    return {
      boardHeight: board.height,
      visibleAbove: card.top - board.top,
      withinBoardWidth: card.left >= board.left - 1 && card.right <= board.right + 1,
    }
  })
  expect(room.withinBoardWidth).toBe(true)
  expect(room.visibleAbove).toBeGreaterThan(room.boardHeight * 0.3)
})
