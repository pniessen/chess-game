import { expect, test, type Page } from '@playwright/test'
import { openSettings } from './helpers'

/**
 * Claude vs Claude (owner-only), driven through the real UI with every
 * /api call stubbed: no request leaves the machine and nothing costs money.
 * The token below is a fake. Each test gets a fresh browser context.
 */

const FAKE_TOKEN = 'fake-owner-token-for-e2e'

/** Fool's mate: White loses. */
const SCRIPT = [
  { san: 'f3', why: 'Opens the king side, hoping for a quick pawn storm.', costUsd: 0.01 },
  { san: 'e5', why: 'Claims the centre and frees the queen.', costUsd: 0.02 },
  { san: 'g4', why: 'Presses on with the attack.', costUsd: 0.03 },
  { san: 'Qh4#', why: 'The white king has no escape.', costUsd: 0.04 },
]

interface Calls {
  start: number
  move: string[][]
  end: number
  ownerHeaders: (string | undefined)[]
}

/** Health + budget + start + end stubs; `move` is supplied by each test. */
async function stubGame(page: Page, move: Parameters<Page['route']>[1]): Promise<Calls> {
  const calls: Calls = { start: 0, move: [], end: 0, ownerHeaders: [] }
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  await page.route('**/api/game/budget', (r) => r.fulfill({ json: { budgetLeftUsd: 12.5, monthlyUsd: 20 } }))
  await page.route('**/api/game/start', (r) => {
    calls.start++
    calls.ownerHeaders.push(r.request().headers()['x-owner-token'])
    return r.fulfill({ json: { gameId: 'g1', token: 'gt1', budgetLeftUsd: 12.5 } })
  })
  await page.route('**/api/game/move', (r) => {
    calls.move.push((r.request().postDataJSON() as { history: string[] }).history)
    return move(r)
  })
  await page.route('**/api/game/end', (r) => {
    calls.end++
    return r.fulfill({ json: { ok: true } })
  })
  return calls
}

async function setOwnerToken(page: Page): Promise<void> {
  await openSettings(page)
  await page.getByTestId('owner-token').fill(FAKE_TOKEN)
  await page.getByTestId('owner-token-save').click()
  await expect(page.getByTestId('owner-token-status')).toHaveText('set')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings')).toHaveCount(0)
}

test('Claude vs Claude plays a scripted fool\'s mate to the end card', async ({ page }) => {
  let n = 0
  const calls = await stubGame(page, (route) => {
    const history = (route.request().postDataJSON() as { history: string[] }).history
    if (history.length !== n) {
      // Fails loudly: the UI skipped or repeated a request.
      return route.fulfill({ status: 400, json: { error: { kind: 'bad-request', message: 'Bad request.' } } })
    }
    const step = SCRIPT[n]
    n++
    return route.fulfill({
      json: { san: step.san, why: step.why, costUsd: step.costUsd, gameSpentUsd: SCRIPT.slice(0, n).reduce((s, x) => s + x.costUsd, 0) },
    })
  })
  await page.goto('/')
  await setOwnerToken(page)

  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await page.getByTestId('claude-white').selectOption('opus')
  await page.getByTestId('claude-black').selectOption('haiku')
  await expect(page.getByTestId('claude-budget')).toContainText('$12.50')
  await expect(page.getByTestId('claude-estimate')).toContainText('$')
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('claude-thinking')).toContainText('Opus 5.5 is thinking')
  await expect(page.getByTestId('claude-why')).toContainText(SCRIPT[0].why)
  await expect(page.getByTestId('claude-cost')).toContainText('This game: $')

  await expect(page.getByTestId('game-end-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('game-end-headline')).toHaveText('Checkmate — Black wins')
  await expect(page.getByTestId('claude-cost')).toContainText('$0.10')

  // The stub saw exactly one request per ply, in order, with the owner token on start.
  expect(calls.move).toEqual([[], ['f3'], ['f3', 'e5'], ['f3', 'e5', 'g4']])
  expect(calls.start).toBe(1)
  expect(calls.ownerHeaders).toEqual([FAKE_TOKEN])
  await expect.poll(() => calls.end).toBe(1)
})

test('two illegal-reply answers hand the move to Stockfish, marked with a gear', async ({ page }) => {
  let failures = 0
  const calls = await stubGame(page, (route) => {
    if (failures < 2) {
      failures++
      return route.fulfill({
        status: 502,
        json: { error: { kind: 'illegal-reply', message: 'Claude replied with an unusable move.' } },
      })
    }
    // After the fallback the test has what it needs: stop the game on budget.
    return route.fulfill({ status: 402, json: { error: { kind: 'budget', message: 'The monthly Claude games budget is used up.' } } })
  })
  await page.goto('/')
  await setOwnerToken(page)
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('fallback-1')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('move-1')).toBeVisible()
  expect(calls.move[0]).toEqual([])
  expect(calls.move[1]).toEqual([])
  expect(calls.move[2]?.length).toBe(1)
})

test('without an owner token the mode is not offered; saving one offers it', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  await page.goto('/')
  const option = page.getByTestId('mode').locator('option[value="claude-vs-claude"]')
  await expect(page.getByTestId('mode')).toBeVisible()
  await expect(option).toHaveCount(0)
  // Positive control: the same page does offer it once a token is saved.
  await setOwnerToken(page)
  await expect(option).toHaveCount(1)
})
