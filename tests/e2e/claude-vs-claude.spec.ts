import { expect, test, type Page } from '@playwright/test'

/**
 * Claude vs Claude (local-only), driven through the real UI with every
 * /api call stubbed: no request leaves the machine and nothing costs money.
 * Playwright serves the app with `vite` in dev mode, so the build flag is on
 * (see src/claude/enabled.ts) and the mode is offered with no setup step.
 * Each test gets a fresh browser context.
 */

/** Fool's mate: White loses. */
const SCRIPT = [
  { san: 'f3', why: 'Opens the king side, hoping for a quick pawn storm.', costUsd: 0.01 },
  { san: 'e5', why: 'Claims the centre and frees the queen.', costUsd: 0.02 },
  { san: 'g4', why: 'Presses on with the attack.', costUsd: 0.03 },
  { san: 'Qh4#', why: 'The white king has no escape.', costUsd: 0.04 },
]

interface Usage {
  costUsd: number
  ms: number
  inputTokens: number
  outputTokens: number
  calls: number
}

/** The game's per-side usage after the first `n` script moves: 1.5 s and 900/40 tokens a call. */
function usageAfter(n: number): { w: Usage; b: Usage } {
  const side = (parity: number): Usage => {
    const steps = SCRIPT.slice(0, n).filter((_, i) => i % 2 === parity)
    return {
      costUsd: steps.reduce((sum, x) => sum + x.costUsd, 0),
      ms: steps.length * 1500,
      inputTokens: steps.length * 900,
      outputTokens: steps.length * 40,
      calls: steps.length,
    }
  }
  return { w: side(0), b: side(1) }
}

/** This month's usage per model, as the budget endpoint reports it. */
const BYMODEL = {
  fable: { costUsd: 0.2345, ms: 46_800, inputTokens: 10_000, outputTokens: 12_345, calls: 12 },
  haiku: { costUsd: 0.004, ms: 800, inputTokens: 900, outputTokens: 40, calls: 1 },
}

/** The head-to-head the record stub answers: before the scripted game ends, and after (Haiku, as Black, won it). */
const RECORD_BEFORE = { games: 3, whiteModelWins: 1, blackModelWins: 0, draws: 2, whiteWins: 1, blackWins: 0 }
const RECORD_AFTER = { games: 4, whiteModelWins: 1, blackModelWins: 1, draws: 2, whiteWins: 1, blackWins: 1 }

interface Calls {
  start: number
  move: string[][]
  end: number
  /** The URL of each /api/game/record request, and whether the game had ended when it came. */
  record: { url: string; afterEnd: boolean }[]
  /** The x-owner-token header on each start: there is no owner token any more, so always absent. */
  ownerHeaders: (string | undefined)[]
}

/** Health + budget + start + end stubs; `move` is supplied by each test. */
async function stubGame(page: Page, move: Parameters<Page['route']>[1]): Promise<Calls> {
  const calls: Calls = { start: 0, move: [], end: 0, record: [], ownerHeaders: [] }
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  await page.route('**/api/game/budget', (r) =>
    r.fulfill({ json: { budgetLeftUsd: 12.5, monthlyUsd: 20, byModel: BYMODEL, earlierUsd: 0.13 } }),
  )
  await page.route('**/api/game/start', (r) => {
    calls.start++
    calls.ownerHeaders.push(r.request().headers()['x-owner-token'])
    return r.fulfill({ json: { gameId: 'g1', token: 'gt1', budgetLeftUsd: 12.5 } })
  })
  await page.route('**/api/game/move', (r) => {
    calls.move.push((r.request().postDataJSON() as { history: string[] }).history)
    return move(r, r.request())
  })
  await page.route('**/api/game/end', (r) => {
    calls.end++
    return r.fulfill({ json: { ok: true } })
  })
  // The saved record is written as the server answers end: from then on the stub's record includes the game.
  await page.route(/\/api\/game\/record\?/, (r) => {
    const url = new URL(r.request().url())
    calls.record.push({ url: url.pathname + url.search, afterEnd: calls.end > 0 })
    return r.fulfill({ json: calls.end > 0 ? RECORD_AFTER : RECORD_BEFORE })
  })
  return calls
}

