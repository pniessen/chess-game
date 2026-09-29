import { describe, expect, test } from 'vitest'
import { CLAUDE_GAMES, claudeGamesEnabled } from './enabled'

describe('claudeGamesEnabled', () => {
  test("on under the dev server (npm run dev: mode 'development'), whatever the flag says", () => {
    expect(claudeGamesEnabled({ MODE: 'development' })).toBe(true)
    expect(claudeGamesEnabled({ MODE: 'development', VITE_CLAUDE_GAMES: 'off' })).toBe(true)
  })

  test("on in a production build only with VITE_CLAUDE_GAMES=on (npm run start:claude)", () => {
    expect(claudeGamesEnabled({ MODE: 'production', VITE_CLAUDE_GAMES: 'on' })).toBe(true)
  })

  // Red if a public build (Netlify, GitHub Pages: no flag) offers the mode.
  test('off in a production build without the flag, or with any other value', () => {
    expect(claudeGamesEnabled({ MODE: 'production' })).toBe(false)
    expect(claudeGamesEnabled({ MODE: 'production', VITE_CLAUDE_GAMES: 'true' })).toBe(false)
    expect(claudeGamesEnabled({ MODE: 'production', VITE_CLAUDE_GAMES: '1' })).toBe(false)
    expect(claudeGamesEnabled({ MODE: 'production', VITE_CLAUDE_GAMES: '' })).toBe(false)
  })

  // NODE_ENV=development (shell, .env, Netlify UI) makes Vite's DEV true in a
  // `vite build`, but the mode stays 'production': the gate must not follow DEV.
  test('off in a production-mode build even when DEV is true (NODE_ENV=development)', () => {
    expect(claudeGamesEnabled({ MODE: 'production', DEV: true } as Parameters<typeof claudeGamesEnabled>[0])).toBe(false)
  })

  test('off in any other mode without the flag (e.g. vitest\'s own "test" mode)', () => {
    expect(claudeGamesEnabled({ MODE: 'test' })).toBe(false)
    expect(claudeGamesEnabled({ MODE: 'staging' })).toBe(false)
  })
})

test('the build-time constant follows the same rule for this environment', () => {
  expect(CLAUDE_GAMES).toBe(claudeGamesEnabled(import.meta.env))
  // Vitest runs in mode 'test'; vite.config.ts sets VITE_CLAUDE_GAMES=on for
  // the unit tests so every one of them sees the Claude UI.
  expect(import.meta.env.MODE).toBe('test')
  expect(CLAUDE_GAMES).toBe(true)
})
