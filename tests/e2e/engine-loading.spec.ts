import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

/**
 * Task 5: while Stockfish is loading (the very first handshake — nothing to
 * do with a crash/restart, which engine-recovery.spec.ts already covers),
 * the status area shows a knight spinner + "Loading engine…" and the Hint
 * button gets a visible loading state instead of just going disabled and
 * silent. Both clear the moment the engine is actually ready.
 *
 * Hold hook: same technique as engine-recovery.spec.ts's "while the
 * replacement loads" test — route.abort()/continue() on the engine asset
 * requests the real worker makes, so the real handshake is delayed by a
 * real (if brief) amount of time, not a fake timer. No app code is
 * involved.
 */

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
})

test('while Stockfish is loading, the status area and Hint button show a loading state, then clear', async ({
  page,
}) => {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/engine/stockfish*', async (route) => {
    await held
    await route.continue()
  })

  await page.goto('/')

  const status = page.getByTestId('engine-status')
  await expect(status).toHaveText('Loading engine…')
  const hint = page.getByTestId('hint')
  await expect(hint).toBeDisabled()
  await expect(hint).toHaveClass(/hint-loading/)

  release()
  await expect(status).toHaveCount(0, { timeout: 30_000 })
  await expect(hint).not.toHaveClass(/hint-loading/)
  // Two-player, White to move, live position: nothing else should still be
  // holding it disabled once the engine is ready.
  await expect(hint).toBeEnabled()
})

// Red if the restart path's status/Hint treatment regresses while adding
// the loading one above — "restarting" already has its own spec
// (engine-recovery.spec.ts); this only checks the Hint button's new
// loading class rides along with it correctly.
test('the Hint button also shows a loading state while a replacement worker is restarting', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.Worker
    ;(window as unknown as { __workers: Array<{ worker: Worker; terminated: boolean }> }).__workers = []
    window.Worker = class extends Native {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts)
        const entry = { worker: this as Worker, terminated: false }
        ;(window as unknown as { __workers: typeof entry[] }).__workers.push(entry)
        const terminate = this.terminate.bind(this)
        this.terminate = () => {
          entry.terminated = true
          terminate()
        }
      }
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('engine-status')).toHaveCount(0, { timeout: 30_000 })
  const hint = page.getByTestId('hint')
  await expect(hint).toBeEnabled()

  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/engine/stockfish*', async (route) => {
    await held
    await route.continue()
  })
  await page.evaluate(() => {
    const workers = (window as unknown as { __workers: Array<{ worker: Worker; terminated: boolean }> }).__workers
    const live = workers.filter((w) => !w.terminated)
    const { worker } = live[live.length - 1]!
    worker.terminate()
    worker.dispatchEvent(new ErrorEvent('error', { message: 'killed by e2e' }))
  })

  await expect(page.getByTestId('engine-status')).toHaveText('Engine restarting…')
  await expect(hint).toBeDisabled()
  await expect(hint).toHaveClass(/hint-loading/)

  release()
  await expect(page.getByTestId('engine-status')).toHaveCount(0, { timeout: 30_000 })
  await expect(hint).not.toHaveClass(/hint-loading/)
  await expect(hint).toBeEnabled()
})

// Red if the spinner's rotation is not actually disabled by reduced motion
// (the app-wide `.app * { animation: none !important }` rule should cover
// it, but this is the one place that rule's coverage of a brand-new
// element is worth checking directly rather than assuming).
test('reduced motion stops the knight spinner from rotating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/engine/stockfish*', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  const spinner = page.locator('[data-testid="engine-status"] .engine-spinner')
  await expect(spinner).toBeVisible()
  const animationName = await spinner.evaluate((el) => getComputedStyle(el, '::before').animationName)
  expect(animationName).toBe('none')
  release()
})
