/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicBuildRefusal } from './scripts/publicBuildGuard'

// The coach server (npm run server). Dev and preview both proxy /api to it,
// so the browser only ever talks to its own origin and never sees the key.
const COACH = 'http://127.0.0.1:8787'

/**
 * Where the app is served from. Default '/' keeps dev, `npm run preview`,
 * the e2e suite and `npm start` (Express serving dist) exactly as they were;
 * the GitHub Pages workflow builds with BASE_PATH=/chess-game/ because a
 * project page is served from a subdirectory. Everything that builds a URL
 * at runtime goes through `import.meta.env.BASE_URL` (see src/assetUrl.ts),
 * which Vite fills in from this.
 */
const BASE = process.env['BASE_PATH'] ?? '/'

export default defineConfig(({ command, mode }) => {
  // Claude vs Claude is local-only: a deploy build (Netlify CI, netlify-cli,
  // GitHub Actions) must never be built with VITE_CLAUDE_GAMES=on, wherever it
  // came from (shell, .env, .env.local), nor as anything but a production
  // build (a non-production mode, or NODE_ENV=development, which turns DEV on
  // in the bundle). Dev (`vite` serve) is never blocked.
  if (command === 'build') {
    const all = loadEnv(mode, process.cwd(), '')
    const refusal = publicBuildRefusal(
      {
        claudeGamesFlag: all['VITE_CLAUDE_GAMES'],
        mode,
        // loadEnv lets process.env win over the files, and Vite has already
        // defaulted process.env.NODE_ENV by now, so a `.env` NODE_ENV only
        // shows in VITE_USER_NODE_ENV (loadEnv records it there; Vite applies it later).
        nodeEnvs: [process.env['NODE_ENV'], all['NODE_ENV'], process.env['VITE_USER_NODE_ENV']],
      },
      process.env,
    )
    if (refusal) throw new Error(refusal)
  }
  return {
    base: BASE,
    plugins: [react()],
    server: { proxy: { '/api': COACH } },
    preview: { proxy: { '/api': COACH } },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts', 'netlify/**/*.test.ts'],
      exclude: ['tests/e2e/**', 'node_modules/**'],
      // Vitest's mode is 'test', which the Claude-games gate does not treat as
      // dev; the flag keeps the Claude vs Claude UI in every unit test.
      env: { VITE_CLAUDE_GAMES: 'on' },
    },
  }
})
