import { defineConfig } from '@playwright/test'

/**
 * The dev server's port. Override with `PW_PORT` when running suites from
 * more than one worktree at once — which this repo now routinely is.
 *
 * Why this is configurable at all: `reuseExistingServer` means a suite
 * will happily bind to whatever is already answering on the port, even a
 * dev server belonging to a DIFFERENT checkout. That fails silently and
 * in the worst possible direction — the run goes green against code you
 * are not testing. It has cost several sessions real time here.
 *
 * So setting `PW_PORT` also turns `reuseExistingServer` OFF: if you have
 * named a port explicitly, you want YOUR server on it, and a port that is
 * already taken should fail loudly rather than be quietly adopted. The
 * default path (no PW_PORT, single checkout) keeps the old behaviour.
 *
 * To be certain the server you are measuring is yours, curl a file you
 * have changed and grep it — owning the port is not the same as serving
 * your tree.
 */
const PORT = Number(process.env['PW_PORT'] ?? 5173)
const ORIGIN = `http://localhost:${PORT}`
const EXPLICIT_PORT = Boolean(process.env['PW_PORT'])

export default defineConfig({
  testDir: './tests/e2e',
  // Engine specs are timing-sensitive; run them one at a time.
  workers: 1,
  timeout: 60_000,
  use: { baseURL: ORIGIN },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env['CI'] && !EXPLICIT_PORT,
    timeout: 60_000,
  },
})