test('Claude vs Claude plays a scripted fool\'s mate to the end card', async ({ page }) => {
  let n = 0
  const calls = await stubGame(page, (route) => {
    const history = (route.request().postDataJSON() as { history: string[] }).history
    if (history.length !== n) {
      // Fails loudly: the UI skipped or repeated a request.
      return route.fulfill({ status: 400, json: { error: { kind: 'bad-request', message: 'Bad request.' } } })
    }
    const step = SCRIPT[n]!
    n++
    return route.fulfill({
      json: {
        san: step.san,
        why: step.why,
        costUsd: step.costUsd,
        gameSpentUsd: SCRIPT.slice(0, n).reduce((s, x) => s + x.costUsd, 0),
        usage: usageAfter(n),
      },
    })
  })
  await page.goto('/')

  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await page.getByTestId('claude-white').selectOption('opus')
  await page.getByTestId('claude-black').selectOption('haiku')
  await expect(page.getByTestId('claude-budget')).toContainText('$12.50')
  await expect(page.getByTestId('claude-estimate')).toContainText('$')
  await expect(page.getByTestId('claude-month')).toHaveText(
    'This month: Fable $0.23 (12 calls, 3.9 s/call) · Haiku $0.00 (1 call, 0.8 s/call) · Earlier: $0.13',
  )
  // Before any Claude game the card is the human score.
  await expect(page.getByTestId('scoreboard')).toContainText('Score')
  await expect(page.getByTestId('claude-record')).toHaveCount(0)
  await page.getByTestId('new-game').click()

  // In the Claude game the Score card is the two models' head-to-head.
  await expect(page.getByTestId('scoreboard')).toContainText('Head to head')
  await expect(page.getByTestId('claude-record')).toHaveText('Opus 5.5 1 – 0 Haiku 4.5 · 2 draws')
  await expect(page.getByTestId('claude-thinking')).toContainText('Opus 5.5 is thinking')
  await expect(page.getByTestId('claude-why')).toContainText(SCRIPT[0]!.why)
  await expect(page.getByTestId('claude-cost')).toContainText('This game: $')
  // After White's first move its clock shows the model time the server reported.
  await expect(page.getByTestId('clock-w')).toHaveText(/^0:0[1-9]\.\d$/)
  await expect(page.getByTestId('clock-w')).toHaveAttribute('title', /^Model time/)

  await expect(page.getByTestId('game-end-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('game-end-headline')).toHaveText('Checkmate — Black wins')
  await expect(page.locator('.clock', { has: page.getByTestId('clock-b') }).getByTestId('winner-star')).toBeVisible()
  await expect(page.getByTestId('winner-star')).toHaveCount(1)
  await expect(page.getByTestId('claude-cost')).toContainText('$0.10')
  await expect(page.getByTestId('claude-cost-w')).toContainText('Opus 5.5 $0.04')
  await expect(page.getByTestId('claude-cost-b')).toContainText('Haiku 4.5 $0.06')
  await expect(page.getByTestId('clock-w')).toHaveText('0:03.0')
  await expect(page.getByTestId('clock-b')).toHaveText('0:03.0')

  // The stub saw exactly one request per ply, in order, and no owner token on start.
  expect(calls.move).toEqual([[], ['f3'], ['f3', 'e5'], ['f3', 'e5', 'g4']])
  expect(calls.start).toBe(1)
  expect(calls.ownerHeaders).toEqual([undefined])
  await expect.poll(() => calls.end).toBe(1)

  // Once the end has landed the record is read again, now counting this game.
  await expect(page.getByTestId('claude-record')).toHaveText('Opus 5.5 1 – 1 Haiku 4.5 · 2 draws')
  expect(calls.record[0]).toEqual({ url: '/api/game/record?white=opus&black=haiku', afterEnd: false })
  expect(calls.record.some((c) => c.afterEnd)).toBe(true)
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
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('fallback-1')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('move-1')).toBeVisible()
  expect(calls.move[0]).toEqual([])
  expect(calls.move[1]).toEqual([])
  await expect.poll(() => calls.move[2]?.length).toBe(1)
})

test('in dev the mode is present; with /api/game/budget failing, Start is disabled and the hint shows', async ({ page }) => {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  // The local server is not running: the budget request fails outright.
  await page.route('**/api/game/budget', (r) => r.abort('connectionrefused'))
  let starts = 0
  await page.route('**/api/game/start', (r) => {
    starts++
    return r.fulfill({ status: 500, json: { error: { kind: 'upstream', message: 'x' } } })
  })
  await page.goto('/')
  await expect(page.getByTestId('mode').locator('option[value="claude-vs-claude"]')).toHaveCount(1)
  // No owner-token field anywhere.
  await expect(page.getByTestId('owner-token')).toHaveCount(0)

  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await expect(page.getByTestId('claude-budget')).toContainText('unavailable')
  await expect(page.getByTestId('claude-unavailable-hint')).toContainText(
    'Start the local server (npm run server) with ANTHROPIC_API_KEY in .env',
  )
  await expect(page.getByTestId('new-game')).toBeDisabled()

  // Positive control: once the server answers, re-selecting the mode clears
  // the hint and Start comes back.
  await page.unroute('**/api/game/budget')
  await page.route('**/api/game/budget', (r) => r.fulfill({ json: { budgetLeftUsd: 12.5, monthlyUsd: 20 } }))
  await page.getByTestId('mode').selectOption('two-player')
  await expect(page.getByTestId('new-game')).toBeEnabled()
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await expect(page.getByTestId('claude-budget')).toContainText('$12.50')
  await expect(page.getByTestId('claude-unavailable-hint')).toHaveCount(0)
  await expect(page.getByTestId('new-game')).toBeEnabled()
  expect(starts).toBe(0)
})

test('at 1440x800 the month line fits without page scroll', async ({ page }) => {
  await stubGame(page, (route) => route.fulfill({ status: 402, json: { error: { kind: 'budget', message: 'x' } } }))
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto('/')
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await expect(page.getByTestId('claude-month')).toBeVisible()
  // The line is short enough to stay on one or two lines of the panel.
  const box = await page.getByTestId('claude-month').boundingBox()
  expect(box!.height).toBeLessThan(60)
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0)
  expect(await page.getByTestId('claude-month').getAttribute('title')).toBeNull()
  await expect(page.getByTestId('claude-month').locator('span[title]').first()).toHaveAttribute(
    'title',
    'Fable 5.1: 12,345 output tokens. A call is one request to the model, retries included.',
  )
})

