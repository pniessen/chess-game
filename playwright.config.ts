import { defineConfig } from '@playwright/test'

/**
 * `reuseExistingServer` will happily adopt whatever is already listening on
 * this port — including a sibling git worktree's `npm run dev`, which serves
 * a DIFFERENT checkout and would quietly make every result meaningless
 * (observed: a run that "passed" against another worktree's build). Naming
 * `E2E_PORT` therefore also turns reuse OFF: if you asked for a specific
 * port, you want YOUR server on it, and `--strictPort` makes a collision an
 * error instead of a silent hop to the next free port.
 */
const port = Number(process.env['E2E_PORT'] ?? 5173)
const baseURL = `http://localhost:${port}`

/**
 * The focus trap is the one piece of behaviour whose correctness depends on
 * the browser's own tab-order policy — macOS Safari's default tab mode does
 * not treat buttons, radios or checkboxes as tab stops, which is what broke
 * the popovers' trap (see `usePopover`'s `handleKeyDown`). So that spec, and
 * only that spec, also runs in WebKit and Firefox; everything else stays on
 * Chromium, where it has always run.
 */
const CROSS_BROWSER = /popover-focus-trap\.spec\.ts/

export default defineConfig({
  testDir: './tests/e2e',
  // Engine specs are timing-sensitive; run them one at a time.
  workers: 1,
  timeout: 60_000,
  use: { baseURL },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: CROSS_BROWSER },
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: CROSS_BROWSER },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'] && !process.env['E2E_PORT'],
    timeout: 60_000,
  },
})
