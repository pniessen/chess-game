import { expect, test, type Page } from '@playwright/test'
import { coachOffline, coachOnline, startOnePlayer } from './helpers'

async function pressAllHints(page: Page) {
  const hint = page.getByTestId('hint')
  for (const label of ['Hint', 'Show move', 'Explain']) {
    await expect(hint).toHaveText(label, { timeout: 30_000 })
    await hint.click()
  }
  await expect(hint).toHaveText('Explained', { timeout: 30_000 })
}

test('server unreachable: a badge says so, and hints still work (templated)', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await expect(page.getByTestId('coach-badge')).toHaveText('coaching offline')
  await startOnePlayer(page)
  await pressAllHints(page)
  await expect(page.getByTestId('hint-text')).toHaveText(/engine's choice|wins a|mate/)
  await expect(page.getByTestId('coach-notice')).toHaveCount(0)
})

test("server up: the third press shows Claude's reasoning, no badge", async ({ page }) => {
  await coachOnline(page)
  await page.goto('/')
  await startOnePlayer(page)
  await pressAllHints(page)
  await expect(page.getByTestId('hint-text')).toHaveText('MOCK hint reasoning.')
  await expect(page.getByTestId('coach-badge')).toHaveCount(0)
})

test('a Claude error is surfaced once per session, not per request', async ({ page }) => {
  let hintCalls = 0
  await coachOnline(page, {
    hint: (r) => {
      hintCalls++
      return r.fulfill({
        status: 503,
        json: { error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } },
      })
    },
  })
  await page.goto('/')
  await startOnePlayer(page)

  await pressAllHints(page)
  await expect(page.getByTestId('coach-notice')).toHaveCount(1)
  await expect(page.getByTestId('hint-text')).toHaveText(/\S/) // the templated fallback
  await page.getByTestId('coach-notice-dismiss').click()

  // Play the suggested move; after the engine replies, ask again.
  const arrow = page.locator('[data-annotation="arrow"]')
  const from = await arrow.getAttribute('data-from')
  const to = await arrow.getAttribute('data-to')
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })

  await pressAllHints(page)
  expect(hintCalls).toBe(2)
  await expect(page.getByTestId('coach-notice')).toHaveCount(0)
  await expect(page.getByTestId('coach-badge')).toHaveCount(0) // the server was up all along
})
