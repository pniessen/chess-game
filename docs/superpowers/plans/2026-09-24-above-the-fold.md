# Above the Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task is a requirements brief; the implementer reads the real code and designs within it.

**Goal:** Nothing the player needs is below the fold. At 1440×800 the whole app — board, clocks, captured, score, controls, hint, new game, tabs — fits in the viewport with **zero vertical page scroll**, and smaller viewports degrade predictably instead of stacking a 1364px column.

**Architecture:** Today every below-the-fold control is stacked *under* the board in one 1243px-tall `.board-column`, while `.left-column` ends at 268px and `.right-column` at 490px — roughly 750–975px of unused vertical space beside the board. The fix is redistribution, not deletion: `Controls` moves into the left column, `NewGame` into the right column above the tabs, `GameIO` behind a header popover built on the `SettingsPopover` pattern, and both side columns flex to the board's height so their own panels scroll internally instead of the page.

**Tech Stack:** As installed — TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md` ("Layout", "Accessibility", "Testing" bind every task).

## Global Constraints

- **No new dependencies.** No new runtime libraries, no CSS framework, no layout library.
- **Presentation only.** No changes under `src/match/`, `src/engine/`, `src/game-core/`, `src/coach/`, `server/`, `netlify/`. MatchController still owns all game state; exactly ONE live Stockfish worker; only `EngineLane` talks to the engine; UI analysis only via `controller.analyze(req, signal)`.
- **Every existing `data-testid`, `aria-*`, `role` and visible control label stays exactly as it is.** Controls may move in the DOM and change their CSS class, never their test id or their accessible name. 152 e2e specs and 973 unit tests depend on them; a task that needs to rename one states why and updates every caller in the same commit.
- **Disabled, not hidden.** `Controls.tsx` deliberately disables Pause/Step/Speed outside engine modes "so the layout doesn't jump" — that ruling stands. No task may hide a control based on mode.
- Style with the design tokens at the top of `src/ui/app.css` (light + dark). No new colour literals; new tokens only if an existing one cannot express the value.
- **Motion budget** (from the flourishes branch, still binding): ≤200ms for state changes, ≤250ms for a move, ≤600ms for a celebration; everything gated by `@media (prefers-reduced-motion: reduce)`.
- **Every task ships a Playwright spec**, and every e2e spec routes `/api` with `page.route` (`coachOffline`). Each test names the breaking change that turns it red.
- Baseline before Task 1 (on `main` at `b489eb0`): **973 unit tests pass, 6 skipped**; `npm run typecheck` clean; `npm run build` clean; **152/152 e2e**. All green after every task.
- Commits on branch `above-the-fold`, each message ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never commit `.claude/`, `.superpowers/`, `.env`, `node_modules/`, `public/engine/`.

## The measurement this plan is built on

Measured live at 1440×800, page scrolled to top, a 20-move game loaded:

| Thing | Value |
|---|---|
| `document.scrollHeight` | 1364px at **every** desktop width (1280, 1440, 1512, 1920) |
| Below the fold @1280×720 | 644px |
| Below the fold @1440×800 | 564px |
| Below the fold @1920×1080 | 284px |
| Controls fully below the fold @1440×800 | 12 (`hint`, `mode`, `level`, `color`, `time-control`, `new-game`, `open-puzzles`, `export-pgn`, `share-link`, `import-text`, `import-file`, `import-submit`) |
| Controls clipped by the fold | 2 (`pause`, `step`; the `speed` slider sits on the line) |
| `.board-column` height | 1243px (board-row 610 + controls 161 + new-game 136 + game-io 287 + gaps) |
| `.left-column` height | 268px |
| `.right-column` height | 490px (moves list already caps at 420 and scrolls internally) |

**The height budget at 1440×800** (the target): viewport 800 − status row (ends at 62) − layout top gap (20) − bottom padding (16) = **~702px of column height**. Every task below spends against that 702.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/ui/app.css` | `.layout` grid, the two side columns' flex-to-board-height rules, the new compact `.controls` layout, `.new-game` in a narrow column |
| `src/ui/App.tsx` | Composition only: moves `<Controls>` into `.left-column`, `<NewGame>` into `.right-column`, replaces `<GameIO>` in the column with `<GameFilePopover>` in the header `actions` |
| `src/ui/panels/Controls.tsx` | Same controls, same test ids, laid out for a 232px column |
| `src/ui/panels/NewGame.tsx` | Same controls, same test ids, laid out for a 280px column |
| `src/ui/panels/GameFilePopover.tsx` (new) | The popover shell (trigger, focus trap, Escape, outside click) that hosts the existing `<GameIO>` body |
| `src/ui/panels/GameIO.tsx` | Unchanged behaviour; only its container styling adapts to the popover |
| `src/ui/Board/board.css` | `--board-size` derivation |
| `tests/e2e/above-the-fold.spec.ts` (new) | The regression net: no page scroll, every control in the viewport |

