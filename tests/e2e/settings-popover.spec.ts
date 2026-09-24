import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openSettings } from './helpers'

/**
 * Task 12: the settings popover.
 *
 * Each test names the change that turns it red:
 *  - keyboard: turns red if the trigger loses its label/`aria-expanded`, if
 *    the focus trap is dropped, if Escape stops closing it, if focus stops
 *    returning to the trigger, or if `aria-modal` is ever added back.
 *  - previews: turns red if a preview stops rendering the real piece SVG
 *    through `pieceImageSrc` (e.g. a hand-built `/pieces/...` string, which
 *    would 404 under the GitHub Pages base path).
 *  - volume: turns red if volume stops scaling playback, stops persisting,
 *    stops being applied on reload, or starts doubling as the mute switch.
 *  - appearance: turns red if light/dark/system stops driving `data-theme`.
 *  - phone: turns red if the popover stops fitting a 375px viewport.
 *  - reduced motion: turns red if the open animation stops being dropped.
 *
 * Nothing here asserts a mid-animation frame: every assertion is on an end
 * state, a class, or an attribute.
 */

declare global {
  interface Window {
    __gains: number[]
  }
}

/** An AudioContext stub that records the peak gain of every tone scheduled. */
async function recordGains(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const gains: number[] = []
    window.__gains = gains
    class Node_ {
      connect(n: unknown) {
        return n
      }
    }
    class Osc extends Node_ {
      type = 'sine'
      frequency = { value: 0 }
      start() {}
      stop() {}
    }
    class Gain extends Node_ {
      gain = {
        value: 0,
        setValueAtTime: (v: number) => gains.push(v),
        exponentialRampToValueAtTime() {},
      }
    }
    class Ctx {
      currentTime = 0
      state = 'running'
      destination = new Node_()
      resume() {
        return Promise.resolve()
      }
      createOscillator() {
        return new Osc()
      }
      createGain() {
        return new Gain()
      }
    }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = Ctx
  })
}

const lastGain = (page: Page) => page.evaluate(() => window.__gains[window.__gains.length - 1] ?? null)
const gainCount = (page: Page) => page.evaluate(() => window.__gains.length)

/** Where focus is, as a test id (or the tag name when it carries none). */
const focusedTestId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.dataset['testid'] ?? el?.tagName ?? null
  })

const focusInsidePopover = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[data-testid="settings"]'))

test.beforeEach(async ({ page }) => coachOffline(page))

test('the popover opens from a labelled control, traps focus, and Escape gives it back', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByTestId('settings-toggle')
  await expect(trigger).toHaveAccessibleName(/settings/i)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('settings')).toHaveCount(0)

  await trigger.click()
  const popover = page.getByTestId('settings')
  await expect(popover).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(popover).toHaveRole('dialog')
  await expect(popover).toHaveAccessibleName('Settings')
  // NOT a modal: the game behind stays live, so claiming modality would be
  // a lie to assistive tech (the correction already made in Task 6).
  expect(await popover.getAttribute('aria-modal')).toBeNull()

  // Focus lands on the popover itself, then cycles inside it however long
  // you keep tabbing.
  expect(await focusedTestId(page)).toBe('settings')
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await focusInsidePopover(page)).toBe(true)
  }
  // Shift+Tab off the front wraps to the back, not out of the popover.
  await page.keyboard.press('Shift+Tab')
  expect(await focusInsidePopover(page)).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings')).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(await focusedTestId(page)).toBe('settings-toggle')
})

test('the game stays usable behind it: a board click plays the move and dismisses it', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  await page.locator('[data-square="e2"]').click()
  await expect(page.getByTestId('settings')).toHaveCount(0)
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})

