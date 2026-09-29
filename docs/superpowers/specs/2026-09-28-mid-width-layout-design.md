# Mid-width layout (769–1020px) — design

*2026-09-28. Approved in chat by Peter: option C (choose by shape, not width alone),
criterion A for the stacked case; "go" for the remaining rulings, recorded below.*

## Problem

Between 769px and 1020px wide the layout stacks into one column and the board's size ignores
everything around it. Measured on `main` @ `f32d7d3`:

| viewport | board row | clocks top | Controls top | tabs top | page height |
|---|---|---|---|---|---|
| 900×800 | 155–815 | 827 | 1071 | 1390 | 1499 |
| 820×1180 | 191–851 | 863 | 1108 | 1426 | 1536 |

At 900×800 only the board is on screen: reading your clock or pressing Undo means scrolling
the board away. At 820×1180 (iPad portrait) Controls start 72px above the fold.

Width alone cannot tell these two apart, which is why one stacked layout serves both badly.

## Decision: two modes, chosen by orientation

Both modes apply only at `min-width: 769px` and `max-width: 1020px`. Phones (≤768px) and
desktop (≥1021px) are unchanged, byte for byte in behaviour.

- **Portrait (`orientation: portrait`, height ≥ width) → stacked.** Board on top, then the
  clocks, then Controls, then captured/score, then New game and the tabs.
- **Landscape → side panel.** The board, and one 280px column beside it holding the left
  column's content above the right column's.

### Why orientation is the right switch (ruling)

Each mode's board edge, with `W`×`H` the viewport:

- side panel: `min(640, H − 122, W − 398)` — 398 = page padding 48 + gap 20 + panel 280 +
  eval bar and rank gutter 50.
- stacked, criterion A: `min(640, W − 98, H − S)` — `S` ≈ 430, the header plus everything that
  has to fit below the board (clocks, Controls, gaps, padding). Measured in implementation.

Inside the band the stacked board is bigger exactly when `H ≥ W + (S − 398)`, i.e. at about
`H ≥ W + 32`. Orientation switches at `H = W`, so near a square window it picks stacked when
the side panel would give a board at most ~32px bigger. Anywhere else the two agree. A precise
aspect-ratio threshold would buy those 32px at the cost of a magic number that moves every time
`S` does; orientation does not move.

## Stacked mode (portrait)

- Criterion A: the board, both clocks and every Controls button are inside the viewport and
  hit-testable without scrolling — fresh, and with a long game imported. The move list and the
  tabs sit below and the page scrolls to them, as today.
- The board shrinks only if it must: `--board-size` gains an `H − S` term here, so on a short
  portrait window the board gives up the rows A needs instead of pushing them off-screen. At
  820×1180 the term does not bind and the board keeps its 640px cap.
- Order below the board: clocks (one row, both side by side), Controls, then captured and score
  side by side. `order` only — DOM order and Tab order are untouched, as on phones.
- Controls go wide: Undo/Redo/Flip/Resign on one 4-column row, the hint button beside its text
  rather than above it.
- Floor: the board never goes below 320px. Below that floor (a near-square window under ~750px
  tall) the page scrolls, which is accepted.

## Side-panel mode (landscape)

- Zero page scroll, the same invariant desktop holds: `scrollHeight === innerHeight`, no
  horizontal overflow.
- Grid: board track `calc(var(--board-size) + 50px)` and a 280px panel, 20px apart, centred.
  `.board-column` is a real grid item again (not `display: contents`) spanning both rows.
- `--board-size` is `min(640px, 100svh − --chrome, 100vw − 398px)`, floored at 320px.
- The panel is two rows: the left column (clocks in one row, captured and score side by side,
  Controls) above the right column (New game trigger and the tabs). `.layout` gets an explicit
  height equal to the board frame's, so the rows are definite: the left column takes its content
  height up to whatever leaves the right column 160px, and scrolls internally past that (it
  already has `overflow-y: auto` and its overflow fade); the right column takes the rest and its
  lists scroll inside it, exactly as on desktop.
- New game stays a popover (its `(max-width: 1020px)` query in `NewGameControl.tsx` is
  unchanged), because the panel has no room for the inline card.
- If the header wraps to two lines at some width in this band, `--chrome` is raised for that
  range from a measured value. The zero-scroll invariant decides, not an estimate.

## Out of scope

Phones, desktop, the puzzle screen (`puzzles.css` has its own query), and any change to DOM
order, components or the popover machinery. This is a CSS change plus tests; if it turns out to
need JS, that is a finding to report, not a licence.

## Testing

New e2e spec `tests/e2e/mid-width-layout.spec.ts`, fresh browser context per test, run with
`PW_PORT` set and the served tree proven:

- Portrait 769×1024, 820×1180, 1000×1100, fresh and with the 70-move game imported: board,
  clocks and all Controls testids are `toBeInViewport({ ratio: 1 })` and win `elementFromPoint`
  at their centres; no horizontal overflow; board square and ≥320px.
- Landscape 800×600, 900×800, 1020×700, fresh and long game: `scrollHeight === innerHeight`,
  no horizontal overflow; clocks and the tabs header hit-testable; the move list scrolls inside
  its panel while the page does not.
- Switching orientation at a fixed width (900×800 → 900×1000) changes mode with no reload.
- Each new test proven red first by byte-exact revert of the CSS.
- One existing test is superseded on purpose: `above-the-fold.spec.ts`'s sweep of
  769…1020 × 800 asserts `.left-column` sits *below* the board. Every one of those viewports is
  landscape, so the assertion flips to *beside*. Its 360px board floor still holds there
  (`W − 398 ≥ 371` at 769px).
- The whole existing suite still passes otherwise, especially `above-the-fold.spec.ts`, whose 1020/1021
  New game tests pin the breakpoint this design keeps.