/** The models a server with both keys can seat, as /api/game/budget lists them. */
const ALL_MODELS = ['fable', 'opus', 'sonnet', 'haiku', 'jev', 'gemini-pro', 'gemini-flash']

test('Jev holds the White seat: its moves carry its probability, not a made-up reason', async ({ page }) => {
  // Jev is charged for input tokens only, at $0.042 per million: a fraction of a cent a move.
  const JEV_SCRIPT = [
    { san: 'f3', why: "Jev's pick (p 0.27)", costUsd: 0.00005 },
    { san: 'e5', why: 'Claims the centre and frees the queen.', costUsd: 0.004 },
    { san: 'g4', why: "Jev's pick (p 0.31)", costUsd: 0.00005 },
    { san: 'Qh4#', why: 'The white king has no escape.', costUsd: 0.004 },
  ]
  let n = 0
  const calls = await stubGame(page, (route) => {
    const step = JEV_SCRIPT[n]!
    n++
    const played = JEV_SCRIPT.slice(0, n)
    const side = (parity: number) => {
      const steps = played.filter((_, i) => i % 2 === parity)
      return {
        costUsd: steps.reduce((s, x) => s + x.costUsd, 0),
        ms: steps.length * 170,
        inputTokens: steps.length * 1200,
        outputTokens: steps.length * 250,
        calls: steps.length,
      }
    }
    return route.fulfill({
      json: {
        san: step.san,
        why: step.why,
        costUsd: step.costUsd,
        gameSpentUsd: played.reduce((s, x) => s + x.costUsd, 0),
        usage: { w: side(0), b: side(1) },
      },
    })
  })
  // Newer routes win: this budget lists the seatable models and Jev's month so far.
  await page.route('**/api/game/budget', (r) =>
    r.fulfill({
      json: {
        budgetLeftUsd: 12.5,
        monthlyUsd: 20,
        byModel: { jev: { costUsd: 0.0003, ms: 1700, inputTokens: 7000, outputTokens: 1500, calls: 10 } },
        earlierUsd: 0,
        models: ALL_MODELS,
      },
    }),
  )
  const startBodies: unknown[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/api/game/start')) startBodies.push(req.postDataJSON())
  })
  await page.goto('/')

  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await expect(page.getByTestId('claude-white').locator('option[value="jev"]')).toHaveText('TypeSafe Jev')
  await page.getByTestId('claude-white').selectOption('jev')
  await page.getByTestId('claude-black').selectOption('haiku')
  await expect(page.getByTestId('claude-month')).toHaveText('This month: Jev $0.00 (10 calls, 0.2 s/call)')
  await expect(page.getByTestId('claude-seat-hint')).toHaveCount(0)
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('claude-record')).toHaveText('Jev 1 – 0 Haiku 4.5 · 2 draws')
  await expect(page.getByTestId('claude-thinking')).toContainText('Jev is thinking')
  // After Jev's first move the line under the board is its probability, nothing invented.
  await expect(page.getByTestId('claude-why')).toHaveText("Jev's pick (p 0.27)")
  await expect(page.getByTestId('game-end-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('game-end-headline')).toHaveText('Checkmate — Black wins')
  await expect(page.getByTestId('claude-cost-w')).toHaveText('· Jev $0.00')
  await expect(page.getByTestId('claude-cost-b')).toHaveText('· Haiku 4.5 $0.01')

  expect(startBodies).toEqual([{ white: 'jev', black: 'haiku' }])
  expect(calls.move).toEqual([[], ['f3'], ['f3', 'e5'], ['f3', 'e5', 'g4']])
  await expect.poll(() => calls.end).toBe(1)
  expect(calls.record[0]).toEqual({ url: '/api/game/record?white=jev&black=haiku', afterEnd: false })
})

