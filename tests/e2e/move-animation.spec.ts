import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openPuzzles, pinRandom, servePuzzles } from './helpers'

/**
 * Task 1: pieces slide instead of snapping.
 *
 * None of these assert a mid-flight frame. A MutationObserver installed
 * before the move records every flight layer the board puts up, with the
 * squares each airborne piece flies between and the layer's computed
 * `display` — so the recording is complete however fast or slow the
 * animation runs, and every other assertion is about the settled board.
 */

interface FlightLog {
  flyers: string[]
  display: string[]
  /** What each destination square already held while the piece was still in the air. */
  landed: string[]
}

/** Start recording every flight the board raises from here on. */
async function watchFlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board to watch')
    const log: FlightLog = { flyers: [], display: [], landed: [] }
    ;(window as unknown as { __flights: FlightLog }).__flights = log
    const record = () => {
      const layer = document.querySelector('[data-testid="flight-layer"]')
      if (!layer) return
      const seen = [...layer.querySelectorAll('[data-flight]')]
        .map((e) => `${e.getAttribute('data-flight')}:${e.getAttribute('data-flight-from')}-${e.getAttribute('data-flight-to')}`)
        .join(' ')
      if (log.flyers[log.flyers.length - 1] !== seen) log.flyers.push(seen)
      const display = getComputedStyle(layer).display
      if (log.display[log.display.length - 1] !== display) log.display.push(display)
      const landed = [...layer.querySelectorAll('[data-flight="mover"]')]
        .map((e) => {
          const to = e.getAttribute('data-flight-to')
          const real = document.querySelector(`[data-square="${to}"] [data-piece]`)
          return `${to}:${real?.getAttribute('data-piece') ?? 'empty'}`
        })
        .join(' ')
      if (log.landed[log.landed.length - 1] !== landed) log.landed.push(landed)
    }
    new MutationObserver(record).observe(board, { childList: true, subtree: true })
    record()
  })
}

async function readFlights(page: Page): Promise<FlightLog> {
  return page.evaluate(() => (window as unknown as { __flights: FlightLog }).__flights)
}

/** Nothing is left in the air, and nothing is left hidden. */
async function expectSettled(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="flight-layer"]')).toHaveCount(0)
  await expect(page.locator('.square.arriving')).toHaveCount(0)
}

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}

async function twoPlayer(page: Page): Promise<void> {
  await coachOffline(page)
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

// Red if a move stops being animated at all, or flies between the wrong
// squares.
test('a move slides the piece from its origin to its destination', async ({ page }) => {
  await twoPlayer(page)
  await watchFlights(page)

  await move(page, 'e2', 'e4')

  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expectSettled(page)
  expect((await readFlights(page)).flyers).toContain('mover:e2-e4')
})

// Red if the captured piece stops being drawn, or is drawn on top of the
// piece that takes it (it must be the first child, so it paints under).
test('a capture keeps the taken piece on the board, under the arriving one', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await watchFlights(page)
  await move(page, 'd7', 'd5')
  await move(page, 'e4', 'd5')

  await expect(page.locator('[data-square="d5"] [data-piece="wP"]')).toBeVisible()
  await expectSettled(page)
  expect((await readFlights(page)).flyers).toContain('captured:d5-d5 mover:e4-d5')
})

// Red if castling animates only the king.
test('castling flies the king and the rook together', async ({ page }) => {
  await twoPlayer(page)
  for (const [from, to] of [
    ['e2', 'e4'], ['e7', 'e5'],
    ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'c4'], ['f8', 'c5'],
  ] as Array<[string, string]>) {
    await move(page, from, to)
  }
  await watchFlights(page)
  await move(page, 'e1', 'g1')

  await expect(page.locator('[data-square="g1"] [data-piece="wK"]')).toBeVisible()
  await expect(page.locator('[data-square="f1"] [data-piece="wR"]')).toBeVisible()
  await expectSettled(page)
  expect((await readFlights(page)).flyers).toContain('mover:e1-g1 mover:h1-f1')
})

// Red if a promotion slides the promoted piece instead of the pawn, or if
// the new piece never appears at the end of the slide.
test('a promotion slides the pawn and leaves the new piece on the square', async ({ page }) => {
  await twoPlayer(page)
  // A White pawn one step from promoting, with a rook to take on b8.
  await page.getByTestId('import-text').fill('1r5k/P7/8/8/8/8/8/K7 w - - 0 1')
  await page.getByTestId('import-submit').click()
  await expect(page.locator('[data-square="a7"] [data-piece="wP"]')).toBeVisible()

  await watchFlights(page)
  await move(page, 'a7', 'b8')
  await page.getByRole('button', { name: 'Queen' }).click()

  await expect(page.locator('[data-square="b8"] [data-piece="wQ"]')).toBeVisible()
  await expectSettled(page)
  const log = await readFlights(page)
  // The piece in the air is the PAWN, over the rook it is taking…
  expect(log.flyers).toContain('captured:b8-b8 mover:a7-b8')
  // …and the queen was already waiting underneath it, to be swapped in.
  expect(log.landed).toContain('b8:wQ')
})

