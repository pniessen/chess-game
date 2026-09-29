import { describe, expect, test } from 'vitest'
import { CLAUDE_GAMES, claudeGamesEnabled } from './enabled'

describe('claudeGamesEnabled', () => {
  test('on in dev (npm run dev), whatever the flag says', () => {
    expect(claudeGamesEnabled({ DEV: true })).toBe(true)
    expect(claudeGamesEnabled({ DEV: true, VITE_CLAUDE_GAMES: 'off' })).toBe(true)
  })

  test("on in a production build only with VITE_CLAUDE_GAMES=on (npm run start:claude)", () => {
    expect(claudeGamesEnabled({ DEV: false, VITE_CLAUDE_GAMES: 'on' })).toBe(true)
  })

  // Red if a public build (Netlify, GitHub Pages: no flag) offers the mode.
  test('off in a production build without the flag, or with any other value', () => {
    expect(claudeGamesEnabled({ DEV: false })).toBe(false)
    expect(claudeGamesEnabled({ DEV: false, VITE_CLAUDE_GAMES: 'true' })).toBe(false)
    expect(claudeGamesEnabled({ DEV: false, VITE_CLAUDE_GAMES: '1' })).toBe(false)
    expect(claudeGamesEnabled({ DEV: false, VITE_CLAUDE_GAMES: '' })).toBe(false)
  })
})

test('the build-time constant follows the same rule for this environment', () => {
  expect(CLAUDE_GAMES).toBe(claudeGamesEnabled(import.meta.env))
  // Vitest runs in dev mode, so every unit test sees the Claude UI.
  expect(CLAUDE_GAMES).toBe(true)
})