test('a server without TYPESAFE_API_KEY: Jev is disabled in both seats, a Claude game still starts', async ({ page }) => {
  const calls = await stubGame(page, (route) =>
    route.fulfill({ status: 402, json: { error: { kind: 'budget', message: 'x' } } }),
  )
  await page.route('**/api/game/budget', (r) =>
    r.fulfill({ json: { budgetLeftUsd: 12.5, monthlyUsd: 20, byModel: {}, earlierUsd: 0, models: ALL_MODELS.slice(0, 4) } }),
  )
  await page.goto('/')
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  for (const seat of ['claude-white', 'claude-black']) {
    const jev = page.getByTestId(seat).locator('option[value="jev"]')
    await expect(jev).toHaveJSProperty('disabled', true)
    await expect(jev).toHaveText('TypeSafe Jev (no TYPESAFE_API_KEY)')
  }
  await page.getByTestId('claude-white').selectOption('opus')
  await page.getByTestId('claude-black').selectOption('haiku')
  await expect(page.getByTestId('new-game')).toBeEnabled()
  await page.getByTestId('new-game').click()
  await expect.poll(() => calls.start).toBe(1)
})

test('Gemini 3.6 Flash and Gemini 3.1 Pro hold the seats: a scripted game through Vertex AI, stubbed', async ({ page }) => {
  // Priced like the real thing: a few hundred prompt tokens and some thinking billed as output.
  const GEMINI_SCRIPT = [
    { san: 'f3', why: 'Prepares g4 for a kingside expansion.', costUsd: 0.0012 },
    { san: 'e5', why: 'Takes the centre and opens the diagonal for the queen.', costUsd: 0.0031 },
    { san: 'g4', why: 'Continues the kingside pawn advance.', costUsd: 0.0013 },
    { san: 'Qh4#', why: 'The queen mates along the opened e1-h4 diagonal.', costUsd: 0.0034 },
  ]
  let n = 0
  const calls = await stubGame(page, (route) => {
    const step = GEMINI_SCRIPT[n]!
    n++
    const played = GEMINI_SCRIPT.slice(0, n)
    const side = (parity: number) => {
      const steps = played.filter((_, i) => i % 2 === parity)
      return {
        costUsd: steps.reduce((s, x) => s + x.costUsd, 0),
        ms: steps.length * 2500,
        inputTokens: steps.length * 300,
        outputTokens: steps.length * 120,
        calls: steps.length,
      }
    }
    return route.fulfill({
      json: {
        san: step.san,
        why: step.why,
        costUsd: step.costUsd,
        gameSpentUsd: played.reduce((s, x) => s + x.costUsd, 0),
        usage: { w: side(0), b: side(1) },
      },
    })
  })
  await page.route('**/api/game/budget', (r) =>
    r.fulfill({
      json: {
        budgetLeftUsd: 12.5,
        monthlyUsd: 20,
        byModel: { 'gemini-pro': { costUsd: 0.031, ms: 40_000, inputTokens: 3000, outputTokens: 1200, calls: 10 } },
        earlierUsd: 0,
        models: ALL_MODELS,
      },
    }),
  )
  const startBodies: unknown[] = []
  page.on('request', (req) => {
    if (req.url().endsWith('/api/game/start')) startBodies.push(req.postDataJSON())
  })
  await page.goto('/')

  await page.getByTestId('mode').selectOption('claude-vs-claude')
  await expect(page.getByTestId('claude-white').locator('option[value="gemini-flash"]')).toHaveText('Gemini 3.6 Flash')
  await expect(page.getByTestId('claude-black').locator('option[value="gemini-pro"]')).toHaveText('Gemini 3.1 Pro')
  await page.getByTestId('claude-white').selectOption('gemini-flash')
  await page.getByTestId('claude-black').selectOption('gemini-pro')
  await expect(page.getByTestId('claude-month')).toHaveText('This month: Gemini Pro $0.03 (10 calls, 4.0 s/call)')
  await expect(page.getByTestId('claude-seat-hint')).toHaveCount(0)
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('claude-record')).toHaveText('Gemini 3.6 Flash 1 – 0 Gemini 3.1 Pro · 2 draws')
  await expect(page.getByTestId('claude-thinking')).toContainText('Gemini 3.6 Flash is thinking')
  await expect(page.getByTestId('claude-why')).toHaveText('Prepares g4 for a kingside expansion.')
  await expect(page.getByTestId('game-end-card')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('game-end-headline')).toHaveText('Checkmate — Black wins')
  await expect(page.getByTestId('claude-cost-w')).toHaveText('· Gemini 3.6 Flash $0.00')
  await expect(page.getByTestId('claude-cost-b')).toHaveText('· Gemini 3.1 Pro $0.01')

  expect(startBodies).toEqual([{ white: 'gemini-flash', black: 'gemini-pro' }])
  expect(calls.move).toEqual([[], ['f3'], ['f3', 'e5'], ['f3', 'e5', 'g4']])
  await expect.poll(() => calls.end).toBe(1)
  expect(calls.record[0]).toEqual({ url: '/api/game/record?white=gemini-flash&black=gemini-pro', afterEnd: false })
})

