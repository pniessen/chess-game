# UI Flourishes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task below is a requirements brief; the implementer reads the real code and designs within it.

**Goal:** Make the game feel like a polished consumer product: animate what moves, react to the moments that matter, and round off the panels — without touching game logic.

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md` ("Interface layout", "Persistence", "Error handling", "Testing" bind every task). The visual language is the merged design pass: tokens at the top of `src/ui/app.css`, card panels, brass accent, light + dark.

## Global Constraints

- **No new dependencies.** Stack as installed (TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63, chess.js 1.4 only inside `src/game-core/`).
- **No game-logic, controller, engine, server, storage-format or data-flow changes.** These tasks are presentation only. `MatchController` still owns all game state; exactly ONE Stockfish worker; only `EngineLane` talks to the engine; UI analysis only through `controller.analyze(req, signal)`; every `requestId` / `gameKey` invalidation path intact.
- **Motion budget:** transitions ≤ 200 ms for state changes, ≤ 250 ms for a piece move, ≤ 600 ms for a celebration. Everything animated is disabled under `@media (prefers-reduced-motion: reduce)` — including the existing low-time clock pulse. No animation may delay when a move is legal, applied, or sent to the engine: animate the *rendering*, never the state.
- **Accessibility:** overlays trap focus, close on Escape, and restore focus to the trigger; every new control is reachable and labelled; status changes that matter announce via `aria-live="polite"` (results) without spamming on every move; contrast stays WCAG AA in both themes.
- **Style with the existing tokens** (`--brass`, `--surface`, `--ink`, `--muted`, `--line`, `--danger`, fonts, radii). New tokens are allowed but must be defined for light AND dark.
- **Test-id and text stability:** existing `data-testid`s, visible text, roles and aria attributes stay unless the task says otherwise; if a task changes one, it updates every test that uses it in the same commit.
- **Every task ships a Playwright spec**, and each test names the change that turns it red. Every e2e spec routes `/api` with `page.route` (`coachOffline`). Specs must not depend on animation timing: assert end state, or assert a class/attribute, never a mid-flight frame.
- **Performance:** no layout thrash on a move (transform/opacity only); the board must stay responsive during engine thinking; no `setInterval` left running after unmount.
- **Baseline before Task 1:** 684 unit tests pass (6 skipped) — plus whatever the `coach-flag` branch adds — `npm run typecheck` clean, `npm run build` clean, 49/49 e2e. All green after every task. Known CPU-contention flakes: an `App.test` wall-clock assertion and a perft depth-3 timeout; re-run in isolation and report if they fire.
- **GitHub Pages must keep working:** no root-absolute asset URLs (use `src/assetUrl.ts`); nothing may assume a server.
- **Commits** on branch `ui-flourishes`, one or more per task, message ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never commit `.claude/`, `.superpowers/`, `.env`, `public/engine/`.
- **Screenshots:** every visual task saves before/after PNGs (desktop 1440x900 and mobile 375x812, light and dark) under `/tmp/flourishes/<task>/` and the implementer looks at them before reporting.

---

## Batch A — Movement and feel

### Task 1: Animate piece movement (most capable)
Pieces slide from origin to destination instead of snapping; captures fade out under the arriving piece; castling animates king and rook together; promotion swaps the piece at the end of the slide. Engine moves and human moves animate the same way. Browsing history (clicking a move, undo/redo, jumping to a position) does NOT animate — it cuts. The animation must never gate legality or the engine request. ~180–250 ms, transform-based, cancelled cleanly if another move or a position jump lands mid-flight.

### Task 2: Drag polish (standard)
The dragged piece lifts (slight scale + shadow), the square under the cursor gets a clear target ring, an illegal drop animates back to its origin instead of disappearing, and the source square keeps a faint placeholder while dragging. Touch drag stays usable at phone width; existing pointer-capture behaviour and click-to-move must not regress (Phase 1 shipped a real bug here — cover both input paths in tests).

### Task 3: Last-move arrow (standard)
Draw an arrow from origin to destination of the last move over the board (SVG overlay, brass, semi-transparent, under the pieces), in addition to the existing square tint. It follows history browsing, flips with the board, and never blocks pointer events. Hint arrows already exist — reuse that overlay's mechanics and make sure the two are visually distinct and can show together.

### Task 4: Check glow and checkmate shake (standard)
The king in check gets a pulsing red radial glow (not just a flat tint). On checkmate the board does one short shake and the mating king's glow holds. Stalemate and draws get no shake. Both effects are off under reduced motion, where the existing static indicator remains.

### Task 5: Engine warming-up state (standard)
While Stockfish is loading (and while it is restarting, which Task 3 of the follow-ups already surfaces), show a small knight spinner and a label in the status area, and give the Hint button a loading state instead of looking dead. Clears as soon as the engine is ready; the existing "engine unavailable" path is untouched.

## Batch B — Moments

### Task 6: Game-end card (most capable)
When a game ends, a card animates in over the board: the result headline ("Checkmate — White wins", "Draw by stalemate", "Black wins on time", …), the opening name, and actions — Rematch (same setup, colours kept), Review game, Export PGN, Dismiss. It never blocks reading the final position (dismissable, and the board stays visible), it does not fire for a game loaded from history or PGN, and it must not interfere with the existing review flow, history recording, or the resume offer. Keyboard accessible, focus-trapped, Escape dismisses.

### Task 7: Puzzle-solved celebration (standard)
On solving a rated puzzle: a green ring sweeps the board once and the rating change animates as a rising, fading "+12" near the rating. A wrong move gets the existing red square plus a short shake of the moved piece. My-mistakes puzzles celebrate without any rating text. Nothing may change the once-only outcome rule or the rating maths.

### Task 8: Move-quality chips in the move list (standard)
After a review, each move in the move list carries its quality as a small coloured chip (?? blunder, ? mistake, ?! inaccuracy, ! good, !! best — match whatever the review already classifies). Chips appear only for a reviewed game, survive clicking through moves, and are readable in both themes. Hovering a chip shows the eval swing as a title/tooltip.

## Batch C — Panels and extras

### Task 9: Move-list position preview (standard)
Hovering (or focusing) a move in the move list shows a small board popover of that position, without changing the board. Keyboard-reachable, dismissed on blur/Escape, positioned so it never leaves the viewport, and cheap enough that scrubbing the list stays smooth.

### Task 10: Eval bar smoothing and game eval line (standard)
The eval bar slides between values instead of jumping, and a compact evaluation line for the whole game renders under the board (or in the Review tab — the implementer picks the better home and justifies it), built from data the review already produces. No new engine calls.

### Task 11: Captured pieces and material lead (standard)
Captured pieces animate into their tray, and the side that is ahead shows a "+3" style lead. Keep the existing material calculation.

### Task 12: Settings popover (most capable)
Replace the current settings controls with a popover: board theme and piece set as visual previews (not dropdowns), light/dark/system, sound on/off plus a volume slider, and the existing time-control and level controls kept working. Volume persists in `chess-game:settings` alongside the existing keys, defaulting so current users hear no change. All existing settings behaviour and tests keep working.

### Task 13: Keyboard shortcuts (standard)
Left/Right to step through moves, Home/End to jump to start/end, f to flip, u to undo, r to redo, h for hint, p to open puzzles, Escape to close overlays, and `?` to open a shortcuts overlay listing them. Shortcuts never fire while typing in an input/textarea or while a modal owns focus, and must not conflict with the tab group's arrow keys (Task 1 of the follow-ups).

### Task 14: Shareable position link (standard)
A Share button copies a URL containing the current position (FEN, and the move list where it is cheap enough), and opening such a URL loads that position. It must not break the in-progress resume flow (a shared link takes precedence for that load only, without silently destroying a saved game — offer the same resume choice pattern already in place), and the URL must work under the GitHub Pages base path.
