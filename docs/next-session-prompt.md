# Chess game — handoff prompt for the next session

*Written 2026-09-28 against `main` @ `63f68fd`. Paste it as the first message of a new
session. When it goes stale, rewrite this file in place — git keeps the older versions.*

You're picking up `/Users/pniessen/CLAUDE-CODE/projects/chess-game`: a browser chess game
(Vite 8 / React 19 / TS 7 / Vitest 5 / Playwright 1.63; chess.js confined to `src/game-core/`;
Stockfish lite-single WASM in one worker; Express 5 coach server plus Netlify Functions using
`@anthropic-ai/sdk` with model `claude-sonnet-5`).

## Where things stand (2026-09-28)

`main` is at `63f68fd`, clean, in sync with `origin/main`; the remote has only `main`.
Nothing is outstanding — the above-the-fold work shipped and four peer-session branches landed.

One worktree exists besides the root: `.claude/worktrees/wizardly-knuth-ea4678` on
`claude/optimistic-ellis-31c140` (`7da2e1b`, already merged). **It belongs to another live
session — don't edit it, remove it, or delete its branch.** If you need work from a sibling
worktree, branch from its HEAD; never write into it.

Both deployments were current at `63f68fd`. Verify rather than assume when it matters.

## Standing constraints (do not relax these)

- Never display, echo, or read an API key value. Verify a key only by length and prefix.
- `.env` stays gitignored and is never committed. Never commit `.claude/` or `.superpowers/`.
  Stage explicit paths — never `git add -A`.
- The Anthropic key for Netlify is Peter's to set, or the Netlify AI Gateway supplies it.
  Never handle the value.
- Approve-once autonomy: once Peter approves a plan, execute the whole thing without
  between-task check-ins. Make rulings on conflicts and record them; don't park on questions.
  Stop only for destructive, security-sensitive, or outside-the-worktree actions.
- His standing instruction on branch work is "merge back to main when done" — run the
  branch-finish checks, but don't make him pick the option again.

## Deploying

- **GitHub Pages** auto-deploys from `.github/workflows/pages.yml` on every push to `main`
  (`VITE_COACH=off`, built-in coaching, no secrets).
- **Netlify** (`chess-with-claude`) is **not linked to GitHub**. It drifts silently behind
  Pages. Deploy by hand, once, when work is finished:

  ```sh
  npx -y netlify-cli@latest deploy --build --prod --site c1f80951-bc73-4677-9e3b-ca68d9178f81
  ```

  Auth is already stored. The Netlify **MCP** deploy path does not work here — it zips the
  382MB source dir and dies with `TypeError: fetch failed`. Go straight to the CLI.
  Peter declined auto-deploy deliberately: every merge would spend AI Gateway credits against
  a ~$5/month ceiling.
- To check whether the live site is current: `curl -s https://chess-with-claude.netlify.app/ |
  grep -o '/assets/index-[A-Za-z0-9_-]*\.js'`, curl that asset, grep it for a recently added
  testid. `/api/health` returning `{"ok":true,"claude":true}` confirms the Claude functions.
- Some bugs only exist in production: the local Express relay answers instantly and the e2e
  suite stubs `/api`, which is how a cold-start health-probe bug shipped invisibly. If coach
  behaviour changes, look at the live site.

## Claude vs Claude (local-only)

Branch `feat/claude-vs-claude` adds a mode where two Claude models play each other; spec
`docs/superpowers/specs/2026-09-29-claude-vs-claude-design.md` (its 2026-09-29 addendum
supersedes the owner-only sections), plan `docs/superpowers/plans/2026-09-29-claude-vs-claude.md`.

- **Local only.** The mode exists in `npm run dev` and `npm run start:claude` (a local build
  with `VITE_CLAUDE_GAMES=on`), never on Netlify or GitHub Pages. The gate reads Vite's
  `MODE === 'development'` (not `DEV`, which `NODE_ENV=development` turns on in a build). A vite
  build guard (`scripts/publicBuildGuard.ts`) refuses `VITE_CLAUDE_GAMES=on`, a non-production
  `--mode`, or any `NODE_ENV` other than `production` in a Netlify or CI build, so never put the
  flag (or `NODE_ENV`) in `.env`.
- **Always deploy with `netlify deploy --build`**, never a bare `--prod` of an existing `dist/`:
  `npm run start:claude` leaves a flagged `dist/` (with the Claude UI) behind, and only `--build`
  rebuilds it through the guard.
