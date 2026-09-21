import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

declare global {
  interface Window {
    __audio: { contexts: number; tones: number }
  }
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.addInitScript(() => {
    const log = { contexts: 0, tones: 0 }
    window.__audio = log
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
    class Node_ { connect(n: unknown) { return n } }
    class Osc extends Node_ { type = 'sine'; frequency = param(); start() { log.tones++ } stop() {} }
    class Gain extends Node_ { gain = param() }
    class Ctx {
      currentTime = 0
      state = 'running'
      destination = new Node_()
      constructor() { log.contexts++ }
      resume() { return Promise.resolve() }
      createOscillator() { return new Osc() }
      createGain() { return new Gain() }
    }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = Ctx
  })
  await page.goto('/')
})

const audio = (page: import('@playwright/test').Page) => page.evaluate(() => window.__audio)

test('no audio before a gesture; a move plays; mute persists', async ({ page }) => {
  expect(await audio(page)).toEqual({ contexts: 0, tones: 0 })

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect.poll(async () => (await audio(page)).tones).toBeGreaterThan(0)
  expect((await audio(page)).contexts).toBe(1)

  await page.getByTestId('sound-toggle').uncheck()
  const before = (await audio(page)).tones
  await page.locator('[data-square="e7"]').click()
  await page.locator('[data-square="e5"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2')
  expect((await audio(page)).tones).toBe(before)

  await page.reload()
  await page.getByTestId('resume-decline').click()
  await expect(page.getByTestId('sound-toggle')).not.toBeChecked()
})

test('importing a game is silent', async ({ page }) => {
  await page.getByTestId('import-text').fill('1. e4 e5 2. Nf3 Nc6 *')
  await page.getByTestId('import-submit').click() // this click unlocks audio
  await expect(page.getByTestId('ply-count')).toHaveText('4')
  expect((await audio(page)).tones).toBe(0)
})