test('the previews show the real board colours and the real piece SVGs', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)

  // Built through pieceImageSrc/assetUrl, so they carry the deploy base.
  await expect(page.getByTestId('piece-preview-rhosgfx-wN')).toHaveAttribute('src', '/pieces/rhosgfx/wN.svg')
  await expect(page.getByTestId('piece-preview-cburnett-wN')).toHaveAttribute('src', '/pieces/cburnett/wN.svg')
  await expect(page.getByTestId('piece-preview-cburnett-bP')).toHaveAttribute('src', '/pieces/cburnett/bP.svg')

  // Choosing the set updates both the board and every other preview.
  await page.getByTestId('piece-set-cburnett').check()
  await expect(page.locator('[data-square="e1"] [data-piece="wK"]')).toHaveAttribute(
    'src',
    '/pieces/cburnett/wK.svg',
  )
  await expect(page.getByTestId('board-theme-blue').locator('..').locator('img').first()).toHaveAttribute(
    'src',
    '/pieces/cburnett/wN.svg',
  )
})

test('volume scales playback, persists, survives a reload, and mute stays independent', async ({ page }) => {
  await recordGains(page)
  await page.goto('/')

  // The unscaled move tone (SOUND_TONES.move[0].gain).
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect.poll(() => gainCount(page)).toBeGreaterThan(0)
  expect(await lastGain(page)).toBeCloseTo(0.25, 5)

  await openSettings(page)
  await page.getByTestId('volume').fill('20')
  await expect(page.getByTestId('volume-value')).toHaveText('20%')
  await page.keyboard.press('Escape')

  await page.locator('[data-square="e7"]').click()
  await page.locator('[data-square="e5"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2')
  expect(await lastGain(page)).toBeCloseTo(0.05, 5)

  // Mute is a switch, not "volume 0": it silences at any volume, and the
  // volume it was set to is still there afterwards.
  await openSettings(page)
  await page.getByTestId('sound-toggle').uncheck()
  await page.keyboard.press('Escape')
  const muted = await gainCount(page)
  await page.locator('[data-square="g1"]').click()
  await page.locator('[data-square="f3"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('3')
  expect(await gainCount(page)).toBe(muted)

  await openSettings(page)
  await expect(page.getByTestId('volume-value')).toHaveText('20%')
  await page.getByTestId('sound-toggle').check()
  await page.keyboard.press('Escape')

  // Applied on reload, from storage.
  await page.reload()
  await page.getByTestId('resume-accept').click()
  await page.locator('[data-square="b8"]').click()
  await page.locator('[data-square="c6"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('4')
  expect(await lastGain(page)).toBeCloseTo(0.05, 5)
  await openSettings(page)
  await expect(page.getByTestId('volume-value')).toHaveText('20%')
})

test('light / dark / system drives the root theme attribute and persists', async ({ page }) => {
  await page.goto('/')
  const root = page.locator('html')
  await openSettings(page)
  await expect(page.getByTestId('appearance-system')).toBeChecked()
  expect(await root.getAttribute('data-theme')).toBeNull()

  await page.getByTestId('appearance-dark').check()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.getByTestId('appearance-light').check()
  await expect(root).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await openSettings(page)
  await expect(page.getByTestId('appearance-light')).toBeChecked()

  await page.getByTestId('appearance-system').check()
  expect(await root.getAttribute('data-theme')).toBeNull()
})

test('it fits inside a 375px phone viewport, and scrolls rather than overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  const pageOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const before = await pageOverflow()
  await openSettings(page)

  const box = await page.getByTestId('settings').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  // Taller than the viewport is fine — overflowing it is not.
  expect(box!.height).toBeLessThanOrEqual(812)
  await expect(page.getByTestId('settings')).toHaveCSS('overflow-y', 'auto')

  // The popover adds no horizontal page overflow of its own.
  expect(await pageOverflow()).toBeLessThanOrEqual(before)

  // Every control is still reachable and the last one still closes it.
  await page.getByTestId('settings-done').click()
  await expect(page.getByTestId('settings')).toHaveCount(0)
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the open animation is dropped entirely', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)
    await expect(page.getByTestId('settings')).toHaveCSS('animation-name', 'none')
  })
})