- **Run it:** `ANTHROPIC_API_KEY` in `.env` (Peter's to set; never read or echo it). Either
  `npm run server` in one terminal and `npm run dev` in another, or `npm run start:claude`.
  `/api/game/*` is served only by the local Express app on loopback; without a key it answers 503
  and the mode shows why.
- **Money and games:** a $20 per UTC month cap, and saved games (`games/saved/<id>`), live in
  `~/.chess-game/claude-games` (override with `CLAUDE_GAMES_DIR`), shared across worktrees.
  Restarting the local server ends an in-progress game as lost; the games lock carries the
  server's boot id, so the next Start after a restart settles that game as abandoned at once
  (no 30-minute wait, no need to touch `lock.json`).
- **A corrupt ledger file fails closed:** `GET /api/game/budget` answers 500 and the mode shows
  the start-the-server hint. The server log names the JSON file that failed to parse; repair or
  remove that file rather than deleting `lock.json` (which would strand the game's reservation).
- **Usage tracking:** every Anthropic call for a seat (retries and timeouts included; not the
  pacing delay or Stockfish fallbacks) adds cost, server wall time (`ms`), input/output tokens
  (a timeout counts its estimated tokens) and a call count to the game's `usage.{w,b}` (also in
  `games/saved/<id>`) and to `byModel` in the month's `games/budget/<month>`; month records from
  before it show their dollars as "Earlier". The UI shows it in the cost line, on each Claude
  clock (model time) and in the New game panel's "This month" line (`claude-month`).
- **Constants** (model ids, list prices, per-game reserves, move timeout, the 160-ply
  adjudication cap, the 25-minute session idle limit) live in `src/claude/models.ts`.
- **Task 10 (live measurement) is still pending:** it now runs locally with Peter's own key,
  playing real games to measure `usage` and retune `RESERVE_PER_GAME_USD`.

## Environment traps that have already cost this repo real time

- A fresh worktree has `node_modules` but an empty `public/engine/` (postinstall never ran).
  `predev`/`prebuild` now run `scripts/copy-engine.mjs`, so `npm run dev` and `npm run build`
  self-heal — but a bare `npx vitest run`, or tests against an already-running server, do not.
  `scripts/copy-engine.test.ts` fails loudly by name in that case. Without the engine ~48 tests
  fail environmentally *and* an extra `.engine-warning` banner shifts every layout measurement,
  so a green suite is impossible and a red one is meaningless.
- Playwright's default `:5173` with `reuseExistingServer: true` will bind your run to another
  worktree's server. Use `PW_PORT=5199 npx playwright test` (setting `PW_PORT` also disables
  reuse), and *prove* the run hit your tree: `lsof` the port's cwd and curl the served file for
  a discriminating byte. A green suite can be someone else's.
- `src/game-core/perft.test.ts` depth-3 takes ~112–119s against a 180s cap. If it fails, check
  `uptime` load averages before blaming the diff — it's a pure benchmark touching no DOM.
- E2E page-scroll measurements need a **fresh** browser context; a reused one carries a resume
  banner that fakes overflow.

## Architecture invariants (binding)

- `MatchController` owns all game state. Exactly ONE Stockfish worker. Only `EngineLane` talks
  to the engine. UI analysis only through `controller.analyze(req, signal)`.
- Board stacking order: arrow 0, pieces 1, flight 2, dots 3, overlay 4, ghost 5; then card 6,
  preview 9, promotion 10, settings/game-file 30, shortcuts 40.
- `src/ui/app.css` `.layout`: `--chrome: 122px`;
  `--board-size: clamp(360px, min(640px, calc(100svh - var(--chrome, 180px))), 640px)`;
  columns `232px minmax(0, var(--board-size)) 280px`. Both side columns are capped at
  `var(--board-size)` with `min-height: 0`, `overflow-y: auto`, `scrollbar-gutter: stable`.
  `.right-column`'s cap is the backstop that actually carries the no-overflow invariant.
- Three columns stop at 1020px: a `clamp()` floor is illusory inside a `minmax(0, …)` track,
  because the minimum is 0 and width binds first. **769–1020px picks by orientation**
  (spec `docs/superpowers/specs/2026-09-28-mid-width-layout-design.md`): landscape is the board
  plus one 280px side panel with zero page scroll; portrait stacks with the board, clocks and
  every Controls button above the fold. In that band `.app` is exactly `100svh` and `.layout` is
  a size container, so `--board-size` reads `cqh`/`cqw` — **not** `--chrome`, because the header
  wraps there. Portrait's `--below-board: 185px` is measured; re-measure it if Controls or the
  clocks change height. `≤768px` (phones) is unchanged.
- Zero-scroll target viewport is **1440×800**: `scrollHeight === innerHeight`, no horizontal
  overflow, all 21 controls reachable. Verified across three viewports × {fresh, 140-ply} × all
  four tabs.
- The New game popover is portaled to `document.body` with `position: fixed`, because
  `.right-column` is a scroller and an absolutely positioned child cannot escape one. Anything
  similar must portal too — and must be listed **by class** in the `prefers-reduced-motion`
  gate, since `.app *` does not match a portal.
- `usePopover.ts` is the shared focus trap: roving Tab (not ends-only, which Safari's default
  tab mode defeats), radio groups counted as one stop, `getClientRects()` filtering gated on the
  root measuring (jsdom reports zero rects), and a `focusout` guard gated on
  `relatedTarget === null`.

## How work is expected to be done here

- Prove every new test red before green, by byte-exact revert — and re-run against a *fresh*
  server, because a stale warm one has produced a convenient false pass.
- `toBeVisible()` ignores ancestor clipping and Playwright's click auto-scrolls. Assert
  usability the way a user meets it: `elementFromPoint`, `toBeInViewport()`.
- Report the number you measured, not the number you expected. If a comment's claim turns out
  false, correct the claim — a comment a maintainer can disprove in ten minutes is worse than no
  comment.
- Invoke the superpowers skills as they apply: `brainstorming` before anything new,
  `subagent-driven-development` to execute a plan (ledger at
  `.superpowers/sdd/<plan>/progress.md`), `finishing-a-development-branch` to land it.
  Plans live in `docs/superpowers/plans/`, specs in `docs/superpowers/specs/`.

## Opening move

If Peter opens with a task, do the task. If he asks what's next, the honest answer is that the
backlog is empty — don't invent work. Candidates worth *offering*, none of them committed to:
a pass over coach-server behaviour under real Netlify conditions; or whatever he has in mind.
(The 769–1020px layout was designed and shipped 2026-09-28.)