---

### Task 1: The board fits the viewport height (standard)

**Files:** Modify `src/ui/Board/board.css`, `src/ui/app.css`; Test: `tests/e2e/above-the-fold.spec.ts` (create), `src/ui/Board/Board.test.tsx`.

Today the board is a hard 640px cap that never reacts to viewport height, which is why a 1920×1080 display still scrolls. Make the board's edge length derive from the smaller of its width track and the height actually left over:

- Introduce one custom property on `.layout` (name it `--board-size`), defined as `clamp(360px, min(640px, calc(100svh - var(--chrome, 180px))), 640px)`. `--chrome` accounts for the status row, the layout gap and the page's bottom padding; measure the real value rather than trusting 180px, and write the measured breakdown into a comment beside it.
- Use `svh`, not `vh`: on mobile Safari `vh` is the *largest* viewport height, so a `vh`-sized board is taller than the visible area exactly when the URL bar is showing.
- `.board-row`, the board itself, the eval bar and the coordinate gutters all derive from `--board-size`. The existing overlays (last-move arrow, flight layer, drag layer, legal dots) are already percentage-positioned inside the board box — verify that by measurement, and if any of them carries a px constant, convert it.
- The cap stays 640px so nothing changes at 1440×800 (where the board already renders at 610px and fits): this task is insurance for shorter viewports, not a visible change on the target size.
- **Do not touch** `FLIGHT_MS`, the animation durations, or the stacking order (arrow 0, pieces 1, flight 2, dots 3, overlay 4, ghost 5).

Tests:
- Unit: the board element's computed edge is square and equal on both axes at three injected `--board-size` values.
- e2e (new spec file, first test): at 1280×720, 1440×800 and 1920×1080 the board is square, ≥360px, and `.board-row`'s bottom is inside the viewport. Names the breaking change: "reverting `--board-size` to a fixed 640px turns this red at 1280×720."

### Task 2: Controls move into the left column (standard)

**Files:** Modify `src/ui/panels/Controls.tsx`, `src/ui/app.css`, `src/ui/App.tsx`; Test: `src/ui/panels/Controls.test.tsx`, `tests/e2e/above-the-fold.spec.ts`.

Move `<Controls>` out of `.board-column` and into `.left-column`, below `<Scoreboard>`. Re-lay it out for a 232px-wide column, keeping every `data-testid` (`undo`, `redo`, `flip`, `resign`, `pause`, `step`, `speed`, `hint`, `hint-text`) and every visible label:

- `undo` / `redo` / `flip` / `resign` as a 2×2 grid (`grid-template-columns: repeat(2, minmax(0, 1fr))`), not a 4-wide row that would truncate "Flip board".
- `pause` / `step` side by side; the `speed` label + range full width beneath them. All three keep today's disabled-not-hidden behaviour.
- `hint` full width, with `hint-text` (`aria-live="polite"`) wrapping beneath it. **Ruling:** hint stays with the controls rather than getting its own strip under the board — the board column's budget at 1440×800 is 610 + gap + strip ≈ 692 of 702, too tight to survive a one-line-to-two-line hint. The cost if wrong: hint text wraps to ~3 lines in a 232px column, which is uglier than a wide strip but never pushes anything off-screen.
- Reserve the hint text's height (`min-height` for ~2 lines) so an arriving hint does not shift the column.

Budget check to verify by measurement, not assumption: left column ends at ≤560px of the 702 available (clocks 112 + captured 90 + score 50 + controls ~280 + gaps).

