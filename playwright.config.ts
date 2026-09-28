import { defineConfig } from '@playwright/test'

/**
 * The dev server's port. Override with `PW_PORT` when running suites from
 * more than one worktree at once — which this repo now routinely is.
 *
 * Why this is configurable at all: `reuseExistingServer` means a suite
 * will happily bind to whatever is already answering on the port, even a
 * dev server belonging to a DIFFERENT checkout. That fails silently and
 * in the worst possible direction — the run goes green against code you
 * are not testing. It has cost several sessions real time here, including
 * one full suite that "passed" against a sibling worktree's build.
 *
 * So setting `PW_PORT` also turns `reuseExistingServer` OFF: if you have
 * named a port explicitly, you want YOUR server on it, and `--strictPort`
 * makes a collision an error rather than a silent hop to the next free
 * port. The default path (no PW_PORT, single checkout) keeps the old
 * behaviour.
 *
 * To be certain the server you are measuring is yours, curl a file you
 * have changed and grep it — owning the port is not the same as serving
 * your tree.
 */
const PORT = Number(process.env['PW_PORT'] ?? 5173)
const ORIGIN = `http://localhost:${PORT}`
const EXPLICIT_PORT = Boolean(process.env['PW_PORT'])

/**
 * The focus trap is the one piece of behaviour whose correctness depends
 * on the browser's own tab-order policy — macOS Safari's default tab mode
 * does not treat buttons, radios or checkboxes as tab stops, which is what
 * broke the popovers' trap (see `usePopover`'s `handleKeyDown`). So that
 * spec, and only that spec, also runs in WebKit and Firefox; everything
 * else stays on Chromium, where it has always run.
 */
const CROSS_BROWSER = /popover-focus-trap\.spec\.ts/

export default defineConfig({
  testDir: './tests/e2e',
  // Engine specs are timing-sensitive; run them one at a time.
  workers: 1,
  timeout: 60_000,
  use: { baseURL: ORIGIN },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: CROSS_BROWSER },
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: CROSS_BROWSER },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env['CI'] && !EXPLICIT_PORT,
    timeout: 60_000,
  },
})