test('a server without Google ADC: Gemini is disabled in both seats and a Gemini seat cannot start', async ({ page }) => {
  const calls = await stubGame(page, (route) =>
    route.fulfill({ status: 402, json: { error: { kind: 'budget', message: 'x' } } }),
  )
  await page.route('**/api/game/budget', (r) =>
    r.fulfill({ json: { budgetLeftUsd: 12.5, monthlyUsd: 20, byModel: {}, earlierUsd: 0, models: ALL_MODELS.slice(0, 5) } }),
  )
  await page.goto('/')
  await page.getByTestId('mode').selectOption('claude-vs-claude')
  for (const seat of ['claude-white', 'claude-black']) {
    for (const [key, label] of [['gemini-pro', 'Gemini 3.1 Pro'], ['gemini-flash', 'Gemini 3.6 Flash']]) {
      const option = page.getByTestId(seat).locator(`option[value="${key}"]`)
      await expect(option).toHaveJSProperty('disabled', true)
      await expect(option).toHaveText(`${label} (no Google ADC)`)
    }
  }
  await page.getByTestId('claude-white').selectOption('jev')
  await page.getByTestId('claude-black').selectOption('haiku')
  await expect(page.getByTestId('new-game')).toBeEnabled()
  await page.getByTestId('new-game').click()
  await expect.poll(() => calls.start).toBe(1)
})
