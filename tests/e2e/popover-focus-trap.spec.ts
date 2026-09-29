import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openGameFile, openSettings } from './helpers'

/**
 * The focus trap shared by both header popovers, run in Chromium, WebKit
 * and Firefox (see `playwright.config.ts` — this is the only spec that
 * runs in all three).
 *
 * It is here because the trap was broken in Safari and no Chromium-only
 * suite could have caught it. macOS Safari's default tab mode ("Press Tab
 * to highlight each item" turned OFF) does not make buttons, radios or
 * checkboxes tab stops, so the previous ends-only trap — which waited for
 * focus to reach the last element before wrapping — never fired: `Done` is
 * a button, Safari never focused it, and Tab walked out into the New game
 * panel and the move-list tabs behind. Settings was worse: none of its
 * controls are tab stops in that mode, so Tab never entered it at all.
 *
 * What each test pins down:
 *  - the two `cycles` tests go red if Tab stops visiting every control in
 *    order, stops wrapping at either end, or escapes the popover. In
 *    WebKit they go red the moment the trap goes back to trusting the
 *    browser's idea of a tab stop.
 *  - `one tab stop per radio group` goes red if `tabbables` loses its
 *    radio-group rule and the trap starts handing focus to an UNCHECKED
 *    radio — from which a single arrow key silently changes the setting.
 *    That is the failure mode a naive querySelectorAll trap introduces,
 *    so it is asserted directly rather than implied by the order above.
 *  - `no setting is changed` goes red if merely tabbing through the
 *    popover mutates what it is showing.
 */

/** Where focus is, as a test id (or the tag name when it carries none). */
const focusedTestId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.dataset['testid'] ?? el?.tagName ?? null
  })

const focusInside = (page: Page, popover: string) =>
  page.evaluate(
    (p) => document.querySelector(`[data-testid="${p}"]`)?.contains(document.activeElement) ?? false,
    popover,
  )

/**
 * The controls of each popover, in the order Tab must visit them. These are
 * the orders Chromium and Firefox already produced natively before the fix;
 * WebKit produced neither. Note `appearance-system` rather than
 * `appearance-light`: the stop a radio group contributes is its CHECKED
 * button, not its first.
 */
const POPOVERS = [
  {
    name: 'Game file',
    open: openGameFile,
    popover: 'game-file',
    trigger: 'game-file-toggle',
    order: ['export-pgn', 'share-link', 'import-text', 'import-file', 'import-submit', 'game-file-done'],
  },
  {
    name: 'Settings',
    open: openSettings,
    popover: 'settings',
    trigger: 'settings-toggle',
    order: [
      'board-theme-classic',
      'piece-set-rhosgfx',
      'appearance-system',
      'sound-toggle',
      'volume',
      'eval-toggle',
      // Claude vs Claude's owner token (a build with coaching, as here).
      // Its Save is disabled while the field is empty, so not a stop.
      'owner-token',
      'settings-done',
    ],
  },
] as const

test.beforeEach(async ({ page }) => coachOffline(page))

for (const { name, open, popover, trigger, order } of POPOVERS) {
  test.describe(name, () => {
    test('Tab cycles every control in order and wraps without escaping', async ({ page }) => {
      await page.goto('/')
      await open(page)

      // Focus lands on the popover itself, so a screen reader announces its
      // label before the contents.
      expect(await focusedTestId(page)).toBe(popover)

      // Two full laps: the first proves the order, the second proves the
      // wrap is a cycle and not a one-off bounce off the end.
      for (const lap of [1, 2]) {
        for (const id of order) {
          await page.keyboard.press('Tab')
          expect(await focusedTestId(page), `lap ${lap}, forward`).toBe(id)
          expect(await focusInside(page, popover)).toBe(true)
        }
      }

      // And backwards, from the first control off the front to the last.
      await page.keyboard.press('Tab')
      expect(await focusedTestId(page)).toBe(order[0])
      for (const id of [...order].reverse()) {
        await page.keyboard.press('Shift+Tab')
        expect(await focusedTestId(page), 'backward').toBe(id)
        expect(await focusInside(page, popover)).toBe(true)
      }

      await page.keyboard.press('Escape')
      await expect(page.getByTestId(popover)).toHaveCount(0)
      await expect(page.getByTestId(trigger)).toBeFocused()
    })

    test('Tab never reaches the page behind, or the other popover', async ({ page }) => {
      await page.goto('/')
      await open(page)

      // Well past a full lap, in both directions. The measured escape
      // landed on `mode` / `time-control` / `tab-moves` within four
      // presses, so this would have failed immediately in WebKit.
      for (const key of ['Tab', 'Shift+Tab'] as const) {
        for (let i = 0; i < order.length * 2 + 3; i += 1) {
          await page.keyboard.press(key)
          expect(await focusInside(page, popover), `after ${key} #${i + 1}`).toBe(true)
        }
      }

      // Nothing behind the popover was ever focused, and no second popover
      // with a second live trap was opened on the way.
      for (const id of ['mode', 'time-control', 'tab-moves', 'new-game']) {
        await expect(page.getByTestId(id)).not.toBeFocused()
      }
      const other = popover === 'settings' ? 'game-file' : 'settings'
      await expect(page.getByTestId(other)).toHaveCount(0)
      await expect(page.getByTestId(`${other}-toggle`)).not.toBeFocused()
    })
  })
}

test.describe('Settings radio groups', () => {
  /**
   * The regression this guards against is silent: a trap that treats every
   * radio as a tab stop hands focus to an unchecked one, and because a
   * radio group responds to arrow keys by SELECTING as it moves, the next
   * arrow press changes the board theme without the user asking. So the
   * assertion is not just "the order is right" but "no unchecked radio is
   * ever focused".
   */
  test('a radio group is one tab stop, and it is the checked button', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)

    const groups = ['board-theme', 'piece-set', 'appearance']
    const visited: string[] = []
    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press('Tab')
      const state = await page.evaluate(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return null
        return { name: el.name, id: el.dataset['testid'] ?? '', checked: el.checked }
      })
      if (!state) continue
      // The heart of it: focus only ever rests on a CHECKED radio.
      expect(state.checked, `${state.id} was focused while unchecked`).toBe(true)
      visited.push(`${state.name}:${state.id}`)
    }

    // Exactly one stop per group, twice over the two laps those 16 presses
    // cover — never two buttons of the same group.
    for (const group of groups) {
      const stops = new Set(visited.filter((v) => v.startsWith(`${group}:`)))
      expect([...stops], `${group} contributed more than one tab stop`).toHaveLength(1)
    }
  })

  test('tabbing through the popover changes no setting', async ({ page }) => {
    await page.goto('/')
    await openSettings(page)

    const snapshot = () =>
      page.evaluate(() => ({
        radios: [...document.querySelectorAll<HTMLInputElement>('[data-testid="settings"] input[type="radio"]')]
          .filter((r) => r.checked)
          .map((r) => r.dataset['testid']),
        theme: document.documentElement.getAttribute('data-theme'),
        volume: document.querySelector<HTMLOutputElement>('[data-testid="volume-value"]')?.textContent,
      }))

    const before = await snapshot()
    expect(before.radios).toEqual(['board-theme-classic', 'piece-set-rhosgfx', 'appearance-system'])

    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Tab')
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Shift+Tab')

    expect(await snapshot()).toEqual(before)
  })
})
