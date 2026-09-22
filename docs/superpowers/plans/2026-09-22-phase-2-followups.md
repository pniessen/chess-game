# Phase 2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is a requirements brief; the implementer reads the real code and designs within it.

**Goal:** Close the four items deferred from Phase 2: keyboard navigation for the tab group, a notice plus reset for unreadable game history, automatic engine recovery after the worker dies, and splitting the oversized `src/ui/App.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md` ("Error handling", "Persistence", "Testing" bind every task).

## Global Constraints

- No new dependencies. Stack as installed (TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63, chess.js 1.4 only inside `src/game-core/`).
- **MatchController owns all game state; exactly ONE live Stockfish worker at any time; only `EngineLane` talks to the engine; UI analysis only via `controller.analyze(req, signal)`.** Keep every `requestId` / `gameKey` invalidation path.
- Storage keys stay `chess-game:`-namespaced; reads defensive; a record with a newer `v` is never silently overwritten — only an explicit user reset may clear it.
- Existing visible text, `aria-*`, roles, `data-testid`s and class names that tests use stay stable unless a task says otherwise. Style new UI with the design tokens at the top of `src/ui/app.css` (light + dark).
- Every UI-visible change ships a Playwright spec; every e2e spec routes `/api` with `page.route` (`coachOffline`). Each test names the breaking change that turns it red.
- Baseline before Task 1: 606 unit tests pass (6 skipped), `npm run typecheck` clean, 44/44 e2e. All green after every task.
- Commits on branch `phase-2-followups`, message ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never commit `.claude/`, `.superpowers/`, `.env`.

---

### Task 1: Arrow-key navigation for the tab group (standard)

**Files:** `src/ui/panels/Tabs.tsx`, `src/ui/panels/Tabs.test.tsx`, a new or existing e2e spec.

Follow the WAI-ARIA Authoring Practices "Tabs with automatic activation" pattern on the existing `role="tablist"`:
- Roving tabindex: the selected tab has `tabIndex=0`, the others `-1`; Tab moves focus from the tablist into the active panel's content.
- ArrowRight / ArrowLeft move focus AND selection to the next / previous tab, wrapping at the ends; Home / End go to the first / last tab. Disabled tabs (if any) are skipped.
- `aria-orientation` is horizontal (default); Up/Down do nothing.
- The focused tab is visibly focused (existing brass focus ring).
- Tests: unit tests for each key incl. wrap, Home/End, tabindex values; one Playwright test that focuses the Moves tab, presses ArrowRight to reach Explorer and End to reach History, asserting `aria-selected` and the visible panel.

### Task 2: Notice and reset for unreadable game history (standard)

**Files:** `src/storage/storage.ts` (+ test), `src/ui/history/*` (+ tests), e2e spec.

Today `chess-game:history` in an unrecognised format (corrupt JSON, wrong shape, or a newer `v`) is left untouched, new games are silently not recorded, and only a `console.warn` says so.
- Add a pure storage read `historyStatus(): 'ok' | 'empty' | 'unreadable' | 'newer-version'` (names may follow the file's conventions) and `resetHistory()` that removes the key.
- The History tab shows a notice when the status is `unreadable` or `newer-version`: `Your saved game history can't be read, so finished games aren't being saved.` plus, for newer-version, `It may have been written by a newer version of this app.` and a `Reset history` button.
- Reset is a two-step confirm inside the notice (the button changes to `Confirm reset — this deletes saved games` with a `Cancel`), no `window.confirm`. After reset the notice disappears, the list is empty, and the next finished game is recorded.
- Other keys (settings, score, in-progress, puzzles) are untouched.
- Tests: storage unit tests per status; component tests for the two-step flow; Playwright spec that seeds `chess-game:history` = `{`, opens History, sees the notice, resets, finishes a quick two-player game (Fool's Mate is used by existing specs), and sees it listed.

### Task 3: Engine recovery after the worker dies (most capable)

**Files:** `src/engine/client.ts`, `src/ui/App.tsx` engine bundle (or the module that owns it), `src/match/controller.ts` only if strictly needed, tests.

Today when the Stockfish worker errors, fails its handshake, or trips the bestmove watchdog, the client goes dead (`deadListeners`) and AI modes end in an `engine-error` state for the rest of the session.
- On engine death, automatically terminate the dead worker and create a fresh worker + client, wired in so that the controller/EngineLane use it. Still exactly one live worker at any moment (terminate before or immediately as the new one is created; no leak on StrictMode double-mount or unmount during recovery).
- The game in progress is preserved. If the engine owed a move, it is re-requested once the new engine is ready (respect `requestId` invalidation so a stale reply can never apply). Pending analysis requests (hint, eval bar, review) fail/abort cleanly and may be retried by their owners as they already do.
- Bounded: at most 2 automatic restarts per 5 minutes; beyond that fall back to today's behaviour (AI modes disabled with the existing clear message; two-player still works).
- While restarting, the status area shows `Engine restarting…`; a successful restart logs one `console.warn` with the reason and clears the message.
- Tests: unit tests with a fake transport that dies (error event, handshake timeout, watchdog) proving restart, move re-request, stale-reply rejection, restart cap, and single-worker invariant. A Playwright spec that makes the worker die (e.g. `page.evaluate` to terminate the live worker via a test hook the app already exposes, or route `/engine/*` to fail once) mid one-player game and asserts the engine still replies afterwards. If no safe hook exists, add a minimal test-only hook guarded so it is inert in production builds, and justify it.

### Task 4: Split `src/ui/App.tsx` (most capable)

**Files:** `src/ui/App.tsx` (~980 lines) and new files under `src/ui/` (e.g. `app/useEngineBundle.ts`, `app/useGamePersistence.ts`, `app/useReviewFlow.ts`, `app/GameScreen.tsx`, `app/Header.tsx` — the implementer picks the seams after reading the file).

- Pure refactor: no behaviour, text, markup, class, `data-testid` or timing change. Move cohesive concerns (engine/controller lifecycle, persistence/resume, review → history/accuracy/blunder puzzles, coach/hints wiring, layout/render) into focused hooks/components with explicit typed inputs/outputs.
- `App.tsx` ends under ~300 lines and reads as composition. No new global state, no context unless it removes real prop-drilling.
- Existing tests keep passing unmodified except import paths; move/extend unit tests alongside extracted hooks where they gain a clear seam.
- Verify: full unit, typecheck, build, e2e all green; `git diff --stat` shows the logic moved, not rewritten.