Tests:
- Unit: every control still renders with its test id, label and disabled state under each mode (`two-player`, `one-player`, `zero-player`, `paused`, `finished`).
- e2e: at 1440×800, `undo`, `redo`, `flip`, `resign`, `pause`, `step`, `speed`, `hint` are all inside the viewport rect, and the hint text does not move the board when it changes from empty to a two-line hint.

### Task 3: New game moves into the right column (standard)

**Files:** Modify `src/ui/panels/NewGame.tsx`, `src/ui/app.css`, `src/ui/App.tsx`; Test: `src/ui/panels/NewGame.test.tsx`, `tests/e2e/above-the-fold.spec.ts`.

Move `<NewGame>` out of `.board-column` into `.right-column`, **above** `<RightTabs>`. It is the entry point to every session, so it stays on the page rather than going behind a popover; level and time control stay here too (the ruling recorded in `SettingsPopover`'s doc comment: they are choices for the NEXT game, made next to the button that starts it).

- Lay the four selects out for a 280px column. Prefer a single-column stack of labelled selects over a 2×2 grid: "Engine vs engine" and the time-control names truncate at ~130px. Measure both and keep whichever reads correctly at 280px without an ellipsis.
- `new-game` and `open-puzzles` as a button row beneath.
- Keep `engineAvailable` degradation exactly as it is.

Tests:
- Unit: each select still renders its full option text; the engine-unavailable path is unchanged.
- e2e: at 1440×800, `mode`, `level`, `color`, `time-control`, `new-game`, `open-puzzles` are inside the viewport, and no select's rendered text is clipped (`scrollWidth <= clientWidth` on the select's own box).

### Task 4: Game file becomes a header popover (most capable)

**Files:** Create `src/ui/panels/GameFilePopover.tsx`, `src/ui/panels/GameFilePopover.test.tsx`; Modify `src/ui/panels/GameIO.tsx` (container styling only), `src/ui/App.tsx`, `src/ui/app.css`; Test: `tests/e2e/game-file-popover.spec.ts` (create).

Export PGN, Share link and Import are the lowest-frequency controls on the page and cost 287px, most of it an 88px textarea. Put them behind a `Game file` trigger in the header `actions`, beside `Shortcuts` and `Settings`.

- **Reuse `SettingsPopover`'s pattern, do not re-derive it:** labelled trigger with `aria-haspopup="dialog"` / `aria-expanded`, focus moves into the popover on open, Tab cycles inside it, Escape closes and returns focus to the trigger, outside click closes. **No `aria-modal`** — the game behind stays live, exactly as Task 12 ruled for settings.
- Extract the shared shell if and only if the extraction is smaller than the duplication: if `SettingsPopover`'s trap can be lifted into a `usePopover` hook without changing its behaviour or its tests, do that and have both use it; otherwise duplicate deliberately and say so in a comment.
- `<GameIO>` keeps its component, its state machine (share `idle`/`copied`/`manual`), its effects and all five test ids. Only its wrapper class changes.
- z-index: the popover sits at 30, the same tier as settings (order: shortcuts 40 > settings/game-file 30 > promotion 10 > board pool 0–6). Two popovers must never be open at once — opening one closes the other.
- The `Escape`-while-focus-drifted hole fixed in `GameEndCard` applies here too: the listener must be at `document` level, added only while open.

Tests:
- Unit: trigger opens/closes; focus enters and returns; Tab cycles; Escape closes from a focus point outside the popover; opening Settings closes Game file and vice versa; every `GameIO` test id is reachable inside it.
- e2e: open the popover, export a PGN (assert the download), copy a share link (assert clipboard or the manual fallback), import a PGN and assert the position changed — i.e. the existing `game-io` e2e coverage still passes through the popover. Names the breaking change: "rendering GameIO back in the column, or dropping the focus trap, turns this red."

### Task 5: Both side columns flex to the board's height (most capable)

**Files:** Modify `src/ui/app.css`, possibly `src/ui/panels/Tabs.tsx`; Test: `tests/e2e/above-the-fold.spec.ts`.

With Tasks 2–4 landed, the right column holds New game (~250px) plus the tabs (up to 490px) — 740px against a 702px budget. The page must still not scroll, so the panels must flex:

- `.left-column` and `.right-column` get `height: var(--board-size)` (plus the coordinate gutter, measured) and `min-height: 0`.
- The tab panel becomes `flex: 1; min-height: 0; overflow-y: auto`, replacing the fixed `max-height: 420px` on the moves list, the 420px on `.history-list` and the 280px on `.explorer-results`. Those caps become `max-height: 100%` so each list scrolls inside whatever height the panel actually has.
- The already-solved behaviours must survive: the move list's scroll-into-view of the current ply, the history list's bottom anchor, and the move preview's positioning (which reads the row's rect — check it against the new scroll container, and fix the scroll/arrow-key staleness noted as a follow-up in the flourishes final review if it is cheap here).
- **Ruling:** a shorter tab panel is preferable to a scrolling page. The cost if wrong: on a very short viewport the moves list shows ~6 moves before scrolling, which is why Task 1's 360px board floor exists as the backstop.

Tests:
- Unit: the panel's scroll container is the panel, not the document (assert `overflow-y` and that the list's own max-height is no longer a px constant).
- e2e: load a 60-move game at 1440×800 and 1280×720 — the moves list scrolls internally, `document.scrollHeight === innerHeight`, and jumping to move 1 with the keyboard scrolls the *panel* and leaves `window.scrollY === 0`.

### Task 6: The mobile pass (standard)

**Files:** Modify `src/ui/app.css` (the `@media` blocks at ~1420–1470), `src/ui/App.tsx` if ordering needs it; Test: `tests/e2e/above-the-fold.spec.ts`.

A 375×812 phone cannot hold a board plus 15 controls, and pretending otherwise produces a board too small to play on. State the honest target and build to it:

- Above the fold at 375×812: the status row, the board, and the primary actions (`undo`, `hint`). Everything else scrolls.
- Single-column order: status → board → controls → clocks/captured/score → tabs. New game and Game file are both popovers on mobile (Game file already is after Task 4; New game gets the same treatment **only below the 900px breakpoint**, staying inline on desktop).
- The popovers get `max-height: min(80vh, 560px)` with internal scroll, as settings already does.
- Verify no horizontal scroll at 320px, 375px and 414px.

Tests:
- e2e at the `mobile` project/viewport: board is ≥300px and fully visible, `undo` and `hint` are inside the viewport without scrolling, no horizontal overflow at 320px.

### Task 7: The fold regression net (cheap)

**Files:** `tests/e2e/above-the-fold.spec.ts` (finish the file the earlier tasks have been adding to).

One spec that makes the fold impossible to lose again:

- For each of 1280×720, 1440×800, 1512×860, 1920×1080: `document.documentElement.scrollHeight <= window.innerHeight + 1` (the +1 absorbs sub-pixel rounding), asserted both on a fresh load and with a 60-move game imported.
- For the full list of ids — `undo, redo, flip, resign, pause, step, speed, hint, mode, level, color, time-control, new-game, open-puzzles, tab-moves, tab-explorer, tab-review, tab-history, shortcuts-toggle, settings-toggle, game-file-toggle` — assert each element's bounding box is fully inside the viewport at 1440×800.
- Assert the three moved-behind-the-popover ids (`export-pgn`, `share-link`, `import-text`, `import-file`, `import-submit`) are reachable in exactly one click from the header.
- Name the breaking change in a comment: "adding any card back into `.board-column`, or restoring a fixed `max-height` on the tab panel, turns this red."

---

## Self-review

- **Coverage:** every one of the 14 below-the-fold/clipped controls has a destination — Controls' 8 in Task 2, New game's 6 in Task 3, Game file's 5 in Task 4.
- **Budget:** 702px available at 1440×800; left column ~560 (T2), right column ~740 before T5 and ≤702 after it — which is precisely why T5 is not optional.
- **Risk:** T5 is the one task that can regress existing behaviour (move-list auto-scroll, history bottom anchor, move preview positioning). It is marked most-capable and carries its own tests for each of those three.
- **Not in scope:** the puzzle screen's own layout (it replaces the game screen and has its own fold story), and the `MovePreview` scroll-staleness follow-up except where T5 touches it anyway.