// Red if history browsing starts animating: clicking a move one ply ahead
// of the one on screen looks exactly like a move being played.
test('browsing the move list cuts, it never animates', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await move(page, 'g1', 'f3')
  await expectSettled(page)

  await watchFlights(page)
  await page.getByTestId('move-1').click()
  await expect(page.locator('[data-square="e5"] [data-piece]')).toHaveCount(0)
  // …and forward again, one ply at a time.
  await page.getByTestId('move-2').click()
  await expect(page.locator('[data-square="e5"] [data-piece="bP"]')).toBeVisible()
  await page.getByTestId('move-3').click()
  await expect(page.locator('[data-square="f3"] [data-piece="wN"]')).toBeVisible()

  expect((await readFlights(page)).flyers).toEqual([])
  await expectSettled(page)
})

// Red if undo or redo starts animating.
test('undo and redo cut', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await expectSettled(page)

  await watchFlights(page)
  await page.getByTestId('undo').click()
  await expect(page.locator('[data-square="e5"] [data-piece]')).toHaveCount(0)
  await page.getByTestId('redo').click()
  await expect(page.locator('[data-square="e5"] [data-piece="bP"]')).toBeVisible()

  expect((await readFlights(page)).flyers).toEqual([])
  await expectSettled(page)
})

// Red if flipping the board animates: every square moves at once, and the
// flight geometry for the old orientation would be nonsense.
test('flipping the board cuts', async ({ page }) => {
  await twoPlayer(page)
  await move(page, 'e2', 'e4')
  await expectSettled(page)

  await watchFlights(page)
  await page.getByTestId('flip').click()
  await expect(page.locator('.board.black')).toBeVisible()

  expect((await readFlights(page)).flyers).toEqual([])
})

// Red if `prefers-reduced-motion: reduce` stops suppressing the animation.
test('reduced motion plays no animation at all', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await twoPlayer(page)
  await watchFlights(page)

  await move(page, 'e2', 'e4')

  await expect(page.locator('[data-square="e4"] [data-piece="wP"]')).toBeVisible()
  await expectSettled(page)
  const log = await readFlights(page)
  // The layer may exist for an instant, but it is never shown.
  expect(log.display.filter((d) => d !== 'none')).toEqual([])
})

// Red if the animation is ever allowed to gate a move. The observer looks
// at the real board at the instant the piece takes off: the position must
// ALREADY be committed underneath it — the slide is decoration, never a
// step the move has to wait for.
test('the move is on the board before the piece has finished moving', async ({ page }) => {
  await twoPlayer(page)
  await watchFlights(page)

  await move(page, 'e2', 'e4')
  await move(page, 'e7', 'e5')
  await move(page, 'g1', 'f3')

  await expect(page.getByTestId('ply-count')).toHaveText('3')
  await expect(page.locator('[data-square="f3"] [data-piece="wN"]')).toBeVisible()
  await expectSettled(page)

  const log = await readFlights(page)
  // Every move animated, and none was dropped.
  expect(log.flyers).toEqual(['mover:e2-e4', 'mover:e7-e5', 'mover:g1-f3'])
  expect(log.landed).toEqual(['e4:wP', 'e5:bP', 'f3:wN'])
})

// Red if puzzle mode stops animating: it renders the same Board, and the
// opponent's replies and solution playback must read the same way there.
test('puzzle moves animate too, the solver’s and the opponent’s alike', async ({ page }) => {
  await pinRandom(page, 0)
  await coachOffline(page)
  await servePuzzles(page)
  await page.goto('/')
  await openPuzzles(page)
  // The setup move has played; the board is waiting for the solver.
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for Black.')
  await expectSettled(page)

  await watchFlights(page)
  await move(page, 'f8', 'd8')
  // …and the opponent takes on d8 in reply.
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.')
  await expect(page.locator('[data-square="d8"] [data-piece="wQ"]')).toBeVisible()
  await expectSettled(page)

  const log = await readFlights(page)
  expect(log.flyers).toEqual(['mover:f8-d8', 'captured:d8-d8 mover:d6-d8'])
})
