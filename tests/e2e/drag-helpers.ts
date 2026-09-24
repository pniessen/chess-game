import { type Page } from '@playwright/test'
import { coachOffline } from './helpers'

/** Shared by every Task 2 drag spec (mouse-driven and touch-driven alike). */

export async function twoPlayer(page: Page): Promise<void> {
  await coachOffline(page)
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()
}

export async function centerOf(page: Page, square: string): Promise<{ x: number; y: number }> {
  const locator = page.locator(`[data-square="${square}"]`)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error(`could not locate ${square} on the board`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Presses down on `from` and drags to `to` with real intermediate pointer
 * moves (so the 6px drag threshold is clearly exceeded before arriving),
 * but does NOT release — the caller decides when (and where) to
 * `page.mouse.up()`, so a test can inspect the board mid-drag.
 */
export async function pressAndDragTo(page: Page, from: string, to: string): Promise<void> {
  const start = await centerOf(page, from)
  const end = await centerOf(page, to)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t)
  }
}

/** Record every value `data-drag-phase` takes on the ghost, from before the
 *  drag starts (`'none'`, when there is no ghost) to after it is gone. */
export async function watchGhostPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __ghostLog: string[] }).__ghostLog = log
    const record = () => {
      const ghost = document.querySelector('[data-testid="drag-ghost"]')
      const phase = ghost?.getAttribute('data-drag-phase') ?? 'none'
      if (log[log.length - 1] !== phase) log.push(phase)
    }
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board to watch')
    new MutationObserver(record).observe(board, { childList: true, subtree: true, attributes: true })
    record()
  })
}

export async function readGhostPhases(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ghostLog: string[] }).__ghostLog)
}

/** Record whether the flight layer (Task 1's move animation) is present. */
export async function watchFlightPresence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = []
    ;(window as unknown as { __flightLog: string[] }).__flightLog = log
    const record = () => {
      const present = document.querySelector('[data-testid="flight-layer"]') ? 'present' : 'absent'
      if (log[log.length - 1] !== present) log.push(present)
    }
    const board = document.querySelector('.board')
    if (!board) throw new Error('no board to watch')
    new MutationObserver(record).observe(board, { childList: true, subtree: true })
    record()
  })
}

export async function readFlightPresence(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __flightLog: string[] }).__flightLog)
}
