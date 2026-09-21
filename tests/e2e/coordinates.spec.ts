import { expect, test, type Locator } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

test('coordinates line up with the squares from outside the board, and flip', async ({ page }) => {
  await page.goto('/')
  const board = page.getByRole('grid', { name: 'Chess board' })

  for (const flip of [false, true]) {
    if (flip) await page.getByTestId('flip').click()
    const box = await board.boundingBox()
    if (!box) throw new Error('no board box')

    for (const file of ['a', 'e', 'h']) {
      const label = await center(page.getByTestId(`coord-file-${file}`))
      const square = await center(page.locator(`[data-square="${file}4"]`))
      expect(Math.abs(label.x - square.x)).toBeLessThan(3)
      expect(label.y).toBeGreaterThan(box.y + box.height) // beneath the board
    }
    for (const rank of ['1', '5', '8']) {
      const label = await center(page.getByTestId(`coord-rank-${rank}`))
      const square = await center(page.locator(`[data-square="d${rank}"]`))
      expect(Math.abs(label.y - square.y)).toBeLessThan(3)
      expect(label.x).toBeLessThan(box.x) // left of the board
    }
    // The board is still square.
    expect(Math.abs(box.width - box.height)).toBeLessThan(2)
  }

  await expect(page.locator('[data-square] .coord')).toHaveCount(0)

  // Clicking still works with the new wrapper.
  await page.getByTestId('flip').click()
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`coordinates are readable in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    const fg = await page.getByTestId('coord-file-a').evaluate((el) => getComputedStyle(el).color)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
    // WCAG AA for normal text; opacity 0.8 still clears it with the theme tokens.
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThan(4.5)
  })
}
