import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

// Fool's Mate: shortest possible checkmate, so the two-player game finishes
// in four plies without relying on any engine.
const FOOLS_MATE: Array<[string, string]> = [
  ['f2', 'f3'],
  ['e7', 'e5'],
  ['g2', 'g4'],
  ['d8', 'h4'],
]

test.beforeEach(async ({ page }) => coachOffline(page))

test('unreadable history: notice, two-step reset, then a finished game is recorded', async ({ page }) => {
  // Seed a corrupt `chess-game:history` before the app's first read of it.
  await page.addInitScript(() => localStorage.setItem('chess-game:history', '{'))
  await page.goto('/')

  await page.getByTestId('tab-history').click()
  const notice = page.getByTestId('history-notice')
  // Breaking change this asserts against: a storage read that silently
  // treats corrupt JSON as an empty history (no notice at all).
  await expect(notice).toBeVisible()
  await expect(notice).toContainText("Your saved game history can't be read, so finished games aren't being saved.")
  await expect(notice).not.toContainText('newer version')
  await expect(page.getByTestId('history-empty')).toBeVisible()

  // Cancel first: the notice and the raw stored value must survive untouched.
  await page.getByRole('button', { name: 'Reset history' }).click()
  const confirmBtn = page.getByRole('button', { name: 'Confirm reset — this deletes saved games' })
  await expect(confirmBtn).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirmBtn).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset history' })).toBeVisible()
  await expect(notice).toBeVisible()

  // Now actually reset. Breaking change this asserts against: a reset that
  // fires on the first click (no confirm step) or that leaves the notice up.
  await page.getByRole('button', { name: 'Reset history' }).click()
  await confirmBtn.click()
  await expect(notice).not.toBeVisible()
  await expect(page.getByTestId('history-empty')).toBeVisible()

  // Breaking change this asserts against: a reset that clears storage but
  // never unblocks writes, so the next finished game still isn't recorded.
  await play(page, FOOLS_MATE)
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  const entries = page.getByTestId('history-entry')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('0-1') // Black delivers Fool's Mate
})

test('a newer-version history shows the extra explanatory line', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 2, games: [{ id: 'future' }] })),
  )
  await page.goto('/')
  await page.getByTestId('tab-history').click()
  const notice = page.getByTestId('history-notice')
  await expect(notice).toContainText("Your saved game history can't be read, so finished games aren't being saved.")
  // Breaking change this asserts against: the newer-version case rendering
  // the same text as a plain unreadable history, with no extra explanation.
  await expect(notice).toContainText('It may have been written by a newer version of this app.')
})
