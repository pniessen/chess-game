import { expect, test, type Page } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

/**
 * Engine recovery (Phase 2 follow-ups, Task 3): when the Stockfish worker
 * dies mid-game, the app replaces it and the engine keeps replying.
 *
 * Kill hook: test-side only. An init script wraps the page's `Worker`
 * constructor to remember every worker the app creates (and whether it was
 * terminated). "Killing" the live worker terminates it and fires the same
 * `error` event a crashed/failed worker fires, which is exactly what the
 * app listens for. No app code is involved, so production is untouched.
 *
 * Turns red if: the supervisor stops replacing a dead worker (the game ends
 * "Game halted — engine error" / the unavailable banner shows), the owed
 * move isn't re-requested on the new worker (ply count stuck at 1), the
 * dead worker is left alive (live worker count 2), or the restart status
 * never clears.
 */

declare global {
  interface Window {
    __workers: Array<{ worker: Worker; terminated: boolean }>
  }
}

async function trackWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Native = window.Worker
    window.__workers = []
    window.Worker = class extends Native {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts)
        const entry = { worker: this as Worker, terminated: false }
        window.__workers.push(entry)
        const terminate = this.terminate.bind(this)
        this.terminate = () => {
          entry.terminated = true
          terminate()
        }
      }
    }
  })
}

const liveWorkers = (page: Page) => page.evaluate(() => window.__workers.filter((w) => !w.terminated).length)

async function killLiveWorker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const live = window.__workers.filter((w) => !w.terminated)
    if (live.length !== 1) throw new Error(`expected one live worker, found ${live.length}`)
    const { worker } = live[0]!
    // Stop the real worker from ever answering again, then report it the way
    // the browser reports a crashed or failed-to-load worker.
    worker.terminate()
    worker.dispatchEvent(new ErrorEvent('error', { message: 'killed by e2e' }))
  })
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await trackWorkers(page)
})

test('the engine still replies after its worker dies mid-game', async ({ page }) => {
  const warnings: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text())
  })
  await page.goto('/')
  // Level 8: no book moves, and a 2 s search, so the kill below lands while
  // the engine still owes its reply (the re-request path, not just a fresh
  // search on the new worker).
  await startOnePlayer(page, '8')
  await expect.poll(() => liveWorkers(page)).toBe(1)

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
  // (The dev server runs StrictMode, which builds and disposes one extra
  // bundle on mount, so count from here rather than from zero.)
  const createdBefore = await page.evaluate(() => window.__workers.length)
  await killLiveWorker(page)

  // A fresh worker replaces the dead one; the owed reply arrives from it.
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
  await expect(page.getByTestId('engine-status')).toHaveCount(0)
  await expect(page.getByTestId('result')).not.toHaveText(/engine error/i)
  await expect(page.getByText(/engine is unavailable/i)).toHaveCount(0)
  expect(await liveWorkers(page)).toBe(1)
  expect(await page.evaluate(() => window.__workers.length)).toBe(createdBefore + 1)
  expect(warnings.filter((w) => w.includes('Stockfish engine restarted after: worker error: killed by e2e'))).toHaveLength(1)

  // And it keeps playing.
  await page.locator('[data-square="d2"]').click()
  await page.locator('[data-square="d4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('4', { timeout: 30_000 })
})

test('while the replacement loads, the status area says "Engine restarting…"', async ({ page }) => {
  await page.goto('/')
  await startOnePlayer(page, '1')
  await expect.poll(() => liveWorkers(page)).toBe(1)
  // Hold the replacement's engine files so the restarting state is visible.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/engine/**', async (route) => {
    await held
    await route.continue()
  })

  await killLiveWorker(page)
  await expect(page.getByTestId('engine-status')).toHaveText('Engine restarting…')
  release()
  await expect(page.getByTestId('engine-status')).toHaveCount(0, { timeout: 30_000 })

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
})
