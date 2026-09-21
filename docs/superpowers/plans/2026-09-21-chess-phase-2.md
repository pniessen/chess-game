# Chess Game Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 1 game into "the coach and the explorer": visible board coordinates, graded graphical hints, an evaluation bar, a Claude-backed hint/review server with a silent templated fallback, opening naming, an opening explorer, engine book moves, post-game review with accuracy, persistent game history, sounds, and board themes.

**Architecture:** The browser stays self-sufficient. All engine work — the controller's own moves, hints, the eval bar and the post-game review — goes through one `EngineLane` owned by `MatchController`, so the single Stockfish worker is never raced: engine moves pre-empt analysis, analysis queues behind moves. A small Express server (`server/`, run with `tsx`) holds the Anthropic key and relays two request types; the browser's `CoachClient` falls back to templated text whenever it is unreachable. The lichess ECO dataset is vendored as TSV, pre-processed at build time through `game-core` into a static JSON asset that `openings/` loads lazily.

**Tech Stack:** TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63, chess.js 1.4 (game-core only), stockfish 19 lite-single (one Worker), Express 5, `@anthropic-ai/sdk`, `tsx`, WebAudio.

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md` (Phase 2 section is the scope; "Interface layout", "Persistence", "Error handling" and "Testing" sections bind every task).

## Global Constraints

- **Node >= 22.9** (Task 5 bumps `engines` from `>=20`: the `server` script uses `node --env-file-if-exists`, added in 22.9). Verified machine: Node 26.7.0.
- **Stack versions stay as installed:** TypeScript 7 (native compiler), Vite 8, React 19, Vitest 5 (jsdom by default; files that need Node APIs start with `// @vitest-environment node`), Playwright 1.63, chess.js 1.4.0, `stockfish` 19 lite-single loaded as a classic `new Worker(url)` from `public/engine/`.
- **`src/game-core/` is the ONLY directory that imports chess.js** — including `server/` and `scripts/`. Opening data work (EPD, SAN replay) goes through game-core helpers added in Task 7.
- **chess.js facts:** `.move()` THROWS on illegal input; `isCapture()` is false for en passant; there is no `isCastle()`; use `setHeader`, never `header()`.
- **MatchController owns all game state.** React reads it through `useMatch` (`useSyncExternalStore`) with a snapshot cached in `emit()`. A monotonic `requestId` invalidates stale engine replies; keep every existing invalidation path.
- **Exactly ONE Stockfish worker**, created in App's effect-owned bundle (StrictMode-safe). From Task 3 on, **nothing but `EngineLane` calls `configure`/`setPosition`/`search` on the engine.** UI code asks for analysis only through `controller.analyze(req, signal)`. Engine moves pre-empt analysis; analysis waits behind moves.
- **Strength:** Stockfish `UCI_Elo` floor is 1320; levels 1–3 use Skill Level + blunder injection with the controller's injectable RNG. Book moves (Task 10) use the same injected RNG.
- **Claude:** SDK `@anthropic-ai/sdk`, model id exactly `"claude-sonnet-5"`, `timeout: 15_000` ms, `maxRetries: 0`. `ANTHROPIC_API_KEY` is read from `.env` (already gitignored) by the server only; it never reaches the browser, a response body, or a log line. Server tests never call the live API.
- **Server:** `server/` directory, TypeScript run with `tsx` (see Task 5 for the ruling), Express on `127.0.0.1:8787`; `npm run dev` proxies `/api` to it via `vite.config.ts` `server.proxy`. Endpoints: `GET /api/health`, `POST /api/hint`, `POST /api/review`, JSON bodies capped at 32 KB, validated before any Claude call.
- **Coach error handling (spec table):** server unreachable → silent templated fallback plus a badge reading exactly `coaching offline`; Claude API error or rate limit → same fallback, surfaced ONCE per session (a dismissible notice), never per request.
- **Openings data:** lichess-org/chess-openings `a.tsv`–`e.tsv` (CC0), vendored in `data/openings/`, credited in `NOTICE.md`.
- **Piece art:** Rhosgfx (CC0) only. **Ruling: no second piece set in Phase 2** — no candidate set's licence could be verified from this workspace (no network during planning), so only board colour themes ship. A piece set may be added later once its exact source and licence are confirmed against lichess-org/lila `COPYING.md`.
- **Storage:** every key is namespaced `chess-game:` like the existing ones. The spec's `history` key is `chess-game:history`, stored as `{ v: 1, games: HistoryEntry[] }`, newest first, capped at 200. All reads validate defensively; all writes swallow quota errors (existing `readJson`/`writeJson`).
- **Coordinates:** lowercase files `a`–`h` beneath the board, ranks `1`–`8` to its left, outside the board, flipping with orientation.
- **Sounds:** synthesised with WebAudio, no audio assets; `AudioContext` created lazily on the first user gesture; mute persisted as `settings.soundEnabled`.
- **Testing discipline (Phase 1 lessons):** unit tests missed real-browser bugs (pointer capture broke clicks; clocks froze). **Every UI task ships a Playwright spec.** Every test step names the breaking change that turns it red. Any e2e spec that can reach `/api` routes it with `page.route` so results never depend on whether a local server or key exists.
- **Baseline:** 236 unit tests and the six existing e2e specs (`two-player`, `one-player`, `zero-player`, `promotion-drag`, `clock-ticks`, `zero-player-browse`) pass before Task 1 and after every task.
- **Commits:** one per task (more is fine), message ending with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

```
chess-game/
├── .env.example                      # NEW (T5) ANTHROPIC_API_KEY=, PORT=
├── tsconfig.node.json                # NEW (T5) typecheck for server/ + scripts/ (Node types)
├── data/openings/{a..e}.tsv          # NEW (T7) vendored lichess CC0 dataset
├── public/openings/openings.json     # NEW (T7) generated, committed, fetched lazily
├── scripts/
│   ├── openings-lib.ts               # NEW (T7) read TSVs -> JSON string
│   ├── build-openings.ts             # NEW (T7) `npm run openings`
│   └── build-openings.test.ts        # NEW (T7) committed JSON is up to date; real transpositions
├── server/                           # NEW (T5) Express coach relay
│   ├── index.ts                      # entry: env, listen 127.0.0.1:8787, serve dist/
│   ├── app.ts                        # createApp({ claude, staticDir })
│   ├── claude.ts                     # createClaude(): SDK wrapper, error classification
│   ├── prompts.ts                    # hintPrompt(), reviewPrompt() — pure
│   ├── validate.ts                   # parseHintRequest(), parseReviewRequest() — pure
│   └── *.test.ts
├── src/
│   ├── game-core/
│   │   ├── position.ts               # + epd(), trySan()                    (T7)
│   │   ├── game.ts                   # + epds(upToPly)                      (T7)
│   │   ├── notation.ts               # NEW uciOf(), sanTokens()             (T7)
│   │   └── io.ts                     # + gameFromSan()                      (T7)
│   ├── engine/
│   │   ├── lane.ts                   # NEW EngineLane: move vs analysis scheduling (T3)
│   │   ├── evaluation.ts             # NEW WhiteEval, win%, formatting      (T4)
│   │   ├── uci.ts                    # + principalLine()                    (T2)
│   │   └── strength.ts               # + bookChance                          (T10)
│   ├── match/
│   │   ├── controller.ts             # lane, analyze(), setBook(), chooseBookMove(), finishAs()
│   │   └── result.ts                 # NEW resultTagOf(), humanSideOf()     (T12)
│   ├── coach/
│   │   ├── hints.ts                  # NEW suggestion, nudge text, hint request (T2, T6)
│   │   ├── protocol.ts               # NEW request/response types + limits, shared with server (T5)
│   │   └── client.ts                 # NEW CoachClient: health, hint, review, once-only notice (T6)
│   ├── openings/
│   │   ├── data.ts                   # NEW OpeningsData type + parseOpeningsData() (T7)
│   │   ├── build.ts                  # NEW buildOpeningsData(tsvs) — pure, via game-core (T7)
│   │   └── book.ts                   # NEW OpeningBook + loadOpeningBook()  (T8)
│   ├── review/
│   │   ├── analysis.ts               # NEW classification + Lichess accuracy (T11)
│   │   ├── moveNumber.ts             # NEW moveLabel()                       (T11)
│   │   ├── run.ts                    # NEW runReview()                       (T12)
│   │   └── summary.ts                # NEW templatedSummary(), reviewRequestFrom() (T12)
│   ├── sound/sounds.ts               # NEW SoundPlayer + soundForTransition() (T14)
│   ├── storage/storage.ts            # + showEval setting (T4), history (T13)
│   └── ui/
│       ├── App.tsx                   # wiring (most tasks)
│       ├── gameKey.ts                # NEW stable id per Game object (T2)
│       ├── themes.ts                 # NEW BOARD_THEMES (T15)
│       ├── useEvaluation.ts          # NEW (T4)
│       ├── useOpeningBook.ts         # NEW (T8)
│       ├── useCoach.ts               # NEW (T6)
│       ├── Board/
│       │   ├── Board.tsx             # gutter coordinates (T1), overlay (T2), theme (T15)
│       │   ├── annotations.ts        # NEW Annotation type + geometry (T2)
│       │   ├── BoardOverlay.tsx      # NEW SVG layer, pointer-events: none (T2)
│       │   └── EvalBar.tsx           # NEW (T4)
│       ├── hints/{hintView.ts,useHints.ts}      # NEW (T2)
│       ├── review/{reviewView.ts,useReview.ts,ReviewPanel.tsx}  # NEW (T12)
│       ├── history/{record.ts,HistoryPanel.tsx} # NEW (T13)
│       └── panels/
│           ├── Tabs.tsx              # NEW (T9)
│           ├── Explorer.tsx          # NEW (T9)
│           ├── SettingsPanel.tsx     # NEW (T4; grows in T14, T15)
│           ├── MoveList.tsx          # + review marks (T12)
│           └── Controls.tsx          # hint prop (T2)
└── tests/e2e/
    ├── helpers.ts                    # NEW startOnePlayer, coachOffline, coachOnline
    └── coordinates, hints, eval-bar, coach, opening-name, explorer, book-moves,
        review, history, sounds, themes .spec.ts   # NEW
```

**The pattern to keep:** every component with real logic has a pure sibling (`hintView.ts`, `reviewView.ts`, `record.ts`, `evaluation.ts`, `analysis.ts`) that decides; the component renders. Every new module outside `ui/` is React-free.

---

## Task Order

| # | Task | Complexity |
|---|---|---|
| 1 | Board coordinates in an outside gutter | integration |
| 2 | Board annotation overlay + graded hints | integration |
| 3 | EngineLane: one worker shared by moves and analysis | judgment |
| 4 | Settings state + evaluation bar | integration |
| 5 | Express coach server | integration |
| 6 | Coach client, offline badge, once-only notice | integration |
| 7 | game-core EPD/SAN helpers + vendored openings data | mechanical |
| 8 | OpeningBook + opening name as you play | integration |
| 9 | Right-column tabs + opening explorer | integration |
| 10 | Engine book moves | judgment |
| 11 | Review math: classification and Lichess accuracy | judgment |
| 12 | Post-game review: runner, marks, arrows, summary | integration |
| 13 | Persistent game history | integration |
| 14 | Sounds | integration |
| 15 | Board themes | mechanical |
| 16 | Phase 2 verification sweep | mechanical |

Tasks 1–4 need nothing from the server. Tasks 5–6 add coaching. 7–10 are the openings track. 11–13 review and history. 14–15 are polish. Each task leaves `npm test`, `npm run typecheck` and `npm run e2e` green.

---

### Task 1: Board coordinates in an outside gutter

**Complexity:** integration (CSS layout that must not disturb the board's aspect ratio or pointer/drag math).

**Files:**
- Modify: `src/ui/Board/squares.ts`, `src/ui/Board/squares.test.ts`
- Modify: `src/ui/Board/Board.tsx`, `src/ui/Board/Square.tsx`, `src/ui/Board/board.css`, `src/ui/Board/Board.test.tsx`
- Create: `tests/e2e/coordinates.spec.ts`

**Interfaces:**
- Consumes: `squaresInOrder(orientation)` (existing).
- Produces: `filesInOrder(orientation: 'white' | 'black'): string[]`, `ranksInOrder(orientation): string[]`. Board DOM: `.board-frame` wrapping `.coords-ranks`, `.board` (unchanged `role="grid"`, `aria-label="Chess board"`, 64 `[data-square]` children) and `.coords-files`; labels carry `data-testid="coord-file-<a..h>"` / `coord-rank-<1..8>`. `Square` loses its `fileLabel`/`rankLabel` props. The CSS custom property `--coord-gutter` (1.25rem) is defined on `.board-frame` and reused by the eval bar in Task 4.

- [ ] **Step 1: Write the failing unit tests**

In `src/ui/Board/squares.test.ts`, change the import to
`import { filesInOrder, isLightSquare, ranksInOrder, squaresInOrder } from './squares'` and append:

```ts
describe('gutter label order', () => {
  test('white view: files a..h left to right, ranks 8..1 top to bottom', () => {
    expect(filesInOrder('white')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(ranksInOrder('white')).toEqual(['8', '7', '6', '5', '4', '3', '2', '1'])
  })

  test('black view is mirrored on both axes', () => {
    expect(filesInOrder('black')).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
    expect(ranksInOrder('black')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
})
```

In `src/ui/Board/Board.test.tsx`, replace the whole test `'coordinates label the two edges nearest the viewer and flip with the board'` with:

```tsx
  test('coordinates sit in a gutter outside the board and flip with it', () => {
    const labels = (container: HTMLElement, sel: string) =>
      [...container.querySelectorAll(`${sel} .coord-label`)].map((e) => e.textContent)

    const { container, unmount } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(labels(container, '.coords-files')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(labels(container, '.coords-ranks')).toEqual(['8', '7', '6', '5', '4', '3', '2', '1'])
    // Nothing inside the board grid itself any more.
    expect(container.querySelector('[data-square] .coord, .board .coord-label')).toBeNull()
    // The gutters are siblings of the grid, not children of it.
    const grid = container.querySelector('[role="grid"]')
    expect(grid?.querySelector('.coords-files, .coords-ranks')).toBeNull()
    unmount()

    const flipped = render(
      <Board position={new Position()} orientation="black" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(labels(flipped.container, '.coords-files')).toEqual(['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'])
    expect(labels(flipped.container, '.coords-ranks')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/Board`
Expected: FAIL — `filesInOrder is not a function`/not exported, and the Board test finds no `.coords-files` labels (and still finds `.coord` spans inside squares).

- [ ] **Step 3: Implement**

Append to `src/ui/Board/squares.ts` (after `squaresInOrder`):

```ts
/** File letters left-to-right as the viewer sees them. */
export function filesInOrder(orientation: 'white' | 'black'): string[] {
  const files: string[] = [...FILES]
  return orientation === 'white' ? files : files.reverse()
}

/** Rank numbers top-to-bottom as the viewer sees them. */
export function ranksInOrder(orientation: 'white' | 'black'): string[] {
  const ranks = RANKS.map(String)
  return orientation === 'white' ? ranks : ranks.reverse()
}
```

Replace `src/ui/Board/Square.tsx` with:

```tsx
import type { ReactNode } from 'react'
import type { Square as SquareName } from '../../game-core/types'
import { isLightSquare } from './squares'

export function Square({
  name,
  classes,
  onClick,
  children,
}: {
  name: SquareName
  classes: string[]
  onClick: (square: SquareName) => void
  children?: ReactNode
}) {
  const className = ['square', isLightSquare(name) ? 'light' : 'dark', ...classes].join(' ')
  return (
    <div
      className={className}
      data-square={name}
      role="gridcell"
      aria-label={name}
      onClick={() => onClick(name)}
    >
      {children}
    </div>
  )
}
```

In `src/ui/Board/Board.tsx`: change the squares import to
`import { filesInOrder, ranksInOrder, squaresInOrder } from './squares'`, then replace the entire `return (...)` block of `Board` with:

```tsx
  return (
    <div className={`board-frame ${orientation}`} data-testid="board-frame">
      {/* Coordinates live OUTSIDE the grid: they are page text, not square
          content, so they stay readable in every theme and never sit under a
          piece. aria-hidden because every square already has aria-label. */}
      <div className="coords coords-ranks" aria-hidden="true">
        {ranksInOrder(orientation).map((r) => (
          <span key={r} className="coord-label" data-testid={`coord-rank-${r}`}>
            {r}
          </span>
        ))}
      </div>
      <div
        className={`board ${orientation}`}
        role="grid"
        aria-label="Chess board"
        onPointerDown={handlePointerDown}
      >
        {squaresInOrder(orientation).map((name) => {
          const classes: string[] = []
          if (highlights.selected === name) classes.push('selected')
          if (legal.has(name)) classes.push('legal')
          if (captures.has(name)) classes.push('capture')
          if (highlights.lastMove?.includes(name)) classes.push('last-move')
          if (highlights.check === name) classes.push('check')
          if (draggingSquare === name) classes.push('dragging')
          const piece = pieces.get(name)
          return (
            <Square key={name} name={name} classes={classes} onClick={handleSquareClick}>
              {piece ? <Piece color={piece.color} type={piece.type} /> : null}
            </Square>
          )
        })}
      </div>
      <div className="coords coords-files" aria-hidden="true">
        {filesInOrder(orientation).map((f) => (
          <span key={f} className="coord-label" data-testid={`coord-file-${f}`}>
            {f}
          </span>
        ))}
      </div>
    </div>
  )
```

In `src/ui/Board/board.css`, replace the `.board { ... }` rule with the block below, and delete the four `.coord…` rules (`.coord`, `.coord.rank`, `.coord.file`, `.square.light .coord`, `.square.dark .coord`):

```css
.board-frame {
  --coord-gutter: 1.25rem;
  display: grid;
  grid-template-columns: var(--coord-gutter) minmax(0, 1fr);
  grid-template-rows: auto var(--coord-gutter);
  grid-template-areas:
    'ranks board'
    '.     files';
  /* The board itself may be at most 640px; the gutter comes on top. */
  width: min(100%, calc(640px + var(--coord-gutter)));
}
.board {
  grid-area: board;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  width: 100%;
  /* border-box so the 2px border is inside the width and aspect-ratio, and
     the 8x8 grid inside stays exactly square. */
  box-sizing: border-box;
  aspect-ratio: 1;
  border: 2px solid #3a3226;
  position: relative; /* anchors the annotation overlay (Task 2) */
  user-select: none;
  touch-action: none; /* let us handle touch drags ourselves */
}
.coords {
  display: flex;
  pointer-events: none;
  user-select: none;
  /* Page text colours, not square colours: readable on light and dark hosts. */
  color: var(--color-fg);
  opacity: 0.8;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1;
}
/* 2px padding matches the board border, so each label centres on its square. */
.coords-ranks { grid-area: ranks; flex-direction: column; padding-block: 2px; }
.coords-files { grid-area: files; flex-direction: row; padding-inline: 2px; }
.coord-label { flex: 1; display: flex; align-items: center; justify-content: center; }
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/ui/Board && npm test`
Expected: PASS, total unit count 236 + 2 new squares tests (the rewritten Board test replaces one).

- [ ] **Step 5: Write the browser test**

`tests/e2e/coordinates.spec.ts`:

```ts
import { expect, test, type Locator } from '@playwright/test'

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

test('coordinates line up with the squares from outside the board, and flip', async ({ page }) => {
  await page.goto('/')
  const board = page.getByRole('grid', { name: 'Chess board' })

  for (const flip of [false, true]) {
    if (flip) await page.getByTestId('flip').click()
    const box = await board.boundingBox()
    if (!box) throw new Error('no board box')

    for (const file of ['a', 'e', 'h']) {
      const label = await center(page.getByTestId(`coord-file-${file}`))
      const square = await center(page.locator(`[data-square="${file}4"]`))
      expect(Math.abs(label.x - square.x)).toBeLessThan(3)
      expect(label.y).toBeGreaterThan(box.y + box.height) // beneath the board
    }
    for (const rank of ['1', '5', '8']) {
      const label = await center(page.getByTestId(`coord-rank-${rank}`))
      const square = await center(page.locator(`[data-square="d${rank}"]`))
      expect(Math.abs(label.y - square.y)).toBeLessThan(3)
      expect(label.x).toBeLessThan(box.x) // left of the board
    }
    // The board is still square.
    expect(Math.abs(box.width - box.height)).toBeLessThan(2)
  }

  await expect(page.locator('[data-square] .coord')).toHaveCount(0)

  // Clicking still works with the new wrapper.
  await page.getByTestId('flip').click()
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})

for (const scheme of ['light', 'dark'] as const) {
  test(`coordinates are readable in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/')
    const fg = await page.getByTestId('coord-file-a').evaluate((el) => getComputedStyle(el).color)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
    // WCAG AA for normal text; opacity 0.8 still clears it with the theme tokens.
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThan(4.5)
  })
}
```

Note: `getComputedStyle(...).color` ignores the `opacity: 0.8`; the ratio of the raw tokens is ~16:1 in both themes, so 0.8 opacity keeps it far above 4.5 — the check catches a label coloured with a square colour or a hard-coded dark grey on the dark theme.

- [ ] **Step 6: Run the browser test, and prove it can fail**

Run: `npx playwright test tests/e2e/coordinates.spec.ts`
Expected: PASS (3 tests). Then temporarily swap `filesInOrder(orientation)` for `filesInOrder('white')` in `Board.tsx` and re-run: the flipped pass must FAIL on the `coord-file-a` alignment. Revert.

- [ ] **Step 7: Run the full suites**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all green. `promotion-drag.spec.ts` in particular proves drag math is unaffected by the new wrapper.

- [ ] **Step 8: Commit**

```bash
git add src/ui/Board tests/e2e/coordinates.spec.ts
git commit -m "feat(board): move coordinates into a gutter outside the board

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Board annotation overlay + graded hints

**Complexity:** integration.

**Files:**
- Create: `src/ui/Board/annotations.ts`, `src/ui/Board/annotations.test.ts`, `src/ui/Board/BoardOverlay.tsx`
- Modify: `src/ui/Board/Board.tsx`, `src/ui/Board/board.css`, `src/ui/Board/Board.test.tsx`
- Modify: `src/engine/uci.ts`, `src/engine/uci.test.ts` (add `principalLine`)
- Create: `src/coach/hints.ts`, `src/coach/hints.test.ts`
- Create: `src/ui/hints/hintView.ts`, `src/ui/hints/hintView.test.ts`, `src/ui/hints/useHints.ts`
- Create: `src/ui/gameKey.ts`
- Modify: `src/ui/panels/Controls.tsx`, `src/ui/App.tsx`
- Create: `tests/e2e/helpers.ts`, `tests/e2e/hints.spec.ts`

**Interfaces:**
- Consumes: `uciToIntent`, `EngineInfo` (engine/uci.ts); `Position.clone/tryMove/fen`; `templatedHint(lines, position)` (coach/templated.ts).
- Produces:
  - `type AnnotationTone = 'hint' | 'best' | 'inaccuracy' | 'mistake' | 'blunder'`
  - `type Annotation = { kind: 'square'; square: Square; tone: AnnotationTone } | { kind: 'arrow'; from: Square; to: Square; tone: AnnotationTone }`
  - `squareCenter(square, orientation): { x: number; y: number }` (board units 0–8, origin top-left of the view); `arrowLine(from, to, orientation, headRoom?): { x1; y1; x2; y2 }`
  - `<Board annotations?: readonly Annotation[] />`; overlay DOM: `svg[data-testid="board-overlay"]` with `rect[data-annotation="square"][data-annotation-square][data-tone]` and `line[data-annotation="arrow"][data-from][data-to][data-tone]`. **Never** `data-square` on overlay elements (it would hijack square lookups and e2e selectors).
  - `principalLine(lines: readonly EngineInfo[]): EngineInfo | null` (engine/uci.ts)
  - `HINT_BUDGET = { depth: 12, moveTimeMs: 500, multiPv: 1 }`, `interface HintSuggestion { fen; from: Square; to: Square; san: string; piece: PieceSymbol; lines: readonly EngineInfo[] }`, `type HintStage = 0 | 1 | 2 | 3`, `suggestionFrom(lines, position): HintSuggestion | null`, `nudgeText(piece): string` (coach/hints.ts)
  - `hintAnnotations(stage, s)`, `hintText(stage, s, reasoning)`, `hintButtonLabel(stage, pending)` (ui/hints/hintView.ts)
  - `type HintAnalyze = (fen: string, signal: AbortSignal) => Promise<{ best: string; lines: readonly EngineInfo[] }>`, `type HintReasoner = (s: HintSuggestion, position: Position, signal: AbortSignal) => Promise<string>`, `useHints({ resetKey, analyze, reason })` → `{ stage, pending, text, label, annotations, exhausted, advance(position) }`
  - `gameIdOf(game: Game): number`
  - `Controls` prop `hint: { label: string; text: string; disabled: boolean }` replaces `hintText`/`hintPending`.
  - e2e helpers: `startOnePlayer(page, level?)`, `coachOffline(page)`.

Graded hints (design ruling): press 1 = nudge (highlight the from-square + "Look at your <piece>."), press 2 = the move (arrow from→to, text adds "Try <SAN>."), press 3 = reasoning (templated now; Claude in Task 6). Annotations clear on any move, undo/redo, navigation, or new game — implemented as a `resetKey` of `gameId:livePly:ply`, which changes on every one of those.

- [ ] **Step 1: Write the failing geometry and view tests**

`src/ui/Board/annotations.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { arrowLine, squareCenter } from './annotations'

describe('squareCenter', () => {
  test('white view: a8 top-left, h1 bottom-right', () => {
    expect(squareCenter('a8', 'white')).toEqual({ x: 0.5, y: 0.5 })
    expect(squareCenter('h1', 'white')).toEqual({ x: 7.5, y: 7.5 })
    expect(squareCenter('e1', 'white')).toEqual({ x: 4.5, y: 7.5 })
  })
  test('black view mirrors both axes', () => {
    expect(squareCenter('h1', 'black')).toEqual({ x: 0.5, y: 0.5 })
    expect(squareCenter('e1', 'black')).toEqual({ x: 3.5, y: 0.5 })
  })
})

describe('arrowLine', () => {
  test('starts at the from-centre and stops short of the to-centre', () => {
    const l = arrowLine('e2', 'e4', 'white')
    expect(l.x1).toBeCloseTo(4.5)
    expect(l.y1).toBeCloseTo(6.5)
    expect(l.x2).toBeCloseTo(4.5)
    expect(l.y2).toBeCloseTo(4.85)
  })
  test('flips with the board', () => {
    const l = arrowLine('e2', 'e4', 'black')
    expect(l.y1).toBeCloseTo(1.5)
    expect(l.y2).toBeCloseTo(3.15)
  })
})
```

`src/ui/hints/hintView.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { hintAnnotations, hintButtonLabel, hintText } from './hintView'
import type { HintSuggestion } from '../../coach/hints'

const s: HintSuggestion = { fen: 'x', from: 'g1', to: 'f3', san: 'Nf3', piece: 'n', lines: [] }

describe('hint view', () => {
  test('stage 0 shows nothing', () => {
    expect(hintAnnotations(0, s)).toEqual([])
    expect(hintText(0, s, null)).toBe('')
  })
  test('stage 1 is a nudge: highlight the piece, name it, no arrow', () => {
    expect(hintAnnotations(1, s)).toEqual([{ kind: 'square', square: 'g1', tone: 'hint' }])
    expect(hintText(1, s, null)).toBe('Look at your knight.')
  })
  test('stage 2 adds the arrow and the move', () => {
    expect(hintAnnotations(2, s)).toEqual([
      { kind: 'square', square: 'g1', tone: 'hint' },
      { kind: 'arrow', from: 'g1', to: 'f3', tone: 'hint' },
    ])
    expect(hintText(2, s, null)).toBe('Look at your knight. Try Nf3.')
  })
  test('stage 3 shows the reasoning and keeps the arrow', () => {
    expect(hintText(3, s, 'Develops and controls e5.')).toBe('Develops and controls e5.')
    expect(hintAnnotations(3, s)).toHaveLength(2)
  })
  test('button labels walk through the grades', () => {
    expect([0, 1, 2, 3].map((n) => hintButtonLabel(n as 0 | 1 | 2 | 3, false))).toEqual([
      'Hint', 'Show move', 'Explain', 'Explained',
    ])
    expect(hintButtonLabel(1, true)).toBe('Thinking…')
  })
})
```

`src/coach/hints.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { nudgeText, suggestionFrom } from './hints'
import { Position } from '../game-core/position'

describe('suggestionFrom', () => {
  test('takes the best line (multipv 1, deepest) and resolves SAN and the moving piece', () => {
    const s = suggestionFrom(
      [
        { depth: 10, multipv: 1, scoreCp: 30, pv: ['g1f3', 'g8f6'] },
        { depth: 10, multipv: 2, scoreCp: 20, pv: ['e2e4'] },
      ],
      new Position(),
    )
    expect(s).toMatchObject({ from: 'g1', to: 'f3', san: 'Nf3', piece: 'n' })
  })
  test('an illegal or missing suggestion yields null', () => {
    expect(suggestionFrom([{ pv: ['a1a8'] }], new Position())).toBeNull()
    expect(suggestionFrom([], new Position())).toBeNull()
  })
})

test('nudgeText names the piece', () => {
  expect(nudgeText('q')).toBe('Look at your queen.')
})
```

Append to `src/engine/uci.test.ts` (and add `principalLine` to its import):

```ts
describe('principalLine', () => {
  test('prefers multipv 1 at the greatest depth over later, weaker lines', () => {
    const best = principalLine([
      { depth: 8, multipv: 1, pv: ['d2d4'] },
      { depth: 10, multipv: 1, pv: ['e2e4'] },
      { depth: 10, multipv: 2, pv: ['g1f3'] },
    ])
    expect(best?.pv[0]).toBe('e2e4')
  })
  test('lines without multipv count as rank 1; empty input gives null', () => {
    expect(principalLine([{ depth: 3, pv: ['e2e4'] }])?.pv[0]).toBe('e2e4')
    expect(principalLine([])).toBeNull()
  })
})
```

Append to `src/ui/Board/Board.test.tsx`:

```tsx
  test('annotations render in an overlay that never claims a square', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{}}
        onSquareClick={vi.fn()}
        annotations={[
          { kind: 'square', square: 'g1', tone: 'hint' },
          { kind: 'arrow', from: 'g1', to: 'f3', tone: 'hint' },
        ]}
      />,
    )
    const rect = container.querySelector('[data-annotation="square"]')
    expect(rect?.getAttribute('data-annotation-square')).toBe('g1')
    expect(rect?.getAttribute('x')).toBe('6')
    expect(rect?.getAttribute('y')).toBe('7')
    const arrow = container.querySelector('[data-annotation="arrow"]')
    expect(arrow?.getAttribute('data-from')).toBe('g1')
    expect(arrow?.getAttribute('data-to')).toBe('f3')
    // Still exactly 64 squares: the overlay must not add [data-square] nodes.
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
  })

  test('no annotations, no overlay', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelector('[data-testid="board-overlay"]')).toBeNull()
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/Board src/ui/hints src/coach/hints.test.ts src/engine/uci.test.ts`
Expected: FAIL — modules `./annotations`, `./hintView`, `./hints` not found; `principalLine` not exported; `annotations` prop ignored.

- [ ] **Step 3: Implement the pure modules**

Append to `src/engine/uci.ts`:

```ts
/**
 * The engine's main line: multipv 1 (or unlabelled) at the greatest depth.
 * Not simply the last line received — with MultiPV the last line is usually
 * a weaker alternative.
 */
export function principalLine(lines: readonly EngineInfo[]): EngineInfo | null {
  let best: EngineInfo | null = null
  let maxDepth = -1
  for (const line of lines) {
    if (line.multipv !== undefined && line.multipv !== 1) continue
    const depth = line.depth ?? 0
    if (depth >= maxDepth) {
      best = line
      maxDepth = depth
    }
  }
  return best
}
```

`src/ui/Board/annotations.ts`:

```ts
import type { Square } from '../../game-core/types'

export type AnnotationTone = 'hint' | 'best' | 'inaccuracy' | 'mistake' | 'blunder'

/**
 * Generic board markup. Hints use it now; the review (Task 12) reuses it for
 * the best-move arrow on a flagged move. Deliberately independent of what
 * produced it.
 */
export type Annotation =
  | { kind: 'square'; square: Square; tone: AnnotationTone }
  | { kind: 'arrow'; from: Square; to: Square; tone: AnnotationTone }

export const ANNOTATION_TONES: readonly AnnotationTone[] = ['hint', 'best', 'inaccuracy', 'mistake', 'blunder']

/** Centre of a square in board units (0..8), origin at the top-left of the VIEW. */
export function squareCenter(square: Square, orientation: 'white' | 'black'): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97 // a = 0
  const rank = Number(square[1]) // 1..8
  const col = orientation === 'white' ? file : 7 - file
  const row = orientation === 'white' ? 8 - rank : rank - 1
  return { x: col + 0.5, y: row + 0.5 }
}

/** An arrow from centre to centre, stopped `headRoom` short so the head sits inside the target square. */
export function arrowLine(
  from: Square,
  to: Square,
  orientation: 'white' | 'black',
  headRoom = 0.35,
): { x1: number; y1: number; x2: number; y2: number } {
  const a = squareCenter(from, orientation)
  const b = squareCenter(to, orientation)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  const k = (len - headRoom) / len
  return { x1: a.x, y1: a.y, x2: a.x + dx * k, y2: a.y + dy * k }
}
```

`src/ui/Board/BoardOverlay.tsx`:

```tsx
import { ANNOTATION_TONES, arrowLine, squareCenter, type Annotation } from './annotations'

/**
 * An SVG layer over the squares. `pointer-events: none` (board.css) is
 * load-bearing: clicks and drags must reach the squares underneath, and
 * useDragMove's document.elementFromPoint() must skip this layer.
 */
export function BoardOverlay({
  annotations,
  orientation,
}: {
  annotations: readonly Annotation[]
  orientation: 'white' | 'black'
}) {
  if (annotations.length === 0) return null
  return (
    <svg className="board-overlay" viewBox="0 0 8 8" aria-hidden="true" data-testid="board-overlay">
      <defs>
        {ANNOTATION_TONES.map((tone) => (
          <marker
            key={tone}
            id={`arrowhead-${tone}`}
            viewBox="0 0 4 4"
            refX="2"
            refY="2"
            markerWidth="3"
            markerHeight="3"
            orient="auto"
          >
            <path d="M0,0 L4,2 L0,4 z" className={`arrowhead tone-${tone}`} />
          </marker>
        ))}
      </defs>
      {annotations.map((a, i) => {
        if (a.kind === 'square') {
          const c = squareCenter(a.square, orientation)
          return (
            <rect
              key={`s-${a.square}-${i}`}
              className={`annotation-square tone-${a.tone}`}
              x={c.x - 0.5}
              y={c.y - 0.5}
              width={1}
              height={1}
              data-annotation="square"
              data-annotation-square={a.square}
              data-tone={a.tone}
            />
          )
        }
        const l = arrowLine(a.from, a.to, orientation)
        return (
          <line
            key={`a-${a.from}${a.to}-${i}`}
            className={`annotation-arrow tone-${a.tone}`}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            markerEnd={`url(#arrowhead-${a.tone})`}
            data-annotation="arrow"
            data-from={a.from}
            data-to={a.to}
            data-tone={a.tone}
          />
        )
      })}
    </svg>
  )
}
```

In `src/ui/Board/Board.tsx`: add imports `import { BoardOverlay } from './BoardOverlay'` and `import type { Annotation } from './annotations'`; add the prop to the destructuring and type (after `dragging`):

```tsx
  annotations = [],
}: {
  // ...existing props...
  /** Square highlights and arrows drawn above the pieces (hints, review). */
  annotations?: readonly Annotation[]
```

and render the overlay as the LAST child inside the `.board` grid div, after the squares map:

```tsx
        <BoardOverlay annotations={annotations} orientation={orientation} />
```

(An absolutely positioned child of a CSS grid does not occupy a grid cell, so the 8×8 layout is untouched.)

Append to `src/ui/Board/board.css`:

```css
.board-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* clicks and drags pass through to the squares */
  z-index: 2;
}
.annotation-square { fill-opacity: 0.45; stroke: none; }
.annotation-arrow { stroke-width: 0.18; stroke-linecap: round; opacity: 0.85; fill: none; }
.arrowhead { stroke: none; }
.tone-hint { fill: #2f80ed; stroke: #2f80ed; }
.tone-best { fill: #27ae60; stroke: #27ae60; }
.tone-inaccuracy { fill: #e2b93b; stroke: #e2b93b; }
.tone-mistake { fill: #f2994a; stroke: #f2994a; }
.tone-blunder { fill: #eb5757; stroke: #eb5757; }
.annotation-arrow.tone-hint, .annotation-arrow.tone-best,
.annotation-arrow.tone-inaccuracy, .annotation-arrow.tone-mistake,
.annotation-arrow.tone-blunder { fill: none; }
```

`src/coach/hints.ts`:

```ts
import { principalLine, uciToIntent, type EngineInfo } from '../engine/uci'
import type { Position } from '../game-core/position'
import type { PieceSymbol, Square } from '../game-core/types'

/** Budget for the hint's analysis: full strength, bounded wait. */
export const HINT_BUDGET = { depth: 12, moveTimeMs: 500, multiPv: 1 } as const

export type HintStage = 0 | 1 | 2 | 3

export interface HintSuggestion {
  /** The position the suggestion is for. */
  fen: string
  from: Square
  to: Square
  san: string
  piece: PieceSymbol
  lines: readonly EngineInfo[]
}

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/** The engine's best move as a checked, displayable suggestion; null if it is unusable. */
export function suggestionFrom(lines: readonly EngineInfo[], position: Position): HintSuggestion | null {
  const uci = principalLine(lines)?.pv[0]
  const intent = uci ? uciToIntent(uci) : null
  if (!intent) return null
  const probe = position.clone()
  const played = probe.tryMove(intent)
  if (!played.ok) return null
  return {
    fen: position.fen(),
    from: played.move.from,
    to: played.move.to,
    san: played.move.san,
    piece: played.move.piece,
    lines,
  }
}

export function nudgeText(piece: PieceSymbol): string {
  return `Look at your ${PIECE_NAME[piece]}.`
}
```

`src/ui/hints/hintView.ts`:

```ts
import { nudgeText, type HintStage, type HintSuggestion } from '../../coach/hints'
import type { Annotation } from '../Board/annotations'

export function hintAnnotations(stage: HintStage, s: HintSuggestion | null): Annotation[] {
  if (!s || stage === 0) return []
  const nudge: Annotation = { kind: 'square', square: s.from, tone: 'hint' }
  if (stage === 1) return [nudge]
  return [nudge, { kind: 'arrow', from: s.from, to: s.to, tone: 'hint' }]
}

export function hintText(stage: HintStage, s: HintSuggestion | null, reasoning: string | null): string {
  if (!s || stage === 0) return ''
  if (stage === 1) return nudgeText(s.piece)
  if (stage === 2) return `${nudgeText(s.piece)} Try ${s.san}.`
  return reasoning ?? ''
}

const LABELS = ['Hint', 'Show move', 'Explain', 'Explained'] as const

export function hintButtonLabel(stage: HintStage, pending: boolean): string {
  return pending ? 'Thinking…' : LABELS[stage]
}
```

`src/ui/gameKey.ts`:

```ts
import type { Game } from '../game-core/game'

const ids = new WeakMap<Game, number>()
let next = 1

/** A stable number per Game object: a new game or a load gets a new id. */
export function gameIdOf(game: Game): number {
  let id = ids.get(game)
  if (id === undefined) {
    id = next++
    ids.set(game, id)
  }
  return id
}
```

`src/ui/hints/useHints.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineInfo } from '../../engine/uci'
import type { Position } from '../../game-core/position'
import { suggestionFrom, type HintStage, type HintSuggestion } from '../../coach/hints'
import { hintAnnotations, hintButtonLabel, hintText } from './hintView'

export type HintAnalyze = (
  fen: string,
  signal: AbortSignal,
) => Promise<{ best: string; lines: readonly EngineInfo[] }>

export type HintReasoner = (s: HintSuggestion, position: Position, signal: AbortSignal) => Promise<string>

interface State {
  stage: HintStage
  suggestion: HintSuggestion | null
  reasoning: string | null
  pending: boolean
  message: string | null
}

const INITIAL: State = { stage: 0, suggestion: null, reasoning: null, pending: false, message: null }

/**
 * Graded hints: nudge -> move -> reasoning. `resetKey` must change on any
 * move, undo/redo, navigation or new game; that clears the hint and aborts
 * whatever it was still waiting for (a stale reply is dropped by the
 * aborted-signal check, whether or not the producer honours the signal).
 */
export function useHints({
  resetKey,
  analyze,
  reason,
}: {
  resetKey: string
  analyze: HintAnalyze
  reason: HintReasoner
}) {
  const [state, setState] = useState<State>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState(INITIAL)
  }, [resetKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const advance = useCallback(
    (position: Position) => {
      if (state.pending || state.stage === 3) return
      if (state.stage === 1) {
        setState((s) => ({ ...s, stage: 2 }))
        return
      }
      const ctrl = new AbortController()
      abortRef.current?.abort()
      abortRef.current = ctrl

      if (state.stage === 0) {
        setState((s) => ({ ...s, pending: true, message: null }))
        analyze(position.fen(), ctrl.signal)
          .then((out) => {
            if (ctrl.signal.aborted) return
            const suggestion = suggestionFrom(out.lines, position)
            setState(
              suggestion
                ? { ...INITIAL, stage: 1, suggestion }
                : { ...INITIAL, message: 'No hint available.' },
            )
          })
          .catch(() => {
            if (!ctrl.signal.aborted) setState({ ...INITIAL, message: 'Hint unavailable.' })
          })
        return
      }

      // stage 2 -> 3: the reasoning.
      const suggestion = state.suggestion
      if (!suggestion) return
      setState((s) => ({ ...s, pending: true }))
      reason(suggestion, position, ctrl.signal)
        .then((text) => {
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, stage: 3, pending: false, reasoning: text }))
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setState((s) => ({ ...s, stage: 3, pending: false, reasoning: 'No explanation available.' }))
          }
        })
    },
    [state, analyze, reason],
  )

  return {
    stage: state.stage,
    pending: state.pending,
    text: state.message ?? hintText(state.stage, state.suggestion, state.reasoning),
    label: hintButtonLabel(state.stage, state.pending),
    annotations: hintAnnotations(state.stage, state.suggestion),
    exhausted: state.stage === 3,
    advance,
  }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/ui/Board src/ui/hints src/coach src/engine/uci.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire Controls and App**

In `src/ui/panels/Controls.tsx`: in both the destructuring and the props type, delete `hintText`/`hintPending` and add `hint`:

```tsx
  hint: { label: string; text: string; disabled: boolean }
```

delete the line `const hintDisabled = !engineAvailable || phase.kind !== 'awaiting-human' || hintPending`, and replace the hint row with:

```tsx
      <div className="controls-row hint-row">
        <button data-testid="hint" onClick={onHint} disabled={hint.disabled}>
          {hint.label}
        </button>
        <span className="hint-text" data-testid="hint-text" aria-live="polite">
          {hint.text}
        </span>
      </div>
```

`engineAvailable` was only used for the hint's disabled state, which App now computes: delete it from Controls' destructuring and props type, and delete `engineAvailable={engineAvailable}` from the `<Controls …>` call in App (an unused destructured prop fails `noUnusedLocals`).

In `src/ui/App.tsx`:

1. Change `import { useCallback, useEffect, useRef, useState } from 'react'` — unchanged; add imports:

```tsx
import { useHints, type HintAnalyze, type HintReasoner } from './hints/useHints'
import { HINT_BUDGET } from '../coach/hints'
import { gameIdOf } from './gameKey'
```

2. Delete `const [hintText, setHintText] = useState('')` and `const [hintPending, setHintPending] = useState(false)`, and the two `setHintText('')` lines (in `startMatch` and `loadMatch`) — the reset key clears hints on a new game.

3. Replace the whole `const handleHint = async () => { … }` function with:

```tsx
  // Interim adapter: Task 3 replaces this body with controller.analyze(),
  // which schedules against the controller's own searches. Until then the
  // hint button is only enabled on the human's turn, when the controller is
  // not searching.
  const analyzeForHint = useCallback<HintAnalyze>(
    async (fen) => {
      if (!engine) throw new Error('engine unavailable')
      await engine.waitReady()
      engine.configure(profileFor(8))
      engine.setPosition(fen, [])
      return engine.search(HINT_BUDGET)
    },
    [engine],
  )

  // Press 3 = reasoning. Templated for now; Task 6 asks Claude first.
  const reasonForHint = useCallback<HintReasoner>(
    async (s, pos) => templatedHint([...s.lines], pos) ?? `${s.san} is the engine's choice.`,
    [],
  )

  const hints = useHints({
    resetKey: `${gameIdOf(game)}:${game.livePly}:${game.ply}`,
    analyze: analyzeForHint,
    reason: reasonForHint,
  })

  // Hints are always about the LIVE position (the button is disabled while browsing).
  const handleHint = () => hints.advance(game.positionAt(game.livePly))
```

4. On `<Board …>` add `annotations={hints.annotations}`.

5. On `<Controls …>` replace `hintText={hintText}` and `hintPending={hintPending}` with:

```tsx
            hint={{
              label: hints.label,
              text: hints.text,
              disabled:
                !engineAvailable ||
                snapshot.phase.kind !== 'awaiting-human' ||
                !game.isViewingLive() ||
                hints.pending ||
                hints.exhausted,
            }}
```

and `onHint={() => void handleHint()}` with `onHint={handleHint}`.

Run: `npm run typecheck && npm test`
Expected: PASS (the existing "hint button disabled" App test still holds: no engine in jsdom).

- [ ] **Step 6: Write the browser test**

`tests/e2e/helpers.ts`:

```ts
import type { Page } from '@playwright/test'

/** One-player game, human White, at the given level. */
export async function startOnePlayer(page: Page, level = '1'): Promise<void> {
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption(level)
  await page.getByTestId('color').selectOption('white')
  await page.getByTestId('new-game').click()
}

/** Make every /api call fail at the network level: the coaching server is "down". */
export async function coachOffline(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => route.abort())
}
```

`tests/e2e/hints.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline, startOnePlayer } from './helpers'

test('graded hints: nudge, then the move, then the reasoning; a move clears them', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await startOnePlayer(page)

  const hint = page.getByTestId('hint')
  const text = page.getByTestId('hint-text')
  const highlight = page.locator('[data-annotation="square"][data-tone="hint"]')
  const arrow = page.locator('[data-annotation="arrow"][data-tone="hint"]')

  // 1: the nudge — a highlighted piece and its name, but not the move.
  await hint.click()
  await expect(text).toContainText('Look at your', { timeout: 30_000 })
  await expect(highlight).toHaveCount(1)
  await expect(arrow).toHaveCount(0)
  await expect(hint).toHaveText('Show move')

  // 2: the move — an arrow from the highlighted square.
  await hint.click()
  await expect(arrow).toHaveCount(1)
  const from = await arrow.getAttribute('data-from')
  const to = await arrow.getAttribute('data-to')
  expect(await highlight.getAttribute('data-annotation-square')).toBe(from)
  await expect(text).toContainText('Try ')

  // 3: the reasoning.
  await hint.click()
  await expect(text).not.toContainText('Look at your', { timeout: 30_000 })
  await expect(text).toHaveText(/\S/)
  await expect(hint).toBeDisabled()

  // Play the suggested move by clicking THROUGH the overlay. If the overlay
  // took pointer events, Playwright would refuse: "<svg> intercepts pointer events".
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
  await expect(page.getByTestId('ply-count')).toHaveText(/^[12]$/)
  await expect(page.locator('[data-annotation]')).toHaveCount(0)
  await expect(text).toHaveText('')
})
```

- [ ] **Step 7: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/hints.spec.ts`
Expected: PASS. Then delete `pointer-events: none;` from `.board-overlay` and re-run: the click on the from-square must FAIL with an "intercepts pointer events" timeout. Restore it. Then change the resetKey to a constant `'x'` and re-run: the final `toHaveCount(0)` must FAIL. Restore.

- [ ] **Step 8: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: all green.

```bash
git add src tests/e2e
git commit -m "feat(board,coach): SVG annotation overlay and graded hints (nudge, move, reasoning)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: EngineLane — one worker shared by moves and analysis

**Complexity:** judgment (concurrency against a single UCI process; the scheduling rules below are the design, do not simplify them away).

**Files:**
- Create: `src/engine/lane.ts`, `src/engine/lane.test.ts`
- Modify: `src/match/controller.ts`, `src/match/controller.test.ts`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `EngineLike` (controller.ts) — `waitReady/configure/newGame/setPosition/search/stop`; `profileFor(8)`; `EngineInfo`.
- Produces:
  - `interface AnalysisRequest { fen: string; depth: number; moveTimeMs: number; multiPv?: number }`
  - `interface SearchOutcome { best: string; lines: readonly EngineInfo[] }`
  - `class AnalysisAborted extends Error`, `class StaleRequest extends Error`
  - `class EngineLane { move(req: { profile: StrengthProfile; fen: string; limits: { depth; moveTimeMs; multiPv } }, isCurrent: () => boolean): Promise<SearchOutcome>; analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome>; newGame(): void; dispose(): void }`
  - `MatchController.analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome>` — the ONLY way UI code gets engine analysis from here on.

**The scheduling rules (why this shape):**
1. *Moves pre-empt analysis.* `move()` first pre-empts any running analysis: it posts `stop` BEFORE the move's `setoption`/`position`, so Stockfish is idle when those arrive (sending `position` mid-search is a UCI protocol violation). The move's `search()` then supersedes the analysis search inside `EngineClient` (the existing isready/readyok barrier discards the analysis `bestmove`). The pre-empted job goes back to the FRONT of the queue and re-runs later; its caller just waits longer.
2. *Analysis waits for moves.* While any move search is in flight, analysis stays queued. After a move settles, the queue is pumped on a `setTimeout(0)` — a macrotask — so a controller that immediately asks for the next move (zero-player at speed 0) registers it first and analysis never delays it.
3. *Move vs move keeps Phase 1 behaviour:* forwarded directly; `EngineClient.search()` supersedes. The lane never awaits a superseded promise (a fake engine in tests may never settle it).
4. *Staleness:* the controller passes `isCurrent`; after `waitReady()` a stale move throws `StaleRequest` without touching the engine. Analysis callers use `AbortSignal`; aborting a queued job removes it, aborting the running job posts `stop`.
5. Analysis always runs at full strength: `configure(profileFor(8))`. Every move search already calls `configure(profile)` first, so strength never leaks between the two.

- [ ] **Step 1: Write the failing lane tests**

`src/engine/lane.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AnalysisAborted, EngineLane, StaleRequest } from './lane'
import { profileFor } from './strength'
import type { EngineInfo } from './uci'

/**
 * A hand-driven engine that behaves like EngineClient where it matters:
 * a new search() REJECTS the previous unsettled one ("superseded").
 * `log` records every command in order so tests can assert sequencing.
 */
function fakeEngine() {
  const log: string[] = []
  const searches: Array<{
    settled: boolean
    resolve: (best: string, lines?: EngineInfo[]) => void
    reject: (e: Error) => void
  }> = []
  const engine = {
    waitReady: () => Promise.resolve(),
    configure: (p: { level: number }) => void log.push(`configure:${p.level}`),
    newGame: () => void log.push('newGame'),
    setPosition: (fen: string) => void log.push(`position:${fen}`),
    stop: () => void log.push('stop'),
    search: (l: { depth: number; moveTimeMs: number; multiPv: number }) =>
      new Promise<{ best: string; lines: EngineInfo[] }>((resolve, reject) => {
        log.push(`go:${l.depth}`)
        for (const old of searches) {
          if (!old.settled) old.reject(new Error('search superseded by a newer search() call'))
        }
        const s = {
          settled: false,
          resolve: (best: string, lines: EngineInfo[] = []) => {
            s.settled = true
            resolve({ best, lines })
          },
          reject: (e: Error) => {
            s.settled = true
            reject(e)
          },
        }
        searches.push(s)
      }),
  }
  return { log, searches, engine }
}

const MOVE = { profile: profileFor(3), fen: 'MOVE-FEN', limits: { depth: 3, moveTimeMs: 150, multiPv: 4 } }
const REQ = { fen: 'ANALYSIS-FEN', depth: 14, moveTimeMs: 300 }

describe('EngineLane', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('analysis on an idle engine runs at full strength', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const p = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log).toEqual(['configure:8', 'position:ANALYSIS-FEN', 'go:14'])
    f.searches[0]?.resolve('e2e4', [{ depth: 14, scoreCp: 20, pv: ['e2e4'] }])
    await expect(p).resolves.toMatchObject({ best: 'e2e4' })
  })

  test('analysis waits while a move search is in flight', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const move = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    const analysis = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1) // only the move

    f.searches[0]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(2)
    expect(f.log.slice(-3)).toEqual(['configure:8', 'position:ANALYSIS-FEN', 'go:14'])
    f.searches[1]?.resolve('g1f3')
    await expect(analysis).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('a move pre-empts running analysis: stop first, then the move; analysis re-runs after', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const analysis = lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)

    const move = lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    // stop is posted BEFORE the move's configure/position.
    const i = f.log.lastIndexOf('stop')
    expect(i).toBeGreaterThan(-1)
    expect(f.log.slice(i)).toEqual(['stop', 'configure:3', 'position:MOVE-FEN', 'go:3'])

    f.searches[1]?.resolve('e7e5')
    await expect(move).resolves.toMatchObject({ best: 'e7e5' })
    await vi.advanceTimersByTimeAsync(0)
    // The pre-empted analysis ran again and its caller gets THAT result.
    expect(f.searches).toHaveLength(3)
    f.searches[2]?.resolve('d2d4')
    await expect(analysis).resolves.toMatchObject({ best: 'd2d4' })
  })

  test('aborting a queued request rejects it and it never reaches the engine', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    void lane.move(MOVE, () => true)
    await vi.advanceTimersByTimeAsync(0)
    const ctrl = new AbortController()
    const p = lane.analyze(REQ, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted)
    f.searches[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(f.searches).toHaveLength(1)
  })

  test('aborting the running request stops the engine and rejects', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const ctrl = new AbortController()
    const p = lane.analyze(REQ, ctrl.signal)
    await vi.advanceTimersByTimeAsync(0)
    ctrl.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisAborted)
    expect(f.log.at(-1)).toBe('stop')
  })

  test('a move that went stale while waiting for readiness never touches the engine', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    await expect(lane.move(MOVE, () => false)).rejects.toBeInstanceOf(StaleRequest)
    expect(f.log).toEqual([])
  })

  test('newGame pre-empts analysis before ucinewgame', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    void lane.analyze(REQ)
    await vi.advanceTimersByTimeAsync(0)
    lane.newGame()
    expect(f.log.slice(-2)).toEqual(['stop', 'newGame'])
  })

  test('dispose rejects queued and running analysis', async () => {
    const f = fakeEngine()
    const lane = new EngineLane(f.engine)
    const a = lane.analyze(REQ)
    const b = lane.analyze({ ...REQ, fen: 'B' })
    await vi.advanceTimersByTimeAsync(0)
    lane.dispose()
    await expect(a).rejects.toThrow(/disposed/)
    await expect(b).rejects.toThrow(/disposed/)
  })
})
```

Append to `src/match/controller.test.ts` (inside the `describe('MatchController'` block; it reuses the file's `fakeEngine` and `HUMAN_VS_ENGINE`):

```ts
  test('analysis requested while the engine is choosing a move waits for the move', async () => {
    const e = fakeEngine({ rejectOnSupersede: true })
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // the engine's move search

    const analysis = c.analyze({ fen: c.snapshot().game.current().fen(), depth: 10, moveTimeMs: 100 })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // not raced

    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(e.calls).toHaveLength(2) // now the analysis
    e.calls[1]?.resolve('g1f3')
    await expect(analysis).resolves.toMatchObject({ best: 'g1f3' })
  })

  test('an engine move pre-empts running analysis and still lands', async () => {
    const e = fakeEngine({ rejectOnSupersede: true })
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    void c.analyze({ fen: c.snapshot().game.current().fen(), depth: 10, moveTimeMs: 100 }).catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1) // analysis running

    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.client.stop).toHaveBeenCalled()
    expect(e.calls).toHaveLength(2) // the move search superseded it
    e.calls[1]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/lane.test.ts src/match/controller.test.ts`
Expected: FAIL — `./lane` not found; `c.analyze is not a function`.

- [ ] **Step 3: Implement the lane**

`src/engine/lane.ts`:

```ts
import { profileFor, type StrengthProfile } from './strength'
import type { EngineInfo } from './uci'

/** The engine surface the lane drives. Structurally a subset of EngineClient. */
export interface LaneEngine {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves: string[]): void
  search(limits: { depth: number; moveTimeMs: number; multiPv: number }): Promise<{
    best: string
    lines: readonly EngineInfo[]
  }>
  stop(): void
}

export interface AnalysisRequest {
  fen: string
  depth: number
  moveTimeMs: number
  multiPv?: number
}

export interface SearchOutcome {
  best: string
  lines: readonly EngineInfo[]
}

export class AnalysisAborted extends Error {
  constructor() {
    super('analysis aborted')
    this.name = 'AnalysisAborted'
  }
}

export class StaleRequest extends Error {
  constructor() {
    super('engine request went stale before it started')
    this.name = 'StaleRequest'
  }
}

interface Job {
  req: AnalysisRequest
  resolve: (r: SearchOutcome) => void
  reject: (e: Error) => void
  signal: AbortSignal | undefined
}

/** Full strength for every analysis; set on each run because moves reconfigure. */
const ANALYSIS_PROFILE = profileFor(8)

/**
 * The single scheduler in front of the single Stockfish worker.
 * See Task 3 of the Phase 2 plan for the rules; in short: moves pre-empt
 * analysis, analysis waits for moves, and nothing else talks to the engine.
 */
export class EngineLane {
  private readonly engine: LaneEngine
  private movesInFlight = 0
  private running: { job: Job; token: number } | null = null
  private queue: Job[] = []
  private token = 0
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(engine: LaneEngine) {
    this.engine = engine
  }

  async move(
    req: { profile: StrengthProfile; fen: string; limits: { depth: number; moveTimeMs: number; multiPv: number } },
    isCurrent: () => boolean,
  ): Promise<SearchOutcome> {
    this.preemptAnalysis()
    this.movesInFlight++
    try {
      await this.engine.waitReady()
      if (!isCurrent()) throw new StaleRequest()
      this.engine.configure(req.profile)
      this.engine.setPosition(req.fen, [])
      return await this.engine.search(req.limits)
    } finally {
      this.movesInFlight--
      this.schedulePump()
    }
  }

  analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome> {
    if (this.disposed) return Promise.reject(new Error('engine lane disposed'))
    if (signal?.aborted) return Promise.reject(new AnalysisAborted())
    return new Promise<SearchOutcome>((resolve, reject) => {
      const job: Job = { req, resolve, reject, signal }
      signal?.addEventListener('abort', () => this.abortJob(job), { once: true })
      this.queue.push(job)
      this.schedulePump()
    })
  }

  newGame(): void {
    this.preemptAnalysis()
    this.engine.newGame()
  }

  dispose(): void {
    this.disposed = true
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer)
    const err = new Error('engine lane disposed')
    this.running?.job.reject(err)
    this.running = null
    for (const job of this.queue) job.reject(err)
    this.queue = []
  }

  /** Stop the running analysis (if any) and put it back at the front of the queue. */
  private preemptAnalysis(): void {
    const running = this.running
    if (!running) return
    this.running = null // invalidates its token: its eventual reply is ignored
    this.engine.stop()
    this.queue.unshift(running.job)
    // For move(): movesInFlight is incremented synchronously right after this,
    // so the pump will wait. For newGame(): nothing else would wake the queue.
    this.schedulePump()
  }

  private abortJob(job: Job): void {
    const queued = this.queue.indexOf(job)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      job.reject(new AnalysisAborted())
      return
    }
    if (this.running?.job === job) {
      this.running = null
      this.engine.stop()
      job.reject(new AnalysisAborted())
      this.schedulePump()
    }
  }

  /** A macrotask, so a move requested in the same turn of the event loop goes first. */
  private schedulePump(): void {
    if (this.disposed || this.pumpTimer !== null) return
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null
      this.pump()
    }, 0)
  }

  private pump(): void {
    if (this.disposed || this.movesInFlight > 0 || this.running) return
    const job = this.queue.shift()
    if (!job) return
    const token = ++this.token
    this.running = { job, token }
    const isMine = () => this.running?.token === token

    void (async () => {
      try {
        await this.engine.waitReady()
        if (!isMine()) return
        this.engine.configure(ANALYSIS_PROFILE)
        this.engine.setPosition(job.req.fen, [])
        const out = await this.engine.search({
          depth: job.req.depth,
          moveTimeMs: job.req.moveTimeMs,
          multiPv: job.req.multiPv ?? 1,
        })
        if (!isMine()) return // pre-empted (re-queued) or aborted (already rejected)
        this.running = null
        job.resolve(out)
      } catch (err) {
        if (!isMine()) return
        this.running = null
        job.reject(err instanceof Error ? err : new Error(String(err)))
      } finally {
        this.schedulePump()
      }
    })()
  }
}
```

- [ ] **Step 4: Route the controller through the lane**

In `src/match/controller.ts`:

1. Add `import { EngineLane, type AnalysisRequest, type SearchOutcome } from '../engine/lane'`.
2. Add a field below `private readonly engine: EngineLike`:

```ts
  /** The ONLY path to the engine: moves pre-empt analysis, analysis waits for moves. */
  private readonly lane: EngineLane
```

and in the constructor, after `this.engine = deps.engine`: `this.lane = new EngineLane(this.engine)`.

3. Add a public method after `clockState()`:

```ts
  /**
   * Low-priority engine analysis for the UI (hints, eval bar, review). It
   * never races the controller's own move searches; see EngineLane.
   */
  analyze(req: AnalysisRequest, signal?: AbortSignal): Promise<SearchOutcome> {
    return this.lane.analyze(req, signal)
  }
```

4. In `begin()`, replace `this.engine.newGame()` with `this.lane.newGame()`.
5. In `dispose()`, add `this.lane.dispose()` immediately before `this.engine.dispose()`.
6. In `askEngine()`, replace everything from `await this.engine.waitReady()` down to and including the `const result = await this.engine.search({ … })` statement with:

```ts
      const multiPv = profile.blunderChance > 0 ? profile.blunderPool : 1
      // Always the LIVE position: the user may be browsing an earlier ply.
      // We pass a validated FEN: Stockfish 19 kills its own worker on bad input.
      const result = await this.lane.move(
        {
          profile,
          fen: this.livePosition().fen(),
          limits: { depth: profile.depth, moveTimeMs: profile.moveTimeMs, multiPv },
        },
        () => id === this.requestId,
      )
```

(the existing `if (id !== this.requestId) return // a stale reply; drop it` line stays right after it; a `StaleRequest` rejection lands in the existing `catch`, where the `id !== this.requestId` check returns quietly.)

`EngineLike` already satisfies `LaneEngine` structurally; no change to it.

- [ ] **Step 5: Hints go through the controller**

In `src/ui/App.tsx`, replace the body of `analyzeForHint` (and its comment) with:

```tsx
  // Through the controller's lane: never races the engine's own move search.
  const analyzeForHint = useCallback<HintAnalyze>(
    (fen, signal) => controller.analyze({ fen, ...HINT_BUDGET }, signal),
    [controller],
  )
```

and delete the now-unused `import { profileFor } from '../engine/strength'`. `engine` is still used for `onDead`.

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run src/engine src/match && npm test && npm run typecheck`
Expected: PASS — all pre-existing controller tests unchanged, plus the new lane and controller tests. If a pre-existing controller test now fails, the lane changed call ORDER or added an await before `configure`; fix the lane, not the test.

- [ ] **Step 7: Browser check**

Run: `npx playwright test tests/e2e/one-player.spec.ts tests/e2e/zero-player.spec.ts tests/e2e/zero-player-browse.spec.ts tests/e2e/hints.spec.ts`
Expected: PASS. (The eval bar in Task 4 adds the e2e that drives analysis and engine moves concurrently.) Prove the lane matters: temporarily make `move()` skip `this.preemptAnalysis()` and re-run the new controller test "an engine move pre-empts running analysis" — it must FAIL on `stop` not called. Restore.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(engine): EngineLane shares the one worker between moves and analysis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Settings state + evaluation bar

**Complexity:** integration.

**Files:**
- Modify: `src/storage/storage.ts`, `src/storage/storage.test.ts` (`showEval`)
- Create: `src/engine/evaluation.ts`, `src/engine/evaluation.test.ts`
- Create: `src/ui/useEvaluation.ts`, `src/ui/useEvaluation.test.tsx`
- Create: `src/ui/Board/EvalBar.tsx`, `src/ui/Board/EvalBar.test.tsx`
- Create: `src/ui/panels/SettingsPanel.tsx`
- Modify: `src/ui/Board/board.css`, `src/ui/app.css`, `src/ui/App.tsx`
- Create: `tests/e2e/eval-bar.spec.ts`

**Interfaces:**
- Consumes: `principalLine` (T2), `controller.analyze`, `AnalysisRequest`, `SearchOutcome` (T3).
- Produces:
  - `Settings.showEval: boolean` (default `true`).
  - `type WhiteEval = { kind: 'cp'; cp: number } | { kind: 'mate'; mate: number } | { kind: 'result'; winner: Color | null }` — always from White's point of view; `mate > 0` means White mates.
  - `toWhitePov(info: EngineInfo, sideToMove: Color): WhiteEval | null`, `evalFromLines(lines, sideToMove): WhiteEval | null`, `winPercentFromCp(cp: number): number`, `whiteWinPercent(e: WhiteEval): number`, `formatEval(e: WhiteEval): string`.
  - `EVAL_BUDGET = { depth: 14, moveTimeMs: 300, multiPv: 1 }`, `type EvalAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>`, `type EvalCache = Map<string, WhiteEval>` (keyed by FULL FEN; the review writes into it in Task 12), `useEvaluation({ analyze, fen, status, enabled, cache }): WhiteEval | null`.
  - `<EvalBar evaluation={WhiteEval | null} orientation />` — `data-testid="eval-bar"`, `data-orientation`, label `data-testid="eval-label"`.
  - `<SettingsPanel settings onChange={(patch: Partial<Settings>) => void} />` — grows in Tasks 14 and 15.
  - App: `settings` becomes state with `updateSettings(patch)` that persists every change (the Phase 1 code held a frozen copy and would have overwritten any later setting when a new game started).

Eval budget ruling: depth 14 / 300 ms. Stockfish lite-single reaches depth ~12–16 in 300 ms from the opening to the middlegame, enough for a stable bar, and 300 ms is short enough that a pre-empted analysis (Task 3) costs the engine move nothing. In zero-player at speed 0 the bar may lag: moves always win.

- [ ] **Step 1: Write the failing tests**

`src/engine/evaluation.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { evalFromLines, formatEval, toWhitePov, whiteWinPercent, winPercentFromCp } from './evaluation'

describe('toWhitePov', () => {
  test('scores are side-to-move relative; Black to move flips the sign', () => {
    expect(toWhitePov({ scoreCp: 50, pv: [] }, 'w')).toEqual({ kind: 'cp', cp: 50 })
    expect(toWhitePov({ scoreCp: 50, pv: [] }, 'b')).toEqual({ kind: 'cp', cp: -50 })
  })
  test('mate scores flip too: Black to move and being mated means White mates', () => {
    expect(toWhitePov({ scoreMate: -3, pv: [] }, 'b')).toEqual({ kind: 'mate', mate: 3 })
    expect(toWhitePov({ scoreMate: 2, pv: [] }, 'b')).toEqual({ kind: 'mate', mate: -2 })
  })
  test('no score, no evaluation', () => {
    expect(toWhitePov({ pv: ['e2e4'] }, 'w')).toBeNull()
  })
  test('evalFromLines uses the principal line', () => {
    expect(
      evalFromLines(
        [
          { depth: 12, multipv: 1, scoreCp: 40, pv: ['e2e4'] },
          { depth: 12, multipv: 2, scoreCp: -90, pv: ['a2a3'] },
        ],
        'w',
      ),
    ).toEqual({ kind: 'cp', cp: 40 })
  })
})

describe('win percent (Lichess)', () => {
  test('matches the published formula, clamped at ±1000cp', () => {
    expect(winPercentFromCp(0)).toBe(50)
    expect(winPercentFromCp(100)).toBeCloseTo(59.1026, 3)
    expect(winPercentFromCp(-300)).toBeCloseTo(24.8874, 3)
    expect(winPercentFromCp(1000)).toBeCloseTo(97.5447, 3)
    expect(winPercentFromCp(5000)).toBeCloseTo(97.5447, 3)
  })
  test('mates and results are certain', () => {
    expect(whiteWinPercent({ kind: 'mate', mate: 4 })).toBe(100)
    expect(whiteWinPercent({ kind: 'mate', mate: -1 })).toBe(0)
    expect(whiteWinPercent({ kind: 'result', winner: null })).toBe(50)
    expect(whiteWinPercent({ kind: 'result', winner: 'b' })).toBe(0)
  })
})

test('formatEval', () => {
  expect(formatEval({ kind: 'cp', cp: 83 })).toBe('+0.8')
  expect(formatEval({ kind: 'cp', cp: -250 })).toBe('-2.5')
  expect(formatEval({ kind: 'cp', cp: 0 })).toBe('0.0')
  expect(formatEval({ kind: 'mate', mate: 1 })).toBe('M1')
  expect(formatEval({ kind: 'mate', mate: -3 })).toBe('-M3')
  expect(formatEval({ kind: 'result', winner: 'w' })).toBe('1-0')
  expect(formatEval({ kind: 'result', winner: null })).toBe('½-½')
})
```

`src/ui/useEvaluation.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useEvaluation, type EvalAnalyze, type EvalCache } from './useEvaluation'
import type { GameStatus } from '../game-core/types'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const LIVE: GameStatus = { kind: 'in-progress', inCheck: false }

describe('useEvaluation', () => {
  test('analyses the position once, converts to White POV, and caches by FEN', async () => {
    const analyze = vi.fn<EvalAnalyze>(async () => ({ best: 'e7e5', lines: [{ depth: 14, scoreCp: -30, pv: ['e7e5'] }] }))
    const cache: EvalCache = new Map()
    const { result, rerender } = renderHook((p: { fen: string }) =>
      useEvaluation({ analyze, fen: p.fen, status: LIVE, enabled: true, cache }), { initialProps: { fen: AFTER_E4 } })
    await waitFor(() => expect(result.current).toEqual({ kind: 'cp', cp: 30 })) // Black to move: -30 -> +30
    rerender({ fen: AFTER_E4 })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  test('a position change aborts the old request', async () => {
    const signals: AbortSignal[] = []
    const analyze = vi.fn<EvalAnalyze>((_req, signal) => {
      signals.push(signal)
      return new Promise(() => {})
    })
    const { rerender } = renderHook((p: { fen: string }) =>
      useEvaluation({ analyze, fen: p.fen, status: LIVE, enabled: true, cache: new Map() }), { initialProps: { fen: START } })
    act(() => rerender({ fen: AFTER_E4 }))
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  test('a finished position reports the result without asking the engine', () => {
    const analyze = vi.fn<EvalAnalyze>()
    const { result } = renderHook(() =>
      useEvaluation({ analyze, fen: START, status: { kind: 'checkmate', winner: 'b' }, enabled: true, cache: new Map() }))
    expect(result.current).toEqual({ kind: 'result', winner: 'b' })
    expect(analyze).not.toHaveBeenCalled()
  })

  test('disabled means no engine work', () => {
    const analyze = vi.fn<EvalAnalyze>()
    renderHook(() => useEvaluation({ analyze, fen: START, status: LIVE, enabled: false, cache: new Map() }))
    expect(analyze).not.toHaveBeenCalled()
  })
})
```

`src/ui/Board/EvalBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { EvalBar } from './EvalBar'

test('shows the label and fills White\'s share of the bar', () => {
  render(<EvalBar evaluation={{ kind: 'cp', cp: 100 }} orientation="white" />)
  expect(screen.getByTestId('eval-label')).toHaveTextContent('+1.0')
  expect(screen.getByTestId('eval-white-share').style.height).toBe('59.1%')
  expect(screen.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'white')
})

test('no evaluation yet: an even bar and a placeholder', () => {
  render(<EvalBar evaluation={null} orientation="black" />)
  expect(screen.getByTestId('eval-label')).toHaveTextContent('…')
  expect(screen.getByTestId('eval-white-share').style.height).toBe('50%')
  expect(screen.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'black')
})
```

Append to `src/storage/storage.test.ts`:

```ts
test('showEval defaults to true, including for settings saved before it existed', () => {
  expect(loadSettings().showEval).toBe(true)
  localStorage.setItem('chess-game:settings', JSON.stringify({ level: 2 }))
  expect(loadSettings().showEval).toBe(true)
  saveSettings({ ...DEFAULT_SETTINGS, showEval: false })
  expect(loadSettings().showEval).toBe(false)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/engine/evaluation.test.ts src/ui/useEvaluation.test.tsx src/ui/Board/EvalBar.test.tsx src/storage`
Expected: FAIL — modules not found; `showEval` undefined.

- [ ] **Step 3: Implement**

In `src/storage/storage.ts`: add `showEval: boolean` to `Settings` (after `themeId`), `showEval: true` to `DEFAULT_SETTINGS`, and in `loadSettings()`'s returned object:

```ts
    showEval: typeof raw['showEval'] === 'boolean' ? raw['showEval'] : DEFAULT_SETTINGS.showEval,
```

`src/engine/evaluation.ts`:

```ts
import type { Color } from '../game-core/types'
import { principalLine, type EngineInfo } from './uci'

/** An evaluation from WHITE's point of view. `mate > 0`: White mates in `mate`. */
export type WhiteEval =
  | { kind: 'cp'; cp: number }
  | { kind: 'mate'; mate: number }
  | { kind: 'result'; winner: Color | null }

/** UCI scores are relative to the side to move; flip them for Black. */
export function toWhitePov(info: EngineInfo, sideToMove: Color): WhiteEval | null {
  const sign = sideToMove === 'w' ? 1 : -1
  if (info.scoreMate !== undefined) return { kind: 'mate', mate: sign * info.scoreMate }
  if (info.scoreCp !== undefined) return { kind: 'cp', cp: sign * info.scoreCp }
  return null
}

export function evalFromLines(lines: readonly EngineInfo[], sideToMove: Color): WhiteEval | null {
  const line = principalLine(lines)
  return line ? toWhitePov(line, sideToMove) : null
}

/** Lichess win% (0..100) for White. The centipawn score is clamped to ±1000 first. */
export function winPercentFromCp(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1)
}

export function whiteWinPercent(e: WhiteEval): number {
  switch (e.kind) {
    case 'cp':
      return winPercentFromCp(e.cp)
    case 'mate':
      return e.mate > 0 ? 100 : 0
    case 'result':
      return e.winner === 'w' ? 100 : e.winner === 'b' ? 0 : 50
  }
}

export function formatEval(e: WhiteEval): string {
  switch (e.kind) {
    case 'cp': {
      const pawns = (e.cp / 100).toFixed(1)
      return e.cp > 0 ? `+${pawns}` : e.cp === 0 ? '0.0' : pawns
    }
    case 'mate':
      return e.mate > 0 ? `M${e.mate}` : `-M${Math.abs(e.mate)}`
    case 'result':
      return e.winner === 'w' ? '1-0' : e.winner === 'b' ? '0-1' : '½-½'
  }
}
```

(`(-250/100).toFixed(1)` is `'-2.5'`; values that round to zero, e.g. `-4` cp, print `'-0.0'` — acceptable and honest about the sign.)

`src/ui/useEvaluation.ts`:

```ts
import { useEffect, useReducer } from 'react'
import { evalFromLines, type WhiteEval } from '../engine/evaluation'
import type { AnalysisRequest, SearchOutcome } from '../engine/lane'
import type { GameStatus } from '../game-core/types'

export const EVAL_BUDGET = { depth: 14, moveTimeMs: 300, multiPv: 1 } as const

export type EvalAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>
export type EvalCache = Map<string, WhiteEval>

/**
 * The evaluation of the DISPLAYED position (so browsing history shows each
 * ply's eval). Terminal positions are scored without the engine. Results
 * are cached by FEN; the post-game review fills the same cache.
 */
export function useEvaluation({
  analyze,
  fen,
  status,
  enabled,
  cache,
}: {
  analyze: EvalAnalyze | null
  fen: string
  status: GameStatus
  enabled: boolean
  cache: EvalCache
}): WhiteEval | null {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const inProgress = status.kind === 'in-progress'

  useEffect(() => {
    if (!enabled || !analyze || !inProgress || cache.has(fen)) return
    const ctrl = new AbortController()
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w'
    analyze({ fen, ...EVAL_BUDGET }, ctrl.signal)
      .then((out) => {
        if (ctrl.signal.aborted) return
        const e = evalFromLines(out.lines, turn)
        if (e) {
          cache.set(fen, e)
          bump()
        }
      })
      .catch(() => {
        // Aborted, pre-empted forever, or the engine died: the bar just stays put.
      })
    return () => ctrl.abort()
  }, [analyze, fen, enabled, inProgress, cache])

  if (status.kind === 'checkmate') return { kind: 'result', winner: status.winner }
  if (status.kind === 'draw') return { kind: 'result', winner: null }
  return cache.get(fen) ?? null
}
```

`src/ui/Board/EvalBar.tsx`:

```tsx
import { formatEval, whiteWinPercent, type WhiteEval } from '../../engine/evaluation'

export function EvalBar({
  evaluation,
  orientation,
}: {
  evaluation: WhiteEval | null
  orientation: 'white' | 'black'
}) {
  const share = evaluation ? whiteWinPercent(evaluation) : 50
  const label = evaluation ? formatEval(evaluation) : '…'
  const whiteAhead = share >= 50
  // White's end of the bar is nearest White's side of the board.
  const atBottom = (orientation === 'white') === whiteAhead
  return (
    <div
      className={`eval-bar ${orientation}`}
      data-testid="eval-bar"
      data-orientation={orientation}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share)}
      aria-valuetext={label}
    >
      <div
        className="eval-bar-white"
        data-testid="eval-white-share"
        style={{ height: `${Math.round(share * 10) / 10}%` }}
      />
      <span
        className={`eval-label ${atBottom ? 'bottom' : 'top'} ${whiteAhead ? 'on-white' : 'on-black'}`}
        data-testid="eval-label"
      >
        {label}
      </span>
    </div>
  )
}
```

`src/ui/panels/SettingsPanel.tsx`:

```tsx
import type { Settings } from '../../storage/storage'

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}) {
  return (
    <fieldset className="settings" data-testid="settings">
      <legend>Settings</legend>
      <label>
        <input
          type="checkbox"
          data-testid="eval-toggle"
          checked={settings.showEval}
          onChange={(e) => onChange({ showEval: e.target.checked })}
        />
        Evaluation bar
      </label>
    </fieldset>
  )
}
```

Append to `src/ui/Board/board.css`:

```css
.board-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 6px;
  width: 100%;
}
.board-row .board-frame { flex: 1 1 auto; min-width: 0; }
.eval-bar {
  position: relative;
  flex: 0 0 22px;
  display: flex;
  flex-direction: column-reverse; /* White fills from the bottom */
  margin-bottom: 1.25rem; /* = --coord-gutter: stop level with the board, not the file labels */
  background: #403d39;
  border-radius: 3px;
  overflow: hidden;
}
.eval-bar.black { flex-direction: column; } /* flipped board: White fills from the top */
.eval-bar-white { background: #f4f4f4; transition: height 0.3s ease; }
.eval-label {
  position: absolute; left: 0; right: 0;
  text-align: center; font-size: 0.6rem; font-weight: 700; line-height: 1.4;
}
.eval-label.bottom { bottom: 2px; }
.eval-label.top { top: 2px; }
.eval-label.on-white { color: #403d39; }
.eval-label.on-black { color: #f4f4f4; }
```

Append to `src/ui/app.css`:

```css
.settings {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  border: 1px solid var(--color-panel-border);
  border-radius: 6px;
  padding: 6px 10px;
  width: 100%;
  max-width: 640px;
  box-sizing: border-box;
}
.settings label { display: flex; align-items: center; gap: 4px; font-size: 0.9em; }
```

- [ ] **Step 4: Wire App**

In `src/ui/App.tsx`:

1. React import becomes `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'`. Add `type Settings` to the storage import list. Add:

```tsx
import { EvalBar } from './Board/EvalBar'
import { SettingsPanel } from './panels/SettingsPanel'
import { useEvaluation, type EvalAnalyze } from './useEvaluation'
import type { WhiteEval } from '../engine/evaluation'
```

2. Replace `const [settings] = useState(() => loadSettings())` with:

```tsx
  const [settings, setSettings] = useState(() => loadSettings())
  // Every settings change is persisted immediately. (Phase 1 kept a frozen
  // copy and re-saved it on New game, which would silently undo any other
  // setting changed since the page loaded.)
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
```

3. In `handleNewGame`, replace the `saveSettings({ ...settings, level, timeControlId, orientation: … })` call with:

```tsx
    updateSettings({ level, timeControlId, ...(mode === 'one-player' ? { orientation: color } : {}) })
```

4. Directly after `const lastMove = game.moves[game.ply - 1]` add:

```tsx
  // Evaluations by FEN, shared by the eval bar and (Task 12) the review.
  const [evalCache] = useState(() => new Map<string, WhiteEval>())
  const analyzeForEval = useMemo<EvalAnalyze | null>(
    () => (engineAvailable ? (req, signal) => controller.analyze(req, signal) : null),
    [engineAvailable, controller],
  )
  const evaluation = useEvaluation({
    analyze: analyzeForEval,
    fen: position.fen(),
    status: displayedStatus,
    enabled: settings.showEval,
    cache: evalCache,
  })
```

5. Wrap `<Board … />` in the board column:

```tsx
          <div className="board-row">
            {settings.showEval ? <EvalBar evaluation={evaluation} orientation={orientation} /> : null}
            <Board
              {/* …existing props unchanged… */}
            />
          </div>
```

6. After `<GameIO game={game} onImport={handleImport} />` add `<SettingsPanel settings={settings} onChange={updateSettings} />`.

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Write the browser test**

`tests/e2e/eval-bar.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test.beforeEach(async ({ page }) => coachOffline(page))

test('the bar finds a mate, flips with the board, scores the result, and can be hidden', async ({ page }) => {
  await page.goto('/')
  // Back-rank mate in one: Rd8#.
  await page.getByTestId('import-text').fill('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')
  await page.getByTestId('import-submit').click()

  const label = page.getByTestId('eval-label')
  await expect(label).toHaveText('M1', { timeout: 30_000 })
  await expect(page.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'white')
  await page.getByTestId('flip').click()
  await expect(page.getByTestId('eval-bar')).toHaveAttribute('data-orientation', 'black')

  await page.locator('[data-square="d1"]').click()
  await page.locator('[data-square="d8"]').click()
  await expect(label).toHaveText('1-0')

  await page.getByTestId('eval-toggle').uncheck()
  await expect(page.getByTestId('eval-bar')).toHaveCount(0)
  // The mated position is finished, so there is no resume banner after a reload.
  await page.reload()
  await expect(page.getByTestId('eval-toggle')).not.toBeChecked()
  await expect(page.getByTestId('eval-bar')).toHaveCount(0)
})

test('engine moves are never starved by the bar (zero-player at full speed)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('zero-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()
  await page.getByTestId('speed').fill('0')
  await expect(page.getByTestId('ply-count')).toHaveText(/[6-9]|\d\d/, { timeout: 45_000 })

  // Once the engine is idle, analysis gets its turn.
  await page.getByTestId('pause').click()
  await expect(page.getByTestId('eval-label')).not.toHaveText('…', { timeout: 15_000 })
})

test('one-player: the engine still replies with the bar analysing', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()
  await expect(page.getByTestId('eval-label')).not.toHaveText('…', { timeout: 30_000 })
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
})
```

- [ ] **Step 6: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/eval-bar.spec.ts`
Expected: PASS. Then temporarily pass `orientation="white"` to `<EvalBar>` in App: the `data-orientation` assertion after the flip must FAIL. Restore. Then remove `sign *` from the mate branch of `toWhitePov`: the unit test "mate scores flip too" must FAIL. Restore.

- [ ] **Step 7: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(ui): evaluation bar fed by lane analysis; persisted settings state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Express coach server

**Complexity:** integration.

**Files:**
- Modify: `package.json`, `package-lock.json`, `vite.config.ts`
- Create: `tsconfig.node.json`, `.env.example`
- Create: `src/coach/protocol.ts`, `src/review/moveNumber.ts`, `src/review/moveNumber.test.ts`
- Create: `server/index.ts`, `server/app.ts`, `server/claude.ts`, `server/prompts.ts`, `server/validate.ts`
- Create: `server/app.test.ts`, `server/claude.test.ts`, `server/validate.test.ts`, `server/prompts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime.
- Produces:
  - `src/coach/protocol.ts`: `LIMITS`, `CoachErrorKind`, `FlaggedClass`, `HintRequest`, `FlaggedMove`, `ReviewRequest`, `CoachTextResponse`, `CoachErrorResponse`, `HealthResponse` (exact shapes below; shared by browser and server).
  - `src/review/moveNumber.ts`: `moveLabel(ply, san, firstMover): string`, `numberedMoves(sans, firstMover): string`.
  - HTTP: `GET /api/health` → `200 { ok: true, claude: boolean }`; `POST /api/hint` (`HintRequest`) and `POST /api/review` (`ReviewRequest`) → `200 { text }` | `400 { error: { kind: 'bad-request' } }` | `413` | `503 { error: { kind: 'no-key' | 'rate-limited' | 'timeout' | 'auth' | 'upstream', message } }`.
  - `createApp({ claude: Claude | null; staticDir?: string | null }): Express`; `createClaude({ apiKey?, client? }): Claude`; `interface Claude { complete(req: ClaudeRequest): Promise<ClaudeResult> }`.
  - npm scripts: `server`, `start`; `typecheck`/`build` also check `tsconfig.node.json`.

**Runner ruling — `tsx`, not `node --experimental-strip-types`:** Node's built-in type stripping requires every relative import to carry an explicit `.ts` extension, but the whole codebase (and anything the server shares from `src/`, like `protocol.ts` and `moveNumber.ts`, and the openings build script in Task 7 which must import `game-core`) uses extensionless imports under `moduleResolution: "bundler"`. `tsx` resolves those exactly as Vite does, so server, scripts and browser share modules without rewriting imports. It is a single dev dependency, used as a Node loader: `node --env-file-if-exists=.env --import tsx server/index.ts` (Node's own `.env` loading; no `dotenv`).

Budget/model ruling: `claude-sonnet-5` at `output_config.effort: 'low'` (hints and reviews are short explanations; low effort keeps latency well inside the 15 s timeout), `max_tokens` 1024 for hints and 2048 for reviews, `maxRetries: 0` so the 15 s timeout is the wall-clock bound.

- [ ] **Step 1: Install dependencies and add configuration**

```bash
npm install express @anthropic-ai/sdk
npm install -D tsx @types/express @types/node
```

In `package.json`: set `"engines": { "node": ">=22.9" }` and replace the scripts block with:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && tsc -p tsconfig.node.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.node.json",
    "e2e": "playwright test",
    "server": "node --env-file-if-exists=.env --import tsx server/index.ts",
    "start": "npm run build && npm run server",
    "postinstall": "node scripts/copy-engine.mjs"
  },
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["server", "scripts"]
}
```

(Files the server imports from `src/` are pulled in by the import graph and must stay DOM-free.)

`vite.config.ts` becomes:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The coach server (npm run server). Dev and preview both proxy /api to it,
// so the browser only ever talks to its own origin and never sees the key.
const COACH = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': COACH } },
  preview: { proxy: { '/api': COACH } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
```

`.env.example`:

```
# Copy to .env (gitignored) and fill in. Read only by the coach server.
ANTHROPIC_API_KEY=
# Optional: port for the coach server (Vite proxies /api here).
# PORT=8787
```

- [ ] **Step 2: Write the shared protocol and move numbering (test first)**

`src/review/moveNumber.test.ts`:

```ts
import { expect, test } from 'vitest'
import { moveLabel, numberedMoves } from './moveNumber'

test('moveLabel numbers plies from the side that moved first', () => {
  expect(moveLabel(1, 'e4', 'w')).toBe('1. e4')
  expect(moveLabel(2, 'e5', 'w')).toBe('1... e5')
  expect(moveLabel(6, 'Nf6', 'w')).toBe('3... Nf6')
  expect(moveLabel(1, 'e5', 'b')).toBe('1... e5')
  expect(moveLabel(2, 'Nf3', 'b')).toBe('2. Nf3')
})

test('numberedMoves writes a PGN-style move text', () => {
  expect(numberedMoves(['e4', 'e5', 'Nf3'], 'w')).toBe('1. e4 e5 2. Nf3')
  expect(numberedMoves(['e5', 'Nf3'], 'b')).toBe('1... e5 2. Nf3')
  expect(numberedMoves([], 'w')).toBe('')
})
```

`src/review/moveNumber.ts`:

```ts
type Side = 'w' | 'b'

function numberOf(ply: number, firstMover: Side): { number: number; color: Side } {
  // Half-move index counted from White's move 1: a Black-first game starts at 1.
  const half = ply - 1 + (firstMover === 'w' ? 0 : 1)
  return { number: Math.floor(half / 2) + 1, color: half % 2 === 0 ? 'w' : 'b' }
}

/** "3... Nf6" / "4. Qxf7#" for the move at 1-based `ply`. */
export function moveLabel(ply: number, san: string, firstMover: Side): string {
  const { number, color } = numberOf(ply, firstMover)
  return color === 'w' ? `${number}. ${san}` : `${number}... ${san}`
}

export function numberedMoves(sans: readonly string[], firstMover: Side): string {
  const out: string[] = []
  sans.forEach((san, i) => {
    const ply = i + 1
    const { number, color } = numberOf(ply, firstMover)
    if (color === 'w') out.push(`${number}. ${san}`)
    else out.push(ply === 1 ? `${number}... ${san}` : san)
  })
  return out.join(' ')
}
```

`src/coach/protocol.ts`:

```ts
/**
 * The browser <-> coach-server contract. Pure types and limits: imported by
 * both sides, so it must never import DOM or Node APIs.
 */
export const LIMITS = {
  maxBodyBytes: 32 * 1024,
  maxMoves: 600,
  maxLine: 12,
  maxFlagged: 100,
  maxOpeningName: 120,
} as const

export type CoachErrorKind = 'no-key' | 'rate-limited' | 'timeout' | 'auth' | 'upstream' | 'bad-request'

export type FlaggedClass = 'inaccuracy' | 'mistake' | 'blunder'

export interface HintRequest {
  fen: string
  bestMoveSan: string
  /** The engine's main line in SAN, starting with bestMoveSan. At most LIMITS.maxLine. */
  line: string[]
  /** From the side to move: "+0.8", "-1.2", "M3", "-M2". */
  evaluation: string
}

export interface FlaggedMove {
  ply: number
  san: string
  classification: FlaggedClass
  bestSan: string | null
  /** Win-percentage points lost by the move, 0..100. */
  lossPct: number
}

export interface ReviewRequest {
  moves: string[]
  firstMover: 'w' | 'b'
  result: '1-0' | '0-1' | '1/2-1/2' | '*'
  opening: string | null
  accuracy: { w: number | null; b: number | null }
  flagged: FlaggedMove[]
  humanSide: 'w' | 'b' | null
}

export interface CoachTextResponse {
  text: string
}

export interface CoachErrorResponse {
  error: { kind: CoachErrorKind; message: string }
}

export interface HealthResponse {
  ok: true
  claude: boolean
}
```

Run: `npx vitest run src/review/moveNumber.test.ts` — FAIL before the file exists, PASS after.

- [ ] **Step 3: Write the failing server tests**

`server/validate.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { parseHintRequest, parseReviewRequest } from './validate'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const HINT = { fen: START, bestMoveSan: 'e4', line: ['e4', 'e5', 'Nf3'], evaluation: '+0.3' }
const REVIEW = {
  moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
  firstMover: 'w',
  result: '1-0',
  opening: "Bishop's Opening",
  accuracy: { w: 92.5, b: 40.1 },
  flagged: [{ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 48.2 }],
  humanSide: null,
}

describe('parseHintRequest', () => {
  test('accepts a well-formed request', () => {
    expect(parseHintRequest(HINT)).toEqual({ ok: true, value: HINT })
  })
  test.each([
    ['a non-object', 'x'],
    ['a bad FEN', { ...HINT, fen: 'not a fen' }],
    ['an over-long FEN', { ...HINT, fen: START + ' '.repeat(200) }],
    ['a non-SAN best move', { ...HINT, bestMoveSan: 'ignore previous instructions' }],
    ['a long line', { ...HINT, line: Array(13).fill('e4') }],
    ['a malformed evaluation', { ...HINT, evaluation: 'winning!' }],
  ])('rejects %s', (_name, body) => {
    expect(parseHintRequest(body).ok).toBe(false)
  })
  test('accepts castling, promotion, checks and mates', () => {
    const line = ['O-O', 'O-O-O+', 'exd8=Q+', 'Nbd7', 'R1e2', 'Qh4xe1#']
    expect(parseHintRequest({ ...HINT, line, evaluation: '-M2' }).ok).toBe(true)
  })
})

describe('parseReviewRequest', () => {
  test('accepts a well-formed request', () => {
    expect(parseReviewRequest(REVIEW).ok).toBe(true)
  })
  test.each([
    ['too many moves', { ...REVIEW, moves: Array(601).fill('e4') }],
    ['no moves', { ...REVIEW, moves: [] }],
    ['a bad result', { ...REVIEW, result: 'white won' }],
    ['an opening name with markup', { ...REVIEW, opening: '<script>alert(1)</script>' }],
    ['accuracy out of range', { ...REVIEW, accuracy: { w: 120, b: 3 } }],
    ['a flagged ply beyond the game', { ...REVIEW, flagged: [{ ...REVIEW.flagged[0], ply: 99 }] }],
    ['a bad classification', { ...REVIEW, flagged: [{ ...REVIEW.flagged[0], classification: 'brilliant' }] }],
    ['a bad side', { ...REVIEW, humanSide: 'x' }],
  ])('rejects %s', (_name, body) => {
    expect(parseReviewRequest(body).ok).toBe(false)
  })
})
```

`server/prompts.test.ts`:

```ts
// @vitest-environment node
import { expect, test } from 'vitest'
import { hintPrompt, reviewPrompt } from './prompts'

test('the hint prompt carries the position, the move and the line, and forbids other moves', () => {
  const p = hintPrompt({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    bestMoveSan: 'e4',
    line: ['e4', 'e5', 'Nf3'],
    evaluation: '+0.3',
  })
  expect(p.user).toContain('rnbqkbnr/pppppppp')
  expect(p.user).toContain("Engine's best move: e4")
  expect(p.user).toContain('e4 e5 Nf3')
  expect(p.system).toMatch(/never recommend a different move/i)
  expect(p.maxTokens).toBe(1024)
})

test('the review prompt numbers moves and lists flagged moves with the engine alternative', () => {
  const p = reviewPrompt({
    moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    firstMover: 'w',
    result: '1-0',
    opening: "Bishop's Opening",
    accuracy: { w: 92.5, b: 40.1 },
    flagged: [{ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 48.2 }],
    humanSide: 'b',
  })
  expect(p.user).toContain('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#')
  expect(p.user).toContain('3... Nf6: blunder')
  expect(p.user).toContain('the engine preferred g6')
  expect(p.user).toContain('The human played Black')
  expect(p.user).toContain('White 92.5%, Black 40.1%')
})
```

`server/claude.test.ts`:

```ts
// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, test } from 'vitest'
import { COACH_MODEL, createClaude, type MessagesClient } from './claude'

function fakeClient(impl: () => Promise<unknown>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        calls.push(params)
        return (await impl()) as Anthropic.Message
      },
    },
  }
  return { calls, client }
}

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: COACH_MODEL,
  content: [{ type: 'text', text: '  Develops a piece.  ', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  ...over,
})

const REQ = { system: 'sys', user: 'usr', maxTokens: 1024 }

describe('createClaude', () => {
  test('sends the model, prompt and limits, and returns the trimmed text', async () => {
    const f = fakeClient(async () => message())
    const r = await createClaude({ client: f.client }).complete(REQ)
    expect(r).toEqual({ ok: true, text: 'Develops a piece.' })
    expect(f.calls[0]).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
    })
  })

  test('a refusal or an empty answer is an upstream failure', async () => {
    expect(await createClaude({ client: fakeClient(async () => message({ stop_reason: 'refusal' })).client }).complete(REQ))
      .toMatchObject({ ok: false, kind: 'upstream' })
    expect(await createClaude({ client: fakeClient(async () => message({ content: [] })).client }).complete(REQ))
      .toMatchObject({ ok: false, kind: 'upstream' })
  })

  test.each([
    ['rate-limited', () => new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers())],
    ['auth', () => new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers())],
    ['timeout', () => new Anthropic.APIConnectionTimeoutError()],
    ['upstream', () => new Error('socket hang up')],
  ])('classifies %s', async (kind, makeError) => {
    const r = await createClaude({ client: fakeClient(async () => { throw makeError() }).client }).complete(REQ)
    expect(r).toMatchObject({ ok: false, kind })
  })

  test('error messages are fixed text: nothing from the SDK error (or the key) leaks through', async () => {
    const r = await createClaude({
      client: fakeClient(async () => { throw new Error('bad key sk-ant-SECRET123') }).client,
    }).complete(REQ)
    expect(JSON.stringify(r)).not.toContain('SECRET123')
  })
})
```

(If the installed SDK's error constructors differ from `(status, error, message, headers)`, match its `.d.ts`; the point of the test is `instanceof` classification.)

`server/app.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createApp } from './app'
import type { Claude, ClaudeRequest, ClaudeResult } from './claude'

let server: Server | null = null

async function start(claude: Claude | null, staticDir: string | null = null): Promise<string> {
  const app = createApp({ claude, staticDir })
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

function fakeClaude(result: ClaudeResult) {
  const calls: ClaudeRequest[] = []
  return { calls, claude: { complete: async (r: ClaudeRequest) => (calls.push(r), result) } }
}

const post = (base: string, path: string, body: unknown, raw?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })

const HINT = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  bestMoveSan: 'e4',
  line: ['e4', 'e5'],
  evaluation: '+0.3',
}
const REVIEW = {
  moves: ['e4', 'e5'],
  firstMover: 'w',
  result: '*',
  opening: null,
  accuracy: { w: 100, b: 100 },
  flagged: [],
  humanSide: 'w',
}

describe('coach server', () => {
  test('health reports whether Claude is configured', async () => {
    let base = await start(null)
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, claude: false })
    await new Promise<void>((r) => server!.close(() => r()))
    base = await start(fakeClaude({ ok: true, text: 'x' }).claude)
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, claude: true })
  })

  test('a valid hint is relayed to Claude and its text returned', async () => {
    const f = fakeClaude({ ok: true, text: 'Take the centre.' })
    const base = await start(f.claude)
    const res = await post(base, '/api/hint', HINT)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Take the centre.' })
    expect(f.calls[0]?.user).toContain(HINT.fen)
  })

  test('a valid review is relayed too', async () => {
    const f = fakeClaude({ ok: true, text: 'Good game.' })
    const base = await start(f.claude)
    const res = await post(base, '/api/review', REVIEW)
    expect(await res.json()).toEqual({ text: 'Good game.' })
  })

  test('invalid input is rejected before Claude is called', async () => {
    const f = fakeClaude({ ok: true, text: 'x' })
    const base = await start(f.claude)
    const res = await post(base, '/api/hint', { ...HINT, fen: 'nope' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.kind).toBe('bad-request')
    expect(f.calls).toHaveLength(0)
  })

  test('malformed JSON is a 400 and an oversized body a 413', async () => {
    const base = await start(fakeClaude({ ok: true, text: 'x' }).claude)
    expect((await post(base, '/api/hint', null, '{"fen":')).status).toBe(400)
    const huge = JSON.stringify({ ...HINT, padding: 'x'.repeat(40 * 1024) })
    expect((await post(base, '/api/hint', null, huge)).status).toBe(413)
  })

  test('no key: 503 no-key', async () => {
    const base = await start(null)
    const res = await post(base, '/api/hint', HINT)
    expect(res.status).toBe(503)
    expect((await res.json()).error.kind).toBe('no-key')
  })

  test('a Claude failure is a 503 carrying its kind', async () => {
    const base = await start(fakeClaude({ ok: false, kind: 'rate-limited', message: 'Claude is rate-limiting requests.' }).claude)
    const res = await post(base, '/api/review', REVIEW)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } })
  })

  test('unknown API routes are JSON 404s; the built app is served when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chess-dist-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Chess</title>')
    const base = await start(null, dir)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
    const page = await fetch(`${base}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>Chess</title>')
  })
})
```

Run: `npx vitest run server`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the server**

`server/validate.ts`:

```ts
import {
  LIMITS,
  type FlaggedClass,
  type FlaggedMove,
  type HintRequest,
  type ReviewRequest,
} from '../src/coach/protocol'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const FEN_RE =
  /^[1-8pnbrqkPNBRQK]+(?:\/[1-8pnbrqkPNBRQK]+){7} [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36]) \d{1,3} \d{1,4}$/
const SAN_RE =
  /^(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?$/
const EVAL_RE = /^(?:[+-]?\d{1,3}\.\d|-?M\d{1,3})$/
/** Letters (any script), digits, and the punctuation lichess opening names use. */
const NAME_RE = /^[\p{L}\p{N} .,:;'’()\-/!?+]+$/u
const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'] as const
const CLASSES: readonly FlaggedClass[] = ['inaccuracy', 'mistake', 'blunder']

const fail = (error: string) => ({ ok: false as const, error })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSan(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 10 && SAN_RE.test(v)
}

function isSide(v: unknown): v is 'w' | 'b' {
  return v === 'w' || v === 'b'
}

function isPercentOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)
}

export function parseHintRequest(body: unknown): Parsed<HintRequest> {
  if (!isRecord(body)) return fail('body must be a JSON object')
  const { fen, bestMoveSan, line, evaluation } = body
  if (typeof fen !== 'string' || fen.length > 100 || !FEN_RE.test(fen)) return fail('fen is not a valid FEN')
  if (!isSan(bestMoveSan)) return fail('bestMoveSan must be a SAN move')
  if (!Array.isArray(line) || line.length > LIMITS.maxLine || !line.every(isSan)) {
    return fail(`line must be at most ${LIMITS.maxLine} SAN moves`)
  }
  if (typeof evaluation !== 'string' || !EVAL_RE.test(evaluation)) return fail('evaluation is malformed')
  return { ok: true, value: { fen, bestMoveSan, line, evaluation } }
}

function parseFlagged(v: unknown, moveCount: number): FlaggedMove | null {
  if (!isRecord(v)) return null
  const { ply, san, classification, bestSan, lossPct } = v
  if (typeof ply !== 'number' || !Number.isInteger(ply) || ply < 1 || ply > moveCount) return null
  if (!isSan(san)) return null
  if (!CLASSES.includes(classification as FlaggedClass)) return null
  if (bestSan !== null && !isSan(bestSan)) return null
  if (typeof lossPct !== 'number' || !Number.isFinite(lossPct) || lossPct < 0 || lossPct > 100) return null
  return { ply, san, classification: classification as FlaggedClass, bestSan, lossPct }
}

export function parseReviewRequest(body: unknown): Parsed<ReviewRequest> {
  if (!isRecord(body)) return fail('body must be a JSON object')
  const { moves, firstMover, result, opening, accuracy, flagged, humanSide } = body
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > LIMITS.maxMoves || !moves.every(isSan)) {
    return fail(`moves must be 1..${LIMITS.maxMoves} SAN moves`)
  }
  if (!isSide(firstMover)) return fail('firstMover must be "w" or "b"')
  if (!RESULTS.includes(result as (typeof RESULTS)[number])) return fail('result is not a PGN result')
  if (
    opening !== null &&
    (typeof opening !== 'string' || opening.length > LIMITS.maxOpeningName || !NAME_RE.test(opening))
  ) {
    return fail('opening is malformed')
  }
  if (!isRecord(accuracy) || !isPercentOrNull(accuracy['w']) || !isPercentOrNull(accuracy['b'])) {
    return fail('accuracy must be { w, b } percentages or null')
  }
  if (!Array.isArray(flagged) || flagged.length > LIMITS.maxFlagged) return fail('too many flagged moves')
  const parsedFlagged: FlaggedMove[] = []
  for (const f of flagged) {
    const p = parseFlagged(f, moves.length)
    if (!p) return fail('a flagged move is malformed')
    parsedFlagged.push(p)
  }
  if (humanSide !== null && !isSide(humanSide)) return fail('humanSide must be "w", "b" or null')
  return {
    ok: true,
    value: {
      moves,
      firstMover,
      result: result as ReviewRequest['result'],
      opening,
      accuracy: { w: accuracy['w'] as number | null, b: accuracy['b'] as number | null },
      flagged: parsedFlagged,
      humanSide,
    },
  }
}
```

`server/claude.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { CoachErrorKind } from '../src/coach/protocol'

export const COACH_MODEL = 'claude-sonnet-5'
export const CLAUDE_TIMEOUT_MS = 15_000

export interface ClaudeRequest {
  system: string
  user: string
  maxTokens: number
}

export type FailureKind = Exclude<CoachErrorKind, 'bad-request' | 'no-key'>

export type ClaudeResult = { ok: true; text: string } | { ok: false; kind: FailureKind; message: string }

export interface Claude {
  complete(req: ClaudeRequest): Promise<ClaudeResult>
}

/** The one SDK method we use; injectable so tests never touch the network. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
  }
}

/** Fixed, key-free texts: SDK error messages are never forwarded. */
const MESSAGES: Record<FailureKind, string> = {
  'rate-limited': 'Claude is rate-limiting requests.',
  timeout: 'Claude did not answer within 15 seconds.',
  auth: 'The server’s Anthropic API key was rejected.',
  upstream: 'Claude could not produce an answer.',
}

export function classifyError(err: unknown): FailureKind {
  // Timeout first: it is a subclass of the connection error family.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (err instanceof Anthropic.RateLimitError) return 'rate-limited'
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'auth'
  return 'upstream'
}

const failure = (kind: FailureKind): ClaudeResult => ({ ok: false, kind, message: MESSAGES[kind] })

export function createClaude(opts: { apiKey?: string; client?: MessagesClient }): Claude {
  const client: MessagesClient =
    opts.client ??
    new Anthropic({
      apiKey: opts.apiKey,
      // TypeScript SDK timeouts are in MILLISECONDS. No retries: 15s is the wall-clock bound.
      timeout: CLAUDE_TIMEOUT_MS,
      maxRetries: 0,
    })

  return {
    async complete(req) {
      try {
        const response = await client.messages.create({
          model: COACH_MODEL,
          max_tokens: req.maxTokens,
          output_config: { effort: 'low' },
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        })
        if (response.stop_reason === 'refusal') return failure('upstream')
        const text = response.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
          .trim()
        return text ? { ok: true, text } : failure('upstream')
      } catch (err) {
        return failure(classifyError(err))
      }
    },
  }
}
```

(If `tsc -p tsconfig.node.json` rejects `output_config`, the installed SDK predates it: upgrade `@anthropic-ai/sdk` to the latest release rather than deleting the line.)

`server/prompts.ts`:

```ts
import type { HintRequest, ReviewRequest } from '../src/coach/protocol'
import { moveLabel, numberedMoves } from '../src/review/moveNumber'
import type { ClaudeRequest } from './claude'

const HINT_SYSTEM = [
  'You are a friendly chess coach explaining a move to an improving club player.',
  'A chess engine has already chosen the best move; your only job is to explain why it is good.',
  'Never recommend a different move, never mention moves that are not in the given line,',
  'and do not restate the FEN. Answer in at most three short sentences of plain text, no markdown.',
].join(' ')

const REVIEW_SYSTEM = [
  'You are a chess coach writing a short, encouraging post-game review.',
  'Use only the data given: refer to moves exactly as numbered, and never invent moves or evaluations.',
  'Mention the opening, the turning point, and one concrete lesson. At most 150 words, plain text, no headings.',
].join(' ')

const sideName = (c: 'w' | 'b') => (c === 'w' ? 'White' : 'Black')

export function hintPrompt(r: HintRequest): ClaudeRequest {
  const side = sideName(r.fen.split(' ')[1] === 'b' ? 'b' : 'w')
  return {
    system: HINT_SYSTEM,
    maxTokens: 1024,
    user: [
      `Position (FEN): ${r.fen}`,
      `Side to move: ${side}`,
      `Engine's best move: ${r.bestMoveSan}`,
      `Engine's main line: ${r.line.length > 0 ? r.line.join(' ') : r.bestMoveSan}`,
      `Evaluation for ${side}: ${r.evaluation}`,
      '',
      `Explain the idea behind ${r.bestMoveSan}.`,
    ].join('\n'),
  }
}

export function reviewPrompt(r: ReviewRequest): ClaudeRequest {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${x.toFixed(1)}%`)
  const flagged =
    r.flagged.length === 0
      ? 'None.'
      : r.flagged
          .map(
            (f) =>
              `- ${moveLabel(f.ply, f.san, r.firstMover)}: ${f.classification} ` +
              `(lost ${f.lossPct.toFixed(1)} points of winning chance)` +
              (f.bestSan ? `; the engine preferred ${f.bestSan}` : ''),
          )
          .join('\n')
  return {
    system: REVIEW_SYSTEM,
    maxTokens: 2048,
    user: [
      `Result: ${r.result}`,
      `Opening: ${r.opening ?? 'unnamed'}`,
      r.humanSide
        ? `The human played ${sideName(r.humanSide)}; address them as "you".`
        : 'Refer to the players as White and Black.',
      `Accuracy: White ${pct(r.accuracy.w)}, Black ${pct(r.accuracy.b)}`,
      `Moves: ${numberedMoves(r.moves, r.firstMover)}`,
      'Flagged moves:',
      flagged,
    ].join('\n'),
  }
}
```

`server/app.ts`:

```ts
import express, { type NextFunction, type Request, type Response } from 'express'
import { LIMITS, type CoachErrorResponse, type HealthResponse } from '../src/coach/protocol'
import type { Claude, ClaudeRequest } from './claude'
import { hintPrompt, reviewPrompt } from './prompts'
import { parseHintRequest, parseReviewRequest, type Parsed } from './validate'

function sendError(res: Response, status: number, error: CoachErrorResponse['error']): void {
  res.status(status).json({ error } satisfies CoachErrorResponse)
}

export function createApp(deps: { claude: Claude | null; staticDir?: string | null }) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', express.json({ limit: LIMITS.maxBodyBytes }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, claude: deps.claude !== null } satisfies HealthResponse)
  })

  const relay =
    <T>(parse: (body: unknown) => Parsed<T>, prompt: (value: T) => ClaudeRequest) =>
    async (req: Request, res: Response): Promise<void> => {
      const parsed = parse(req.body)
      if (!parsed.ok) {
        sendError(res, 400, { kind: 'bad-request', message: parsed.error })
        return
      }
      if (!deps.claude) {
        sendError(res, 503, { kind: 'no-key', message: 'The coach server has no ANTHROPIC_API_KEY.' })
        return
      }
      const result = await deps.claude.complete(prompt(parsed.value))
      if (!result.ok) {
        sendError(res, 503, { kind: result.kind, message: result.message })
        return
      }
      res.json({ text: result.text })
    }

  app.post('/api/hint', relay(parseHintRequest, hintPrompt))
  app.post('/api/review', relay(parseReviewRequest, reviewPrompt))

  app.use('/api', (_req, res) => {
    sendError(res, 404, { kind: 'bad-request', message: 'No such endpoint.' })
  })

  // Body-parser failures (malformed JSON, oversized bodies) and anything unexpected.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = (err as { type?: string }).type
    if (type === 'entity.too.large') {
      sendError(res, 413, { kind: 'bad-request', message: 'Request body too large.' })
      return
    }
    if (type === 'entity.parse.failed') {
      sendError(res, 400, { kind: 'bad-request', message: 'Malformed JSON.' })
      return
    }
    sendError(res, 500, { kind: 'upstream', message: 'Internal error.' })
  })

  if (deps.staticDir) app.use(express.static(deps.staticDir))
  return app
}
```

Note the ordering: static files are registered after the error handler, which is fine — the error handler only runs on errors, and `/api` never reaches the static handler because of the JSON 404.

`server/index.ts`:

```ts
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { createClaude } from './claude'

const port = Number(process.env['PORT'] ?? 8787)
const host = process.env['HOST'] ?? '127.0.0.1'
const apiKey = process.env['ANTHROPIC_API_KEY']?.trim() || null
const distDir = fileURLToPath(new URL('../dist', import.meta.url))

const app = createApp({
  claude: apiKey ? createClaude({ apiKey }) : null,
  // `npm start` builds first; in dev, Vite serves the app and proxies /api here.
  staticDir: existsSync(distDir) ? distDir : null,
})

app.listen(port, host, () => {
  // Never log the key itself.
  console.log(
    `coach server on http://${host}:${port} — Claude ${apiKey ? 'enabled' : 'disabled (no ANTHROPIC_API_KEY)'}`,
  )
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server src/review && npm run typecheck && npm test`
Expected: PASS. Prove the validators are load-bearing: comment out the `parse(req.body)` check in `relay` (pass `req.body` straight through) — "invalid input is rejected before Claude is called" must FAIL. Restore.

- [ ] **Step 6: Browser/proxy check**

With no `.env`:

```bash
npm run server &          # prints "Claude disabled (no ANTHROPIC_API_KEY)"
npm run dev &             # Vite on 5173
sleep 3
curl -s http://localhost:5173/api/health   # {"ok":true,"claude":false}  (through the proxy)
curl -s -X POST -H 'content-type: application/json' -d '{"fen":"x"}' http://localhost:5173/api/hint   # 400 bad-request
kill %1 %2
```

Expected: exactly those responses. Then `git status` must NOT list `.env`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.node.json .env.example server src/coach/protocol.ts src/review
git commit -m "feat(server): Express coach relay for /api/hint and /api/review via Claude

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Coach client, offline badge, once-only notice

**Complexity:** integration.

**Files:**
- Create: `src/coach/client.ts`, `src/coach/client.test.ts`, `src/ui/useCoach.ts`
- Modify: `src/coach/hints.ts`, `src/coach/hints.test.ts` (`moverScore`, `sanLine`, `hintRequestFrom`)
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Modify: `tests/e2e/helpers.ts`; Create: `tests/e2e/coach.spec.ts`

**Interfaces:**
- Consumes: `protocol.ts` types (T5), `HintSuggestion`, `principalLine`, `HintReasoner` (T2).
- Produces:
  - `type CoachStatus = 'unknown' | 'online' | 'offline' | 'no-key'`; `interface CoachSnapshot { status: CoachStatus; notice: string | null }`
  - `class CoachClient { constructor(opts?: { fetch?: typeof fetch; timeoutMs?: number }); subscribe(cb): () => void; getSnapshot(): CoachSnapshot; checkHealth(): Promise<void>; hint(req: HintRequest, signal?): Promise<string | null>; review(req: ReviewRequest, signal?): Promise<string | null>; dismissNotice(): void }` — `null` always means "use your templated fallback".
  - `useCoach(client): CoachSnapshot`
  - `moverScore(info): string | null`, `sanLine(position, pv, max): string[]`, `hintRequestFrom(s, position): HintRequest | null`
  - DOM: `data-testid="coach-badge"` (text `coaching offline`), `data-testid="coach-notice"` + `coach-notice-dismiss`.

Status rules: network failure, a non-JSON error page (the Vite proxy's 500 when the server is down) or `/api/health` failing → `offline` (badge). Health `claude: false` or a `no-key` error → `no-key` (badge; hint/review calls are skipped). A Claude error kind (`rate-limited`, `timeout`, `auth`, `upstream`) → server is up (`online`, no badge) and the notice is set the FIRST time only in this session. `bad-request` → our bug: logged with `console.warn`, fallback, no notice. Any success → `online`.

- [ ] **Step 1: Write the failing tests**

`src/coach/client.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { CoachClient } from './client'
import type { HintRequest } from './protocol'

const HINT: HintRequest = { fen: 'x', bestMoveSan: 'e4', line: ['e4'], evaluation: '+0.3' }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('CoachClient', () => {
  test('health: online, no-key, offline', async () => {
    const online = new CoachClient({ fetch: async () => json(200, { ok: true, claude: true }) })
    await online.checkHealth()
    expect(online.getSnapshot().status).toBe('online')

    const noKey = new CoachClient({ fetch: async () => json(200, { ok: true, claude: false }) })
    await noKey.checkHealth()
    expect(noKey.getSnapshot().status).toBe('no-key')

    const down = new CoachClient({ fetch: async () => { throw new TypeError('fetch failed') } })
    await down.checkHealth()
    expect(down.getSnapshot().status).toBe('offline')
  })

  test('a hint returns Claude text and marks the coach online', async () => {
    const fetch = vi.fn(async () => json(200, { text: ' Take the centre. ' }))
    const c = new CoachClient({ fetch })
    expect(await c.hint(HINT)).toBe('Take the centre.')
    expect(c.getSnapshot()).toEqual({ status: 'online', notice: null })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/hint')
    expect(JSON.parse(String(init.body))).toEqual(HINT)
  })

  test('network failure or a proxy error page: null, offline, no notice', async () => {
    const down = new CoachClient({ fetch: async () => { throw new TypeError('fetch failed') } })
    expect(await down.hint(HINT)).toBeNull()
    expect(down.getSnapshot()).toEqual({ status: 'offline', notice: null })

    const proxy = new CoachClient({ fetch: async () => new Response('Internal Server Error', { status: 500 }) })
    expect(await proxy.hint(HINT)).toBeNull()
    expect(proxy.getSnapshot().status).toBe('offline')
  })

  test('a Claude error is surfaced once per session, not per request', async () => {
    const c = new CoachClient({
      fetch: async () => json(503, { error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } }),
    })
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().status).toBe('online')
    expect(c.getSnapshot().notice).toMatch(/rate-limiting/)
    c.dismissNotice()
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().notice).toBeNull()
  })

  test('no-key: calls are skipped entirely', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, claude: false }))
    const c = new CoachClient({ fetch })
    await c.checkHealth()
    expect(await c.hint(HINT)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1) // only the health check
  })

  test("a caller's abort returns null without changing status", async () => {
    const c = new CoachClient({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
    })
    const ctrl = new AbortController()
    const p = c.hint(HINT, ctrl.signal)
    ctrl.abort()
    expect(await p).toBeNull()
    expect(c.getSnapshot().status).toBe('unknown')
  })

  test('subscribers are told about changes', async () => {
    const c = new CoachClient({ fetch: async () => json(200, { ok: true, claude: true }) })
    const cb = vi.fn()
    const off = c.subscribe(cb)
    await c.checkHealth()
    expect(cb).toHaveBeenCalled()
    off()
  })
})
```

Append to `src/coach/hints.test.ts` (extend the import with `hintRequestFrom, moverScore, sanLine`):

```ts
describe('hint request', () => {
  test('moverScore formats cp and mate from the side to move', () => {
    expect(moverScore({ scoreCp: 83, pv: [] })).toBe('+0.8')
    expect(moverScore({ scoreCp: -120, pv: [] })).toBe('-1.2')
    expect(moverScore({ scoreMate: 3, pv: [] })).toBe('M3')
    expect(moverScore({ scoreMate: -2, pv: [] })).toBe('-M2')
    expect(moverScore({ pv: [] })).toBeNull()
  })

  test('sanLine converts the PV and stops at the first unplayable move', () => {
    expect(sanLine(new Position(), ['e2e4', 'e7e5', 'g1f3'], 12)).toEqual(['e4', 'e5', 'Nf3'])
    expect(sanLine(new Position(), ['e2e4', 'a1a8', 'g1f3'], 12)).toEqual(['e4'])
    expect(sanLine(new Position(), ['e2e4', 'e7e5'], 1)).toEqual(['e4'])
  })

  test('hintRequestFrom builds a server-valid request', () => {
    const pos = new Position()
    const s = suggestionFrom([{ depth: 12, scoreCp: 25, pv: ['e2e4', 'e7e5'] }], pos)
    if (!s) throw new Error('no suggestion')
    expect(hintRequestFrom(s, pos)).toEqual({
      fen: pos.fen(),
      bestMoveSan: 'e4',
      line: ['e4', 'e5'],
      evaluation: '+0.3',
    })
  })
})
```

Run: `npx vitest run src/coach`
Expected: FAIL — `./client` not found; `moverScore` etc. not exported.

- [ ] **Step 2: Implement**

Append to `src/coach/hints.ts` (add `import { LIMITS, type HintRequest } from './protocol'`, and add `type EngineInfo` is already imported):

```ts
/** A UCI score (side-to-move relative) in the protocol's text form. */
export function moverScore(info: EngineInfo): string | null {
  if (info.scoreMate !== undefined) {
    return info.scoreMate >= 0 ? `M${info.scoreMate}` : `-M${Math.abs(info.scoreMate)}`
  }
  if (info.scoreCp !== undefined) {
    return `${info.scoreCp >= 0 ? '+' : '-'}${(Math.abs(info.scoreCp) / 100).toFixed(1)}`
  }
  return null
}

/** The principal variation in SAN, stopping at the first move that does not play. */
export function sanLine(position: Position, pv: readonly string[], max: number): string[] {
  const probe = position.clone()
  const out: string[] = []
  for (const uci of pv.slice(0, max)) {
    const intent = uciToIntent(uci)
    if (!intent) break
    const r = probe.tryMove(intent)
    if (!r.ok) break
    out.push(r.move.san)
  }
  return out
}

export function hintRequestFrom(s: HintSuggestion, position: Position): HintRequest | null {
  const line = principalLine(s.lines)
  if (!line) return null
  const evaluation = moverScore(line)
  if (!evaluation) return null
  return {
    fen: position.fen(),
    bestMoveSan: s.san,
    line: sanLine(position, line.pv, LIMITS.maxLine),
    evaluation,
  }
}
```

`src/coach/client.ts`:

```ts
import type { CoachErrorKind, HintRequest, ReviewRequest } from './protocol'

export type CoachStatus = 'unknown' | 'online' | 'offline' | 'no-key'

export interface CoachSnapshot {
  status: CoachStatus
  /** A one-time message about a Claude failure; null once dismissed. */
  notice: string | null
}

const NOTICE: Record<'rate-limited' | 'timeout' | 'auth' | 'upstream', string> = {
  'rate-limited': 'Claude is rate-limiting requests — using built-in coaching for now.',
  timeout: 'Claude took too long to answer — using built-in coaching for now.',
  auth: 'The coaching server’s API key was rejected — using built-in coaching.',
  upstream: 'Claude could not answer — using built-in coaching for now.',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorKindOf(payload: unknown): CoachErrorKind | null {
  if (!isRecord(payload) || !isRecord(payload['error'])) return null
  const kind = payload['error']['kind']
  return typeof kind === 'string' ? (kind as CoachErrorKind) : null
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

/**
 * The browser's only door to the coach server. Every failure resolves to
 * `null` ("use the templated fallback") — never a thrown error — so callers
 * have exactly one code path. Status feeds the "coaching offline" badge; a
 * Claude-side failure is surfaced ONCE per session through `notice`.
 */
export class CoachClient {
  private snap: CoachSnapshot = { status: 'unknown', notice: null }
  private noticeShown = false
  private readonly listeners = new Set<() => void>()
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    // Slightly above the server's 15s Claude timeout, so the server answers first.
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  readonly getSnapshot = (): CoachSnapshot => this.snap

  dismissNotice(): void {
    if (this.snap.notice !== null) this.update({ notice: null })
  }

  async checkHealth(): Promise<void> {
    try {
      const res = await this.fetchImpl('/api/health', { signal: AbortSignal.timeout(5_000) })
      const body: unknown = res.ok ? await res.json() : null
      if (!isRecord(body) || body['ok'] !== true) {
        this.update({ status: 'offline' })
        return
      }
      this.update({ status: body['claude'] === true ? 'online' : 'no-key' })
    } catch {
      this.update({ status: 'offline' })
    }
  }

  hint(req: HintRequest, signal?: AbortSignal): Promise<string | null> {
    return this.post('/api/hint', req, signal)
  }

  review(req: ReviewRequest, signal?: AbortSignal): Promise<string | null> {
    return this.post('/api/review', req, signal)
  }

  private update(patch: Partial<CoachSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<string | null> {
    if (this.snap.status === 'no-key') return null
    if (signal?.aborted) return null

    let res: Response
    try {
      res = await this.fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: withTimeout(signal, this.timeoutMs),
      })
    } catch {
      if (signal?.aborted) return null // the caller moved on; says nothing about the server
      this.update({ status: 'offline' })
      return null
    }

    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      // Not our JSON: e.g. the dev proxy's error page while the server is down.
    }

    if (res.ok && isRecord(payload) && typeof payload['text'] === 'string' && payload['text'].trim()) {
      this.update({ status: 'online' })
      return payload['text'].trim()
    }

    const kind = errorKindOf(payload)
    if (kind === null) {
      this.update({ status: 'offline' })
      return null
    }
    if (kind === 'no-key') {
      this.update({ status: 'no-key' })
      return null
    }
    if (kind === 'bad-request') {
      console.warn(`coach server rejected ${path}:`, payload)
      return null
    }
    // A Claude-side failure: the server itself is fine.
    if (!this.noticeShown) {
      this.noticeShown = true
      this.update({ status: 'online', notice: NOTICE[kind] })
    } else {
      this.update({ status: 'online' })
    }
    return null
  }
}
```

`src/ui/useCoach.ts`:

```ts
import { useSyncExternalStore } from 'react'
import type { CoachClient, CoachSnapshot } from '../coach/client'

export function useCoach(client: CoachClient): CoachSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot)
}
```

Run: `npx vitest run src/coach` → PASS.

- [ ] **Step 3: Wire App**

In `src/ui/App.tsx`:

1. Imports:

```tsx
import { CoachClient } from '../coach/client'
import { useCoach } from './useCoach'
```

and extend the hints import: `import { HINT_BUDGET, hintRequestFrom } from '../coach/hints'`.

2. Near the other top-level state in `AppInner`:

```tsx
  // One coach client per app; it owns the offline badge and the one-time notice.
  const [coach] = useState(() => new CoachClient())
  const coachState = useCoach(coach)
  useEffect(() => {
    void coach.checkHealth()
  }, [coach])
```

3. Replace `reasonForHint` with:

```tsx
  // Press 3 = reasoning: Claude when the coach server can, templated otherwise.
  const reasonForHint = useCallback<HintReasoner>(
    async (s, pos, signal) => {
      const fallback = templatedHint([...s.lines], pos) ?? `${s.san} is the engine's choice.`
      const request = hintRequestFrom(s, pos)
      if (!request) return fallback
      return (await coach.hint(request, signal)) ?? fallback
    },
    [coach],
  )
```

4. In the status row, after the `result` paragraph:

```tsx
        {coachState.status === 'offline' || coachState.status === 'no-key' ? (
          <span
            className="coach-badge"
            data-testid="coach-badge"
            title={
              coachState.status === 'no-key'
                ? 'The coach server has no ANTHROPIC_API_KEY; using built-in hints.'
                : 'The coach server is not reachable; using built-in hints.'
            }
          >
            coaching offline
          </span>
        ) : null}
```

5. Directly after the status-row `</div>`:

```tsx
      {coachState.notice ? (
        <p className="coach-notice" role="status" data-testid="coach-notice">
          {coachState.notice}
          <button data-testid="coach-notice-dismiss" onClick={() => coach.dismissNotice()}>
            Dismiss
          </button>
        </p>
      ) : null}
```

Append to `src/ui/app.css`:

```css
.coach-badge {
  align-self: center;
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-panel-border);
  color: var(--color-muted);
  background: var(--color-panel-bg);
}
.coach-notice {
  text-align: center;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  padding: 6px 12px;
  margin: 0 auto 12px;
  max-width: 640px;
}
.coach-notice button { margin-left: 8px; }
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 4: Write the browser test**

Append to `tests/e2e/helpers.ts`:

```ts
import type { Route } from '@playwright/test'

/** A healthy coach server with Claude configured; hint/review handlers overridable. */
export async function coachOnline(
  page: Page,
  handlers: { hint?: (route: Route) => Promise<void>; review?: (route: Route) => Promise<void> } = {},
): Promise<void> {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, claude: true } }))
  await page.route('**/api/hint', handlers.hint ?? ((r) => r.fulfill({ json: { text: 'MOCK hint reasoning.' } })))
  await page.route('**/api/review', handlers.review ?? ((r) => r.fulfill({ json: { text: 'MOCK review summary.' } })))
}
```

(Merge the `Route` import into the existing `import type { Page } from '@playwright/test'` line.)

`tests/e2e/coach.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline, coachOnline, startOnePlayer } from './helpers'

async function pressAllHints(page: Page) {
  const hint = page.getByTestId('hint')
  for (const label of ['Hint', 'Show move', 'Explain']) {
    await expect(hint).toHaveText(label, { timeout: 30_000 })
    await hint.click()
  }
  await expect(hint).toHaveText('Explained', { timeout: 30_000 })
}

test('server unreachable: a badge says so, and hints still work (templated)', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await expect(page.getByTestId('coach-badge')).toHaveText('coaching offline')
  await startOnePlayer(page)
  await pressAllHints(page)
  await expect(page.getByTestId('hint-text')).toHaveText(/engine's choice|wins a|mate/)
  await expect(page.getByTestId('coach-notice')).toHaveCount(0)
})

test("server up: the third press shows Claude's reasoning, no badge", async ({ page }) => {
  await coachOnline(page)
  await page.goto('/')
  await startOnePlayer(page)
  await pressAllHints(page)
  await expect(page.getByTestId('hint-text')).toHaveText('MOCK hint reasoning.')
  await expect(page.getByTestId('coach-badge')).toHaveCount(0)
})

test('a Claude error is surfaced once per session, not per request', async ({ page }) => {
  let hintCalls = 0
  await coachOnline(page, {
    hint: (r) => {
      hintCalls++
      return r.fulfill({
        status: 503,
        json: { error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } },
      })
    },
  })
  await page.goto('/')
  await startOnePlayer(page)

  await pressAllHints(page)
  await expect(page.getByTestId('coach-notice')).toHaveCount(1)
  await expect(page.getByTestId('hint-text')).toHaveText(/\S/) // the templated fallback
  await page.getByTestId('coach-notice-dismiss').click()

  // Play the suggested move; after the engine replies, ask again.
  const arrow = page.locator('[data-annotation="arrow"]')
  const from = await arrow.getAttribute('data-from')
  const to = await arrow.getAttribute('data-to')
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })

  await pressAllHints(page)
  expect(hintCalls).toBe(2)
  await expect(page.getByTestId('coach-notice')).toHaveCount(0)
  await expect(page.getByTestId('coach-badge')).toHaveCount(0) // the server was up all along
})
```

Also add `await coachOffline(page)` as the first line of the test in `tests/e2e/hints.spec.ts` if it is not there (it is, from Task 2).

- [ ] **Step 5: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/coach.spec.ts tests/e2e/hints.spec.ts`
Expected: PASS. Then delete the `if (!this.noticeShown)` guard (always set the notice): the third test must FAIL at the final `coach-notice` count. Restore.

- [ ] **Step 6: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(coach): Claude-backed hint reasoning with silent templated fallback and offline badge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: game-core EPD/SAN helpers + vendored openings data

**Complexity:** mechanical (one network step: downloading five CC0 files).

**Files:**
- Modify: `src/game-core/position.ts`, `src/game-core/position.test.ts` (`epd()`, `trySan()`)
- Create: `src/game-core/notation.ts`, `src/game-core/notation.test.ts`
- Modify: `src/game-core/game.ts`, `src/game-core/game.test.ts` (`epds()`)
- Modify: `src/game-core/io.ts`, `src/game-core/io.test.ts` (`gameFromSan()`)
- Create: `src/openings/data.ts`, `src/openings/build.ts`, `src/openings/build.test.ts`, `tests/fixtures/openings.ts`
- Create: `data/openings/a.tsv` … `e.tsv` (downloaded), `scripts/openings-lib.ts`, `scripts/build-openings.ts`, `scripts/build-openings.test.ts`, `public/openings/openings.json` (generated)
- Modify: `package.json` (`openings` script), `NOTICE.md`

**Interfaces:**
- Consumes: `Position`, `Game`, `STARTING_FEN`, `MoveIntent`.
- Produces:
  - `Position.epd(): string` — the first four FEN fields, with the en-passant square kept ONLY if an en-passant capture is actually legal (so transpositions that differ only by a double pawn push compare equal, whatever chess.js prints).
  - `Position.trySan(san: string): MoveResult` — never throws.
  - `Game.epds(upToPly: number): string[]` — EPDs after 0..upToPly moves (clamped to the live ply).
  - `uciOf(m: MoveIntent): string`, `sanTokens(moveText: string): string[]` (notation.ts).
  - `gameFromSan(sans: readonly string[], startFen?: string): { ok: true; game: Game } | { ok: false; error: string }` (io.ts).
  - `interface OpeningsData { v: 1; maxPly: number; openings: Array<[eco: string, name: string, san: string]>; positions: Record<string, [named: number, next: string[]]> }`, `parseOpeningsData(raw: unknown): OpeningsData | null` (openings/data.ts).
  - `parseTsv(text)`, `buildOpeningsData(tsvTexts: readonly string[]): OpeningsData` (openings/build.ts).
  - `FIXTURE_TSV` (tests/fixtures/openings.ts) — reused by Tasks 8 and 9.
  - Static asset `/openings/openings.json`; npm script `openings`.

**Build-time vs runtime ruling — build time.** The ~3,500 lines replay to roughly 30,000 SAN moves. Doing that in the browser means ~30k chess.js `move()` calls on the main thread (each regenerates legal moves) — on the order of a second of jank before the first opening name can appear, plus shipping the TSVs anyway. Instead `scripts/build-openings.ts` replays them once through `game-core` and writes `public/openings/openings.json`: a static asset outside the JS bundle (0 bytes added to `index-*.js`), fetched lazily after first paint and cached by the browser; estimated ~1 MB raw / ~150–250 KB gzipped (record the real numbers in the commit message). The JSON is committed, and a unit test fails if it drifts from the TSVs.

- [ ] **Step 1: Write the failing game-core tests**

In `src/game-core/position.test.ts` add `import { RULE_FIXTURES } from '../../tests/fixtures/positions'` and append:

```ts
describe('epd', () => {
  test('the start position', () => {
    expect(new Position().epd()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  })

  test('drops an en-passant square no pawn can use', () => {
    const p = new Position()
    p.tryMove({ from: 'e2', to: 'e4' })
    expect(p.epd()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')
  })

  test('keeps it when en passant is legal', () => {
    expect(new Position(RULE_FIXTURES.enPassantAvailable).epd()).toBe(
      'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6',
    )
  })

  test('transpositions that differ only by the last double push are equal', () => {
    const a = new Position()
    for (const san of ['c4', 'Nf6', 'd4']) a.trySan(san)
    const b = new Position()
    for (const san of ['d4', 'Nf6', 'c4']) b.trySan(san)
    expect(a.epd()).toBe(b.epd())
    expect(a.epd()).toBe('rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -')
  })
})

describe('trySan', () => {
  test('plays a legal SAN move', () => {
    const p = new Position()
    const r = p.trySan('Nf3')
    expect(r.ok && r.move.from === 'g1' && r.move.to === 'f3').toBe(true)
  })
  test('an illegal SAN move is a returned value, never a throw', () => {
    const p = new Position()
    expect(() => p.trySan('Nf6')).not.toThrow()
    expect(p.trySan('Nf6')).toEqual({ ok: false, reason: 'illegal' })
    expect(p.trySan('garbage')).toEqual({ ok: false, reason: 'illegal' })
  })
  test('refuses after the game is over', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    p.trySan('Qxf7#')
    expect(p.trySan('Ke7')).toEqual({ ok: false, reason: 'game-over' })
  })
})
```

`src/game-core/notation.test.ts`:

```ts
import { expect, test } from 'vitest'
import { sanTokens, uciOf } from './notation'

test('uciOf', () => {
  expect(uciOf({ from: 'e2', to: 'e4' })).toBe('e2e4')
  expect(uciOf({ from: 'e7', to: 'e8', promotion: 'q' })).toBe('e7e8q')
})

test('sanTokens strips move numbers and results', () => {
  expect(sanTokens('1. e4 e5 2. Nf3 Nc6 3...a6 *')).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'a6'])
  expect(sanTokens('1.e4 e5 2.Nf3 1-0')).toEqual(['e4', 'e5', 'Nf3'])
  expect(sanTokens('  ')).toEqual([])
})
```

Append to `src/game-core/game.test.ts`:

```ts
test('epds lists the position after each ply up to the requested one', () => {
  const g = new Game()
  g.play({ from: 'e2', to: 'e4' })
  g.play({ from: 'c7', to: 'c5' })
  const epds = g.epds(2)
  expect(epds).toHaveLength(3)
  expect(epds[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
  expect(epds[2]).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -')
  expect(g.epds(99)).toHaveLength(3) // clamped to the live ply
  expect(g.epds(0)).toHaveLength(1)
})
```

Append to `src/game-core/io.test.ts` (add `gameFromSan` to the import):

```ts
describe('gameFromSan', () => {
  test('builds a live game from SAN', () => {
    const r = gameFromSan(['e4', 'c5', 'Nf3'])
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.game.moves.map((m) => m.san)).toEqual(['e4', 'c5', 'Nf3'])
    expect(r.game.isViewingLive()).toBe(true)
  })
  test('names the first illegal move', () => {
    const r = gameFromSan(['e4', 'e4'])
    expect(r).toEqual({ ok: false, error: 'Illegal move: e4' })
  })
})
```

Run: `npx vitest run src/game-core`
Expected: FAIL — `epd`/`trySan`/`epds`/`gameFromSan` missing, `./notation` not found.

- [ ] **Step 2: Implement the game-core helpers**

Add to the `Position` class in `src/game-core/position.ts` (after `fen()`):

```ts
  /**
   * The position as an EPD key: placement, side, castling, en passant.
   * The en-passant square is kept only when an en-passant capture is
   * actually legal, so two move orders reaching the same position always
   * produce the same key, however chess.js chooses to print that field.
   */
  epd(): string {
    const [placement, turn, castling, ep] = this.chess.fen().split(' ')
    const epUsable = ep !== undefined && ep !== '-' && this.chess.moves({ verbose: true }).some((m) => m.isEnPassant())
    return `${placement} ${turn} ${castling} ${epUsable ? ep : '-'}`
  }
```

and after `tryMove`:

```ts
  /** Apply a SAN move. Never throws: chess.js throws on illegal input, we return a value. */
  trySan(san: string): MoveResult {
    if (this.status().kind !== 'in-progress') {
      return { ok: false, reason: 'game-over' }
    }
    try {
      return { ok: true, move: toPlayedMove(this.chess.move(san)) }
    } catch {
      return { ok: false, reason: 'illegal' }
    }
  }
```

`src/game-core/notation.ts`:

```ts
import type { MoveIntent } from './types'

/** Long algebraic (UCI) form of a move: e2e4, e7e8q. */
export function uciOf(m: MoveIntent): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`
}

const RESULT = /^(?:1-0|0-1|1\/2-1\/2|\*)$/

/** SAN moves out of PGN-style move text ("1. e4 e5 2.Nf3 3...a6 *"). */
export function sanTokens(moveText: string): string[] {
  return moveText
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t.length > 0 && !RESULT.test(t))
}
```

Add to the `Game` class in `src/game-core/game.ts`:

```ts
  /** EPD keys after 0..upToPly moves (clamped to the live ply) — for opening lookup. */
  epds(upToPly: number): string[] {
    const n = Math.max(0, Math.min(upToPly, this.played.length))
    const fens = [this.startFen, ...this.played.slice(0, n).map((m) => m.fenAfter)]
    return fens.map((fen) => new Position(fen).epd())
  }
```

Append to `src/game-core/io.ts` (add `import { Position } from './position'`):

```ts
/** A live game from a list of SAN moves (the explorer's "start from this opening"). */
export function gameFromSan(
  sans: readonly string[],
  startFen: string = STARTING_FEN,
): { ok: true; game: Game } | { ok: false; error: string } {
  const start = Position.fromFen(startFen)
  if (!start.ok) return { ok: false, error: start.error }
  const probe = start.position
  const game = new Game({ fen: startFen })
  for (const san of sans) {
    const r = probe.trySan(san)
    if (!r.ok) return { ok: false, error: `Illegal move: ${san}` }
    const played = game.play({
      from: r.move.from,
      to: r.move.to,
      ...(r.move.promotion ? { promotion: r.move.promotion } : {}),
    })
    if (!played.ok) return { ok: false, error: `Illegal move: ${san}` }
  }
  return { ok: true, game }
}
```

Run: `npx vitest run src/game-core` → PASS (including perft — `epd()`/`trySan()` touch nothing it uses).

- [ ] **Step 3: Write the failing builder tests**

`tests/fixtures/openings.ts`:

```ts
/** A tiny lichess-format dataset: header, then eco<TAB>name<TAB>pgn. */
export const FIXTURE_TSV = [
  'eco\tname\tpgn',
  'B20\tSicilian Defense\t1. e4 c5',
  'B27\tSicilian Defense: Hyperaccelerated Fianchetto\t1. e4 c5 2. Nf3 g6',
  "C20\tKing's Pawn Game\t1. e4 e5",
  "A40\tQueen's Pawn Game: Transposition Test\t1. d4 Nf6 2. c4 e6",
  'A10\tEnglish Opening: Transposition Test\t1. c4 e6 2. d4 Nf6',
].join('\n')

export const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'
export const AFTER_E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
```

`src/openings/build.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildOpeningsData, parseTsv } from './build'
import { parseOpeningsData } from './data'
import { AFTER_E4_EPD, FIXTURE_TSV, START_EPD } from '../../tests/fixtures/openings'
import { Position } from '../game-core/position'

describe('parseTsv', () => {
  test('reads rows into SAN lists', () => {
    expect(parseTsv(FIXTURE_TSV)[1]).toEqual({
      eco: 'B27',
      name: 'Sicilian Defense: Hyperaccelerated Fianchetto',
      sans: ['e4', 'c5', 'Nf3', 'g6'],
    })
  })
  test('rejects a file with the wrong header', () => {
    expect(() => parseTsv('eco\tname\tuci\nA00\tx\te2e4')).toThrow(/header/)
  })
})

describe('buildOpeningsData', () => {
  const data = buildOpeningsData([FIXTURE_TSV])

  test('lists every opening in order', () => {
    expect(data.openings).toHaveLength(5)
    expect(data.openings[0]).toEqual(['B20', 'Sicilian Defense', 'e4 c5'])
    expect(data.maxPly).toBe(4)
  })

  test('records distinct continuations per position, in first-seen order', () => {
    expect(data.positions[START_EPD]).toEqual([-1, ['e2e4', 'd2d4', 'c2c4']])
    expect(data.positions[AFTER_E4_EPD]).toEqual([-1, ['c7c5', 'e7e5']])
  })

  test('names the final position of each line; a transposed duplicate keeps the first name', () => {
    const p = new Position()
    for (const san of ['e4', 'c5']) p.trySan(san)
    expect(data.positions[p.epd()]?.[0]).toBe(0)

    const q = new Position()
    for (const san of ['c4', 'e6', 'd4', 'Nf6']) q.trySan(san)
    expect(data.positions[q.epd()]?.[0]).toBe(3) // A40 came first
  })

  test('an illegal line fails the build loudly', () => {
    expect(() => buildOpeningsData(['eco\tname\tpgn\nX00\tBroken\t1. e4 e4'])).toThrow(/Broken.*e4/)
  })

  test('parseOpeningsData accepts the output and rejects junk', () => {
    expect(parseOpeningsData(JSON.parse(JSON.stringify(data)))).not.toBeNull()
    expect(parseOpeningsData({ v: 2 })).toBeNull()
    expect(parseOpeningsData('nope')).toBeNull()
  })
})
```

Run: `npx vitest run src/openings` → FAIL (modules not found).

- [ ] **Step 4: Implement the builder**

`src/openings/data.ts`:

```ts
/**
 * The pre-built opening index (public/openings/openings.json), produced by
 * scripts/build-openings.ts from the vendored lichess TSVs.
 */
export interface OpeningsData {
  v: 1
  /** Longest line in plies: no deeper position can be named. */
  maxPly: number
  /** [eco, name, space-separated SAN moves] — index = opening id. */
  openings: Array<[string, string, string]>
  /** EPD -> [id of the opening whose line ends exactly here, or -1; distinct UCI continuations]. */
  positions: Record<string, [number, string[]]>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Shape check for our own asset (a truncated or stale download must not crash the app). */
export function parseOpeningsData(raw: unknown): OpeningsData | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null
  if (typeof raw['maxPly'] !== 'number' || !Array.isArray(raw['openings']) || !isRecord(raw['positions'])) {
    return null
  }
  return raw as unknown as OpeningsData
}
```

`src/openings/build.ts`:

```ts
import { Position } from '../game-core/position'
import { sanTokens, uciOf } from '../game-core/notation'
import type { OpeningsData } from './data'

export interface TsvRow {
  eco: string
  name: string
  sans: string[]
}

/** lichess-org/chess-openings format: a header line `eco\tname\tpgn`, then one opening per line. */
export function parseTsv(text: string): TsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const [header, ...rows] = lines
  if (header?.trim() !== 'eco\tname\tpgn') throw new Error(`unexpected TSV header: ${header ?? '(empty)'}`)
  return rows.map((row, i) => {
    const [eco, name, pgn] = row.split('\t')
    if (!eco || !name || !pgn) throw new Error(`malformed TSV row ${i + 2}: ${row}`)
    return { eco, name, sans: sanTokens(pgn) }
  })
}

/**
 * Replay every line once through game-core (the only chess.js user) and
 * index each position by EPD. Deterministic: files and rows are processed
 * in order, so the same input always produces byte-identical JSON.
 */
export function buildOpeningsData(tsvTexts: readonly string[]): OpeningsData {
  const openings: OpeningsData['openings'] = []
  const positions: OpeningsData['positions'] = {}
  let maxPly = 0
  const entryFor = (epd: string): [number, string[]] => (positions[epd] ??= [-1, []])

  for (const text of tsvTexts) {
    for (const row of parseTsv(text)) {
      const id = openings.length
      openings.push([row.eco, row.name, row.sans.join(' ')])
      const pos = new Position()
      for (const san of row.sans) {
        const entry = entryFor(pos.epd())
        const r = pos.trySan(san)
        if (!r.ok) throw new Error(`${row.eco} ${row.name}: illegal move ${san}`)
        const uci = uciOf(r.move)
        if (!entry[1].includes(uci)) entry[1].push(uci)
      }
      const final = entryFor(pos.epd())
      if (final[0] === -1) final[0] = id
      maxPly = Math.max(maxPly, row.sans.length)
    }
  }
  return { v: 1, maxPly, openings, positions }
}
```

Run: `npx vitest run src/openings` → PASS.

- [ ] **Step 5: Vendor the dataset**

The lichess opening dataset lives at https://github.com/lichess-org/chess-openings (CC0 1.0). Download the five raw TSVs and record the exact commit:

```bash
mkdir -p data/openings
for f in a b c d e; do
  curl -fsSL -o "data/openings/$f.tsv" "https://raw.githubusercontent.com/lichess-org/chess-openings/master/$f.tsv"
done
git ls-remote https://github.com/lichess-org/chess-openings HEAD   # note the SHA for NOTICE.md
head -2 data/openings/a.tsv    # expect the header line: eco<TAB>name<TAB>pgn
cat data/openings/*.tsv | grep -vc '^eco' # expect roughly 3,400-3,700 openings
```

If the `master` URLs 404, the default branch was renamed: use the branch shown by `git ls-remote --symref https://github.com/lichess-org/chess-openings HEAD`. If the header is not exactly `eco\tname\tpgn`, stop and report — the builder deliberately refuses other formats.

Append to `NOTICE.md` (fill in the SHA from `git ls-remote`):

```markdown

Opening names and lines: the **lichess-org/chess-openings** dataset
(`a.tsv`–`e.tsv`, vendored unmodified in `data/openings/`), released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Source: https://github.com/lichess-org/chess-openings at commit `<SHA>`.
`public/openings/openings.json` is generated from it by `npm run openings`.

CC0 requires no attribution; this credit is given voluntarily.
```

- [ ] **Step 6: Build script and staleness test (test first)**

`scripts/openings-lib.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildOpeningsData } from '../src/openings/build'

const fromRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

export const TSV_FILES = ['a', 'b', 'c', 'd', 'e'].map((l) => fromRoot(`data/openings/${l}.tsv`))
export const OUTPUT_FILE = fromRoot('public/openings/openings.json')

export function buildOpeningsJson(): string {
  return `${JSON.stringify(buildOpeningsData(TSV_FILES.map((f) => readFileSync(f, 'utf8'))))}\n`
}
```

`scripts/build-openings.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { OUTPUT_FILE, buildOpeningsJson } from './openings-lib'
import { parseOpeningsData } from '../src/openings/data'

describe('vendored openings', () => {
  test('the committed JSON is exactly what the TSVs build to (fix: npm run openings)', () => {
    expect(readFileSync(OUTPUT_FILE, 'utf8') === buildOpeningsJson()).toBe(true)
  }, 120_000)

  test('it is the full lichess dataset', () => {
    const data = parseOpeningsData(JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')))
    expect(data).not.toBeNull()
    expect(data?.openings.length).toBeGreaterThan(3000)
    expect(data?.openings.some(([eco, name]) => eco === 'B20' && name === 'Sicilian Defense')).toBe(true)
  })
})
```

Run: `npx vitest run scripts` → FAIL (`ENOENT` for `public/openings/openings.json`).

`scripts/build-openings.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { OUTPUT_FILE, buildOpeningsJson } from './openings-lib'

const json = buildOpeningsJson()
mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
writeFileSync(OUTPUT_FILE, json)
const data = JSON.parse(json) as { openings: unknown[]; positions: object; maxPly: number }
console.log(
  `wrote ${OUTPUT_FILE}: ${data.openings.length} openings, ` +
    `${Object.keys(data.positions).length} positions, maxPly ${data.maxPly}, ` +
    `${(json.length / 1024).toFixed(0)} KiB`,
)
```

Add to `package.json` scripts: `"openings": "tsx scripts/build-openings.ts"`.

Run:

```bash
npm run openings
gzip -c public/openings/openings.json | wc -c    # record raw and gzipped sizes for the commit message
npx vitest run scripts
```

Expected: the script prints the counts; tests PASS. Prove the staleness test bites: append a harmless space to one opening name in `data/openings/a.tsv`, re-run `npx vitest run scripts` → FAIL; `git checkout data/openings/a.tsv`.

- [ ] **Step 7: Full suites and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: green; `dist/openings/openings.json` exists and the `dist/assets/index-*.js` size is unchanged by this task (the data is an asset, not code).

```bash
git add src/game-core src/openings tests/fixtures/openings.ts data/openings scripts public/openings package.json NOTICE.md
git commit -m "feat(openings): vendor lichess ECO dataset and pre-build an EPD index

openings.json: <N> openings, <M> positions, <raw> KiB raw / <gz> KiB gzip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: OpeningBook + opening name as you play

**Complexity:** integration.

**Files:**
- Create: `src/openings/book.ts`, `src/openings/book.test.ts`
- Create: `src/ui/useOpeningBook.ts`
- Modify: `scripts/build-openings.test.ts` (real-data transpositions)
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Create: `tests/e2e/opening-name.spec.ts`

**Interfaces:**
- Consumes: `OpeningsData`, `parseOpeningsData`, `buildOpeningsData`, `FIXTURE_TSV` (T7); `Game.epds`, `gameFromSan` (T7).
- Produces:
  - `interface OpeningEntry { id: number; eco: string; name: string; moves: readonly string[] }`
  - `class OpeningBook { constructor(data: OpeningsData); readonly maxPly: number; readonly all: readonly OpeningEntry[]; named(epd): OpeningEntry | null; continuations(epd): readonly string[]; identify(epdsByPly: readonly string[]): OpeningEntry | null; search(query: string, limit?: number): OpeningEntry[] }`
  - `loadOpeningBook(fetchImpl?, url?): Promise<OpeningBook | null>` (cached; a failure is not cached), `resetOpeningBookCache()` (tests)
  - `useOpeningBook(): { book: OpeningBook | null; failed: boolean }`
  - App DOM: `data-testid="opening"` shows `"<ECO> <name>"` for the displayed position.

Naming rule: the name of the displayed position is the name of the LATEST named position at or before the displayed ply (lichess behaviour — after leaving theory you still see the opening you left). Lookups are by EPD, so transpositions name correctly.

- [ ] **Step 1: Write the failing tests**

`src/openings/book.test.ts` (Node environment: it builds `Response` objects):

```ts
// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { OpeningBook, loadOpeningBook, resetOpeningBookCache } from './book'
import { buildOpeningsData } from './build'
import { AFTER_E4_EPD, FIXTURE_TSV, START_EPD } from '../../tests/fixtures/openings'
import { gameFromSan } from '../game-core/io'

const book = new OpeningBook(buildOpeningsData([FIXTURE_TSV]))

function epdsOf(sans: string[]): string[] {
  const r = gameFromSan(sans)
  if (!r.ok) throw new Error(r.error)
  return r.game.epds(sans.length)
}

describe('OpeningBook', () => {
  test('names an exact position and lists continuations', () => {
    expect(book.named(epdsOf(['e4', 'c5'])[2]!)?.name).toBe('Sicilian Defense')
    expect(book.named(START_EPD)).toBeNull()
    expect(book.continuations(AFTER_E4_EPD)).toEqual(['c7c5', 'e7e5'])
    expect(book.continuations('8/8/8/8/8/8/8/8 w - -')).toEqual([])
  })

  test('identify walks back to the latest named position', () => {
    // After 2.Nf3 (unnamed) the game is still a Sicilian.
    expect(book.identify(epdsOf(['e4', 'c5', 'Nf3']))?.eco).toBe('B20')
    expect(book.identify(epdsOf(['e4', 'c5', 'Nf3', 'g6']))?.eco).toBe('B27')
    expect(book.identify([START_EPD])).toBeNull()
  })

  test('transpositions are named by position, not by move order', () => {
    const viaEnglish = book.identify(epdsOf(['c4', 'e6', 'd4', 'Nf6']))
    const viaQueensPawn = book.identify(epdsOf(['d4', 'Nf6', 'c4', 'e6']))
    expect(viaEnglish).toEqual(viaQueensPawn)
    expect(viaEnglish?.eco).toBe('A40')
  })

  test('search matches name or ECO, case-insensitively, with a limit', () => {
    expect(book.search('sicilian').map((e) => e.eco)).toEqual(['B20', 'B27'])
    expect(book.search('b27').map((e) => e.eco)).toEqual(['B27'])
    expect(book.search('')).toHaveLength(5)
    expect(book.search('', 2)).toHaveLength(2)
    expect(book.all[1]?.moves).toEqual(['e4', 'c5', 'Nf3', 'g6'])
  })
})

describe('loadOpeningBook', () => {
  afterEach(() => resetOpeningBookCache())

  test('fetches, validates and caches', async () => {
    const data = buildOpeningsData([FIXTURE_TSV])
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(data)))
    const a = await loadOpeningBook(fetchImpl)
    const b = await loadOpeningBook(fetchImpl)
    expect(a?.all).toHaveLength(5)
    expect(b).toBe(a)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('a failure yields null and is retried next time', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 404 }))
    expect(await loadOpeningBook(failing)).toBeNull()
    const data = buildOpeningsData([FIXTURE_TSV])
    expect(await loadOpeningBook(async () => new Response(JSON.stringify(data)))).not.toBeNull()
  })
})
```

Append to `scripts/build-openings.test.ts` (add imports `import { OpeningBook } from '../src/openings/book'` and `import { gameFromSan } from '../src/game-core/io'`):

```ts
test('real transpositions reach the same name (Najdorf by two move orders)', () => {
  const data = parseOpeningsData(JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')))
  if (!data) throw new Error('no data')
  const book = new OpeningBook(data)
  const nameOf = (sans: string[]) => {
    const r = gameFromSan(sans)
    if (!r.ok) throw new Error(r.error)
    return book.identify(r.game.epds(sans.length))?.name
  }
  const main = nameOf(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'])
  const transposed = nameOf(['e4', 'c5', 'Nc3', 'd6', 'Nf3', 'Nf6', 'd4', 'cxd4', 'Nxd4', 'a6'])
  expect(main).toBe('Sicilian Defense: Najdorf Variation')
  expect(transposed).toBe(main)
  expect(nameOf(['e4', 'c5'])).toBe('Sicilian Defense')
})
```

Run: `npx vitest run src/openings scripts` → FAIL (`./book` not found).

- [ ] **Step 2: Implement**

`src/openings/book.ts`:

```ts
import { parseOpeningsData, type OpeningsData } from './data'

export interface OpeningEntry {
  id: number
  eco: string
  name: string
  moves: readonly string[]
}

/** Read-only queries over the pre-built index. React-free and chess.js-free. */
export class OpeningBook {
  readonly maxPly: number
  readonly all: readonly OpeningEntry[]
  private readonly positions: OpeningsData['positions']

  constructor(data: OpeningsData) {
    this.maxPly = data.maxPly
    this.positions = data.positions
    this.all = data.openings.map(([eco, name, san], id) => ({
      id,
      eco,
      name,
      moves: san.length > 0 ? san.split(' ') : [],
    }))
  }

  private at(epd: string): [number, string[]] | undefined {
    return Object.hasOwn(this.positions, epd) ? this.positions[epd] : undefined
  }

  named(epd: string): OpeningEntry | null {
    const id = this.at(epd)?.[0] ?? -1
    return id >= 0 ? (this.all[id] ?? null) : null
  }

  /** Distinct UCI moves the dataset plays from this position (the engine's book). */
  continuations(epd: string): readonly string[] {
    return this.at(epd)?.[1] ?? []
  }

  /** The latest named position in `epdsByPly` (index = ply), walking back from the end. */
  identify(epdsByPly: readonly string[]): OpeningEntry | null {
    for (let i = epdsByPly.length - 1; i >= 0; i--) {
      const epd = epdsByPly[i]
      const hit = epd === undefined ? null : this.named(epd)
      if (hit) return hit
    }
    return null
  }

  search(query: string, limit = 100): OpeningEntry[] {
    const q = query.trim().toLowerCase()
    const hits = q.length === 0
      ? this.all
      : this.all.filter((e) => e.name.toLowerCase().includes(q) || e.eco.toLowerCase() === q)
    return hits.slice(0, limit)
  }
}

let cached: Promise<OpeningBook | null> | null = null

/** Fetch the index once per page. A failed load is not cached, so a later call retries. */
export function loadOpeningBook(
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
  url = '/openings/openings.json',
): Promise<OpeningBook | null> {
  cached ??= fetchImpl(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((raw: unknown) => {
      const data = parseOpeningsData(raw)
      return data ? new OpeningBook(data) : null
    })
    .catch(() => null)
    .then((book) => {
      if (!book) cached = null
      return book
    })
  return cached
}

export function resetOpeningBookCache(): void {
  cached = null
}
```

`src/ui/useOpeningBook.ts`:

```ts
import { useEffect, useState } from 'react'
import { loadOpeningBook, type OpeningBook } from '../openings/book'

export function useOpeningBook(): { book: OpeningBook | null; failed: boolean } {
  const [state, setState] = useState<{ book: OpeningBook | null; failed: boolean }>({ book: null, failed: false })
  useEffect(() => {
    let live = true
    void loadOpeningBook().then((book) => {
      if (live) setState({ book, failed: book === null })
    })
    return () => {
      live = false
    }
  }, [])
  return state
}
```

Run: `npx vitest run src/openings scripts` → PASS.

- [ ] **Step 3: Show the name in App**

In `src/ui/App.tsx`: add `import { useOpeningBook } from './useOpeningBook'`, then after the `useEvaluation(...)` call add:

```tsx
  const { book, failed: bookFailed } = useOpeningBook()
  // The SANs up to the displayed ply: an undo followed by a different move
  // leaves ply/livePly unchanged, so the moves themselves are the memo key.
  const sanKey = game.moves.slice(0, game.ply).map((m) => m.san).join(' ')
  const opening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.ply, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, game.ply, sanKey],
  )
```

In the status row, after the `turn` paragraph:

```tsx
        <p className="opening" data-testid="opening" title={opening ? `${opening.eco} ${opening.name}` : undefined}>
          {opening ? `${opening.eco} ${opening.name}` : ''}
        </p>
```

(`bookFailed` is used by the explorer in Task 9; until then prefix it `_` or omit the destructuring name — do not leave an unused binding: write `const { book } = useOpeningBook()` now and add `failed: bookFailed` in Task 9.)

Append to `src/ui/app.css`:

```css
.opening {
  color: var(--color-muted);
  max-width: 28em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 4: Write the browser test**

`tests/e2e/opening-name.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('the opening is named as you play, and keeps its name after leaving theory', async ({ page }) => {
  const opening = page.getByTestId('opening')
  await play(page, [['e2', 'e4'], ['c7', 'c5']])
  await expect(opening).toHaveText('B20 Sicilian Defense')
  await play(page, [['g1', 'f3'], ['d7', 'd6'], ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['g8', 'f6'], ['b1', 'c3'], ['a7', 'a6']])
  await expect(opening).toContainText('Sicilian Defense: Najdorf Variation')
  // Browsing back re-names the displayed position.
  await page.getByTestId('move-2').click()
  await expect(opening).toHaveText('B20 Sicilian Defense')
})

test('a transposed move order reaches the same name', async ({ page }) => {
  await play(page, [
    ['e2', 'e4'], ['c7', 'c5'], ['b1', 'c3'], ['d7', 'd6'], ['g1', 'f3'], ['g8', 'f6'],
    ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['a7', 'a6'],
  ])
  await expect(page.getByTestId('opening')).toContainText('Sicilian Defense: Najdorf Variation')
})
```

- [ ] **Step 5: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/opening-name.spec.ts`
Expected: PASS. Then change `Position.epd()` to return `this.chess.fen()` (full FEN, move counters included): the transposition spec must FAIL (different move orders reach different halfmove clocks). Restore.

- [ ] **Step 6: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src scripts tests/e2e
git commit -m "feat(openings): name the opening as you play, by EPD so transpositions match

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Right-column tabs + opening explorer

**Complexity:** integration.

**Files:**
- Create: `src/ui/panels/Tabs.tsx`, `src/ui/panels/Tabs.test.tsx`
- Create: `src/ui/panels/Explorer.tsx`, `src/ui/panels/Explorer.test.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Create: `tests/e2e/explorer.spec.ts`

**Interfaces:**
- Consumes: `OpeningBook`, `OpeningEntry` (T8), `gameFromSan` (T7), `numberedMoves` (T5), `buildConfig`/`loadMatch` (App).
- Produces:
  - `interface TabSpec { id: string; label: string; content: ReactNode }`, `<Tabs tabs active onChange />` — ARIA tablist; buttons `data-testid="tab-<id>"`, `aria-selected`; panels `role="tabpanel"`, inactive ones `hidden` (still mounted, so their state and test ids survive tab switches).
  - `<Explorer book unavailable current onStart={(entry: OpeningEntry) => void} />` — `explorer-search`, `explorer-results`, `explorer-detail`, `explorer-start`.
  - App: `type RightTab = 'moves' | 'explorer' | 'review' | 'history'` and `tab` state (Tasks 12–13 add the last two tabs); `handleStartOpening(entry)`.

"Start from this opening" ruling: it builds the line with `gameFromSan` and loads it through `loadMatch` with the CURRENT New-game selections (mode, level, colour, time control) — so choosing One player + Black and starting the Najdorf hands White's 6th move to the engine. The Moves tab is selected afterwards so the loaded line is visible.

- [ ] **Step 1: Write the failing component tests**

`src/ui/panels/Tabs.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Tabs } from './Tabs'

test('shows the active panel, hides (but keeps) the others, and reports clicks', () => {
  const onChange = vi.fn()
  render(
    <Tabs
      active="a"
      onChange={onChange}
      tabs={[
        { id: 'a', label: 'Alpha', content: <p>first</p> },
        { id: 'b', label: 'Beta', content: <p>second</p> },
      ]}
    />,
  )
  expect(screen.getByTestId('tab-a')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('first')).toBeVisible()
  expect(screen.getByText('second')).not.toBeVisible()
  fireEvent.click(screen.getByTestId('tab-b'))
  expect(onChange).toHaveBeenCalledWith('b')
})
```

`src/ui/panels/Explorer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Explorer } from './Explorer'
import { OpeningBook } from '../../openings/book'
import { buildOpeningsData } from '../../openings/build'
import { FIXTURE_TSV } from '../../../tests/fixtures/openings'

const book = new OpeningBook(buildOpeningsData([FIXTURE_TSV]))

test('search narrows the list; picking shows the line; start hands over the entry', () => {
  const onStart = vi.fn()
  render(<Explorer book={book} unavailable={false} current={null} onStart={onStart} />)
  expect(screen.getByTestId('explorer-results').querySelectorAll('button')).toHaveLength(5)

  fireEvent.change(screen.getByTestId('explorer-search'), { target: { value: 'sicilian' } })
  const results = screen.getByTestId('explorer-results').querySelectorAll('button')
  expect(results).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: 'B27 Sicilian Defense: Hyperaccelerated Fianchetto' }))
  expect(screen.getByTestId('explorer-detail')).toHaveTextContent('1. e4 c5 2. Nf3 g6')
  fireEvent.click(screen.getByTestId('explorer-start'))
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ eco: 'B27', moves: ['e4', 'c5', 'Nf3', 'g6'] }))
})

test('loading and unavailable states', () => {
  const { rerender } = render(<Explorer book={null} unavailable={false} current={null} onStart={vi.fn()} />)
  expect(screen.getByTestId('explorer-status')).toHaveTextContent(/loading/i)
  rerender(<Explorer book={null} unavailable current={null} onStart={vi.fn()} />)
  expect(screen.getByTestId('explorer-status')).toHaveTextContent(/unavailable/i)
})
```

Run: `npx vitest run src/ui/panels` → FAIL (modules not found).

- [ ] **Step 2: Implement**

`src/ui/panels/Tabs.tsx`:

```tsx
import type { ReactNode } from 'react'

export interface TabSpec {
  id: string
  label: string
  content: ReactNode
}

/** An ARIA tab group. Inactive panels stay mounted (hidden) so their state survives. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly TabSpec[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="tabs">
      <div className="tabs-header" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-testid={`tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            className={t.id === active ? 'active' : ''}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          className="tab-panel"
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  )
}
```

`src/ui/panels/Explorer.tsx`:

```tsx
import { useState } from 'react'
import type { OpeningBook, OpeningEntry } from '../../openings/book'
import { numberedMoves } from '../../review/moveNumber'

export function Explorer({
  book,
  unavailable,
  current,
  onStart,
}: {
  book: OpeningBook | null
  unavailable: boolean
  /** The opening of the displayed position, if any. */
  current: OpeningEntry | null
  onStart: (entry: OpeningEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  if (!book) {
    return (
      <p className="explorer-status" data-testid="explorer-status">
        {unavailable ? 'Opening data is unavailable.' : 'Loading openings…'}
      </p>
    )
  }

  const results = book.search(query)
  const selected = selectedId === null ? null : (book.all[selectedId] ?? null)

  return (
    <div className="explorer" data-testid="explorer">
      {current ? (
        <p className="explorer-current">
          Now: {current.eco} {current.name}
        </p>
      ) : null}
      <input
        type="search"
        data-testid="explorer-search"
        placeholder="Search by name or ECO code"
        aria-label="Search openings"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="explorer-results" data-testid="explorer-results">
        {results.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className={e.id === selectedId ? 'selected' : ''}
              onClick={() => setSelectedId(e.id)}
            >
              <span className="eco">{e.eco}</span> {e.name}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <div className="explorer-detail" data-testid="explorer-detail">
          <p className="explorer-name">
            {selected.eco} {selected.name}
          </p>
          <p className="explorer-moves">{numberedMoves(selected.moves, 'w')}</p>
          <button type="button" data-testid="explorer-start" onClick={() => onStart(selected)}>
            Start from this opening
          </button>
        </div>
      ) : null}
    </div>
  )
}
```

Replace the `.tabs-header button` rule in `src/ui/app.css` and append explorer styles:

```css
.tabs-header button {
  flex: 1;
  padding: 6px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-fg);
  cursor: pointer;
  font-weight: 600;
}
.tabs-header button.active { border-bottom-color: var(--color-fg); background: var(--color-bg); }

.explorer { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.explorer-current { margin: 0; font-size: 0.85em; color: var(--color-muted); }
.explorer-results { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
.explorer-results button {
  width: 100%; text-align: left; border: none; background: transparent;
  color: var(--color-fg); padding: 3px 4px; border-radius: 4px; cursor: pointer; font: inherit;
}
.explorer-results button.selected { background: var(--color-accent-bg); }
.explorer-results .eco { color: var(--color-muted); font-variant-numeric: tabular-nums; }
.explorer-detail { border-top: 1px solid var(--color-panel-border); padding-top: 6px; }
.explorer-moves { font-family: monospace; font-size: 0.9em; }
.explorer-status { padding: 8px; color: var(--color-muted); }
```

- [ ] **Step 3: Wire App**

In `src/ui/App.tsx`:

1. Imports:

```tsx
import { Tabs } from './panels/Tabs'
import { Explorer } from './panels/Explorer'
import type { OpeningEntry } from '../openings/book'
```

and add `gameFromSan` to the `../game-core/io` import. Change `const { book } = useOpeningBook()` to `const { book, failed: bookFailed } = useOpeningBook()`.

2. Above `function AppInner`, add `type RightTab = 'moves' | 'explorer' | 'review' | 'history'`. Inside it, near the other state: `const [tab, setTab] = useState<RightTab>('moves')`.

3. After `handleImport`, add:

```tsx
  /** The explorer's "Start from this opening": the line, with the current New-game choices. */
  const handleStartOpening = (entry: OpeningEntry) => {
    const built = gameFromSan(entry.moves)
    if (!built.ok) return
    loadMatch(buildConfig({ mode, level, timeControlId, color, engineAvailable }), built.game, false)
    setOrientation(mode === 'one-player' ? color : 'white')
    setTab('moves')
  }
```

4. Replace the whole `<div className="right-column"> … </div>` block with:

```tsx
        <div className="right-column">
          <Tabs
            active={tab}
            onChange={(id) => setTab(id as RightTab)}
            tabs={[
              {
                id: 'moves',
                label: 'Moves',
                content: (
                  <MoveList
                    moves={game.moves}
                    currentPly={game.ply}
                    onJump={handleJump}
                    disabled={snapshot.phase.kind === 'engine-thinking'}
                  />
                ),
              },
              {
                id: 'explorer',
                label: 'Explorer',
                content: (
                  <Explorer book={book} unavailable={bookFailed} current={opening} onStart={handleStartOpening} />
                ),
              },
            ]}
          />
        </div>
```

Run: `npm run typecheck && npm test` → PASS (App tests find `move-1` inside the visible Moves panel).

- [ ] **Step 4: Write the browser test**

`tests/e2e/explorer.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

const NAJDORF = 'B90 Sicilian Defense: Najdorf Variation'

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('search, pick, and start a two-player game from an opening', async ({ page }) => {
  await page.getByTestId('tab-explorer').click()
  await page.getByTestId('explorer-search').fill('Najdorf')
  await page.getByTestId('explorer-results').getByRole('button', { name: NAJDORF, exact: true }).click()
  await expect(page.getByTestId('explorer-detail')).toContainText(
    '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6',
  )
  await page.getByTestId('explorer-start').click()

  await expect(page.getByTestId('ply-count')).toHaveText('10')
  await expect(page.getByTestId('opening')).toContainText('Najdorf Variation')
  await expect(page.getByTestId('tab-moves')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('turn')).toContainText(/white/i)
  // A live game: play 6.Be3.
  await page.locator('[data-square="c1"]').click()
  await page.locator('[data-square="e3"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('11')
})

test('in one-player mode as Black, the engine continues the opening', async ({ page }) => {
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('color').selectOption('black')
  await page.getByTestId('tab-explorer').click()
  await page.getByTestId('explorer-search').fill('Najdorf')
  await page.getByTestId('explorer-results').getByRole('button', { name: NAJDORF, exact: true }).click()
  await page.getByTestId('explorer-start').click()
  await expect(page.getByTestId('ply-count')).toHaveText('11', { timeout: 30_000 })
  await expect(page.getByTestId('turn')).toContainText(/black/i)
})
```

- [ ] **Step 5: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/explorer.spec.ts`
Expected: PASS. Then replace `buildConfig({ mode, … })` in `handleStartOpening` with a hard-coded two-player config: the second test must FAIL (no engine reply). Restore.

- [ ] **Step 6: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(ui): right-column tabs and an opening explorer that starts games from a line

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Engine book moves

**Complexity:** judgment (RNG consumption order and staleness must stay exact).

**Files:**
- Modify: `src/engine/strength.ts`, `src/engine/strength.test.ts`
- Modify: `src/match/controller.ts`, `src/match/controller.test.ts`
- Modify: `src/ui/App.tsx`
- Create: `tests/e2e/book-moves.spec.ts`

**Interfaces:**
- Consumes: `OpeningBook.continuations(epd)` (T8), `Position.epd()` (T7), the controller's injected `random`.
- Produces:
  - `StrengthProfile.bookChance: number` — levels 1–3: `0.9`, 4–6: `0.5`, 7–8: `0`.
  - `interface BookSource { continuations(epd: string): readonly string[] }` (controller.ts); `MatchController.setBook(book: BookSource | null): void`.
  - `chooseBookMove(continuations: readonly string[], bookChance: number, random: () => number): string | null` — RNG is consumed ONLY when a book move is possible: nothing if there are no continuations or `bookChance` is 0; otherwise one draw for "use the book?" and, on yes, one draw for the index (`Math.floor(r * n)`, uniform over the dataset's distinct continuations).

A book move skips the search entirely but still resolves asynchronously after the zero-player delay (`engineDelayMs`, 0 by default), so the `engine-thinking` phase is emitted first and every `requestId` staleness path applies unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/strength.test.ts`:

```ts
test('book preference: heavy at 1-3, even at 4-6, never at 7-8', () => {
  expect(ALL.map((l) => profileFor(l).bookChance)).toEqual([0.9, 0.9, 0.9, 0.5, 0.5, 0.5, 0, 0])
})
```

Append to `src/match/controller.test.ts` (top-level, after the main describe; add `chooseBookMove` to the controller import):

```ts
describe('chooseBookMove', () => {
  test('no continuations or no chance: null, and no randomness consumed', () => {
    const random = vi.fn(() => 0)
    expect(chooseBookMove([], 0.9, random)).toBeNull()
    expect(chooseBookMove(['e2e4'], 0, random)).toBeNull()
    expect(random).not.toHaveBeenCalled()
  })
  test('a draw at or above the chance declines the book (one draw only)', () => {
    const random = vi.fn(() => 0.9)
    expect(chooseBookMove(['e2e4', 'd2d4'], 0.9, random)).toBeNull()
    expect(random).toHaveBeenCalledTimes(1)
  })
  test('otherwise a second draw picks uniformly among the continuations', () => {
    const seq = [0.1, 0.75]
    expect(chooseBookMove(['e2e4', 'd2d4', 'c2c4', 'g1f3'], 0.9, () => seq.shift() ?? 0)).toBe('c2c4')
  })
})

describe('book moves in the controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const AFTER_E4_EPD = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
  const book = { continuations: (epd: string) => (epd === AFTER_E4_EPD ? ['c7c5'] : []) }
  const LEVEL_1_BLACK: MatchConfig = {
    white: { kind: 'human' },
    black: { kind: 'engine', level: 1 },
    timeControl: { kind: 'untimed' },
    engineDelayMs: 0,
  }

  test('an in-book position at a low level plays the book without searching', async () => {
    const e = fakeEngine()
    const seq = [0.1, 0]
    const c = new MatchController({ engine: e.client, random: () => seq.shift() ?? 0.99 })
    c.setBook(book)
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    expect(c.snapshot().phase.kind).toBe('engine-thinking') // still asynchronous
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'c5'])
    expect(e.calls).toHaveLength(0)
  })

  test('a declined draw searches as usual', async () => {
    const e = fakeEngine()
    const seq = [0.95] // >= 0.9: no book; then 0.99s: no blunder
    const c = new MatchController({ engine: e.client, random: () => seq.shift() ?? 0.99 })
    c.setBook(book)
    c.start(LEVEL_1_BLACK)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
  })

  test('level 8 never uses the book and draws no randomness for it', async () => {
    const e = fakeEngine()
    const random = vi.fn(() => 0)
    const c = new MatchController({ engine: e.client, random })
    c.setBook(book)
    c.start({ ...LEVEL_1_BLACK, black: { kind: 'engine', level: 8 } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(e.calls).toHaveLength(1)
    expect(random).not.toHaveBeenCalled()
  })

  test('a book move pending behind the speed delay is dropped by a new game', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client, random: () => 0 })
    c.setBook(book)
    c.start({ ...LEVEL_1_BLACK, engineDelayMs: 500 })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    c.start({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } })
    await vi.advanceTimersByTimeAsync(600)
    expect(c.snapshot().game.moves).toHaveLength(0)
  })
})
```

Run: `npx vitest run src/engine/strength.test.ts src/match` → FAIL (`bookChance` undefined; `chooseBookMove`/`setBook` missing).

- [ ] **Step 2: Implement**

In `src/engine/strength.ts`: add to `StrengthProfile`

```ts
  /** Probability of playing a dataset continuation when the position is in book (spec: 1–3 prefer it heavily). */
  bookChance: number
```

and add `bookChance` to each LEVELS row: levels 1, 2, 3 → `bookChance: 0.9`; 4, 5, 6 → `bookChance: 0.5`; 7, 8 → `bookChance: 0`.

In `src/match/controller.ts`, below `EngineLike`:

```ts
/** Where book moves come from (OpeningBook satisfies this structurally). */
export interface BookSource {
  continuations(epd: string): readonly string[]
}

/**
 * Decide whether to play from the opening book, and which continuation.
 * Randomness is drawn only when a book move is actually possible, so levels
 * and positions without a book leave the blunder RNG sequence untouched.
 */
export function chooseBookMove(
  continuations: readonly string[],
  bookChance: number,
  random: () => number,
): string | null {
  if (continuations.length === 0 || bookChance <= 0) return null
  if (random() >= bookChance) return null
  const index = Math.min(continuations.length - 1, Math.floor(random() * continuations.length))
  return continuations[index] ?? null
}
```

Add a field `private book: BookSource | null = null` and, after `analyze()`:

```ts
  /** The opening book loads asynchronously; until then (or without one) engines always search. */
  setBook(book: BookSource | null): void {
    this.book = book
  }
```

In `askEngine`, as the FIRST statements inside the `try {` block:

```ts
      const bookMove = this.book
        ? chooseBookMove(this.book.continuations(this.livePosition().epd()), profile.bookChance, this.random)
        : null
      if (bookMove !== null) {
        // Still asynchronous: 'engine-thinking' is emitted first, the speed
        // slider still paces zero-player games, and a stale id drops it.
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
        this.applyEngineMove(bookMove, side, level, id)
        return
      }
```

(`applyEngineMove` still validates through `game-core`; an unplayable book move follows the existing illegal-move path.)

- [ ] **Step 3: Wire App**

In `src/ui/App.tsx`, after `const { book, failed: bookFailed } = useOpeningBook()`:

```tsx
  useEffect(() => {
    controller.setBook(book)
  }, [controller, book])
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 4: Write the browser test**

`tests/e2e/book-moves.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

const START_EPD = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'

test('a level-1 engine opens with a book move (deterministic RNG)', async ({ page }) => {
  await coachOffline(page)
  // Math.random() = 0: "use the book" (0 < 0.9) and continuation index 0, every time.
  await page.addInitScript(() => {
    Math.random = () => 0
  })
  await page.goto('/')

  const data = (await (await page.request.get('/openings/openings.json')).json()) as {
    positions: Record<string, [number, string[]]>
  }
  const first = data.positions[START_EPD]?.[1][0]
  expect(first).toMatch(/^[a-h][1-8][a-h][1-8]$/)

  // Wait until the app has loaded the book: the explorer lists openings only then.
  await page.getByTestId('tab-explorer').click()
  await expect(page.getByTestId('explorer-results')).toBeVisible()
  await page.getByTestId('tab-moves').click()

  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('color').selectOption('black')
  await page.getByTestId('new-game').click()

  await expect(page.getByTestId('ply-count')).toHaveText('1', { timeout: 30_000 })
  await expect(page.locator(`[data-square="${first!.slice(2, 4)}"] [data-piece]`)).toHaveCount(1)
  await expect(page.locator(`[data-square="${first!.slice(0, 2)}"] [data-piece]`)).toHaveCount(0)
})
```

- [ ] **Step 5: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/book-moves.spec.ts`
Expected: PASS. Then comment out the `controller.setBook(book)` effect: the engine searches instead and (with RNG 0 forcing its blunder path) plays a Stockfish move that is not the dataset's first continuation — the spec FAILS. Restore.

- [ ] **Step 6: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(engine): book moves from the openings dataset, weighted by level

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: Review math — classification and Lichess accuracy

**Complexity:** judgment (formula fidelity; the fixture numbers below were computed independently from the published formulas and must not be "adjusted" to make tests pass).

**Files:**
- Create: `src/review/analysis.ts`, `src/review/analysis.test.ts`

**Interfaces:**
- Consumes: `WhiteEval`, `whiteWinPercent` (T4), `Color`.
- Produces:
  - `type MoveClass = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder'`; `THRESHOLDS = { inaccuracy: 10, mistake: 20, blunder: 30 }`
  - `moverWinPercent(e: WhiteEval, mover: Color): number`
  - `classifyLoss(loss: number): MoveClass` (never `'best'`)
  - `classifyMove({ before, after, mover, playedUci, bestUci }): { classification: MoveClass; loss: number }`
  - `moveAccuracy(before: number, after: number): number` (mover-POV win%, 0..100)
  - `gameAccuracy(whiteWinPercents: readonly number[], firstMover: Color): { w: number | null; b: number | null }` (positions 0..n, White POV)

Formulas (Lichess, `lila` `WinPercent` / `AccuracyPercent`):
- win% = `50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`, cp clamped to ±1000 (T4); mate → 100/0.
- Move loss = mover's win% before − after (≥ 0). **Inaccuracy ≥ 10, mistake ≥ 20, blunder ≥ 30.** A move equal to the engine's best is `best` regardless of eval noise.
- Per-move accuracy = `103.1668100711649 * exp(-0.04354415386753951 * (before − after)) − 3.166924740191411`, `+1` uncertainty bonus, clamped 0..100; 100 if the mover did not lose win%.
- Game accuracy per side = (volatility-weighted mean + harmonic mean) / 2. Window size = `clamp(floor(n / 10), 2, 8)` for n moves; windows = (size − 2) copies of the first window, then every sliding window of that size over the n+1 win% values (exactly n windows); weight = population std-dev of the window clamped to [0.5, 12]. Harmonic mean floors each accuracy at 1 (lila's `Maths.harmonicMean`), so a 0% move cannot divide by zero.

- [ ] **Step 1: Write the failing tests**

`src/review/analysis.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { classifyLoss, classifyMove, gameAccuracy, moveAccuracy, moverWinPercent } from './analysis'

describe('classification (Lichess win% thresholds)', () => {
  test('thresholds are inclusive at 10 / 20 / 30', () => {
    expect(classifyLoss(9.99)).toBe('ok')
    expect(classifyLoss(10)).toBe('inaccuracy')
    expect(classifyLoss(19.99)).toBe('inaccuracy')
    expect(classifyLoss(20)).toBe('mistake')
    expect(classifyLoss(30)).toBe('blunder')
  })

  test('win% is taken from the mover\'s side', () => {
    expect(moverWinPercent({ kind: 'cp', cp: 0 }, 'b')).toBe(50)
    expect(moverWinPercent({ kind: 'mate', mate: 2 }, 'b')).toBe(0)
    expect(moverWinPercent({ kind: 'result', winner: 'b' }, 'b')).toBe(100)
  })

  test('allowing mate is a blunder; the engine\'s own move is best', () => {
    const blunder = classifyMove({
      before: { kind: 'cp', cp: 50 }, // White +0.5, Black to move
      after: { kind: 'mate', mate: 1 }, // now White mates
      mover: 'b',
      playedUci: 'g8f6',
      bestUci: 'g7g6',
    })
    expect(blunder.classification).toBe('blunder')
    expect(blunder.loss).toBeCloseTo(45.4104, 3)

    expect(
      classifyMove({
        before: { kind: 'mate', mate: 1 },
        after: { kind: 'result', winner: 'w' },
        mover: 'w',
        playedUci: 'h5f7',
        bestUci: 'h5f7',
      }),
    ).toEqual({ classification: 'best', loss: 0 })
  })

  test('an improvement is never a loss', () => {
    expect(
      classifyMove({ before: { kind: 'cp', cp: 0 }, after: { kind: 'cp', cp: 300 }, mover: 'w', playedUci: 'a', bestUci: 'b' }),
    ).toEqual({ classification: 'ok', loss: 0 })
  })
})

describe('accuracy (Lichess)', () => {
  test('per-move accuracy', () => {
    expect(moveAccuracy(50, 50)).toBe(100)
    expect(moveAccuracy(40, 60)).toBe(100)
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.5798, 3)
    expect(moveAccuracy(50, 10)).toBeCloseTo(15.909, 3)
    expect(moveAccuracy(90, 0)).toBe(0) // clamped
  })

  test('game accuracy: a known sequence', () => {
    // Moves: W 50->40 (loss 10), B 60->55 (loss 5), W 45->30 (loss 15), B 70->30 (loss 40).
    const acc = gameAccuracy([50, 40, 45, 30, 70], 'w')
    expect(acc.w).toBeCloseTo(57.0302, 3)
    expect(acc.b).toBeCloseTo(26.8422, 3)
  })

  test('game accuracy: perfect play by one side, one blunder by the other', () => {
    const acc = gameAccuracy([50, 50, 90], 'w')
    expect(acc.w).toBe(100)
    expect(acc.b).toBeCloseTo(15.909, 3)
  })

  test('sides with no moves get null', () => {
    expect(gameAccuracy([50], 'w')).toEqual({ w: null, b: null })
    const one = gameAccuracy([50, 40], 'w')
    expect(one.w).toBeCloseTo(64.5798, 3)
    expect(one.b).toBeNull()
  })

  test('a Black-first game assigns the first move to Black', () => {
    const acc = gameAccuracy([50, 60, 60], 'b') // Black's move: White 50->60 = Black 50->40
    expect(acc.b).toBeCloseTo(64.5798, 3)
    expect(acc.w).toBe(100)
  })
})
```

Run: `npx vitest run src/review/analysis.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement**

`src/review/analysis.ts`:

```ts
import { whiteWinPercent, type WhiteEval } from '../engine/evaluation'
import type { Color } from '../game-core/types'

export type MoveClass = 'best' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder'

/** Win-percentage points lost (Lichess). */
export const THRESHOLDS = { inaccuracy: 10, mistake: 20, blunder: 30 } as const

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function moverWinPercent(e: WhiteEval, mover: Color): number {
  const white = whiteWinPercent(e)
  return mover === 'w' ? white : 100 - white
}

export function classifyLoss(loss: number): MoveClass {
  if (loss >= THRESHOLDS.blunder) return 'blunder'
  if (loss >= THRESHOLDS.mistake) return 'mistake'
  if (loss >= THRESHOLDS.inaccuracy) return 'inaccuracy'
  return 'ok'
}

export function classifyMove(opts: {
  before: WhiteEval
  after: WhiteEval
  mover: Color
  playedUci: string
  bestUci: string | null
}): { classification: MoveClass; loss: number } {
  const loss = Math.max(0, moverWinPercent(opts.before, opts.mover) - moverWinPercent(opts.after, opts.mover))
  if (opts.bestUci !== null && opts.playedUci === opts.bestUci) return { classification: 'best', loss }
  return { classification: classifyLoss(loss), loss }
}

/** Lichess per-move accuracy from the mover's win% before and after. */
export function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411
  return clamp(raw + 1, 0, 100) // +1: lila's uncertainty bonus
}

function stdDev(xs: readonly number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}

/**
 * Lichess game accuracy per side. `whiteWinPercents[i]` is White's win% in
 * the position after i moves (i = 0 is the start), so move i goes from
 * index i-1 to i.
 */
export function gameAccuracy(
  whiteWinPercents: readonly number[],
  firstMover: Color,
): { w: number | null; b: number | null } {
  const n = whiteWinPercents.length - 1
  if (n < 1) return { w: null, b: null }

  const size = clamp(Math.floor(n / 10), 2, 8)
  const windows: number[][] = []
  const first = whiteWinPercents.slice(0, size)
  for (let i = 0; i < Math.min(size, whiteWinPercents.length) - 2; i++) windows.push(first)
  for (let i = 0; i + size <= whiteWinPercents.length; i++) windows.push(whiteWinPercents.slice(i, i + size))
  const weights = windows.map((w) => clamp(stdDev(w), 0.5, 12))

  const perSide: Record<Color, Array<{ acc: number; weight: number }>> = { w: [], b: [] }
  for (let i = 1; i <= n; i++) {
    const mover: Color = ((i - 1) % 2 === 0) === (firstMover === 'w') ? 'w' : 'b'
    const prev = whiteWinPercents[i - 1] ?? 50
    const next = whiteWinPercents[i] ?? 50
    const acc = mover === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next)
    perSide[mover].push({ acc, weight: weights[i - 1] ?? 0.5 })
  }

  const side = (xs: Array<{ acc: number; weight: number }>): number | null => {
    if (xs.length === 0) return null
    const weighted = xs.reduce((s, x) => s + x.acc * x.weight, 0) / xs.reduce((s, x) => s + x.weight, 0)
    const harmonic = xs.length / xs.reduce((s, x) => s + 1 / Math.max(1, x.acc), 0)
    return (weighted + harmonic) / 2
  }
  return { w: side(perSide.w), b: side(perSide.b) }
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/review`
Expected: PASS. Prove the window logic is exercised: change the weight clamp's upper bound from 12 to 20 — "game accuracy: a known sequence" must FAIL. Restore.

- [ ] **Step 4: Commit**

(No UI in this task: its deliverable is pure math consumed by Task 12, whose e2e covers it in the browser.)

```bash
git add src/review
git commit -m "feat(review): Lichess win%-loss classification and accuracy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Post-game review — runner, marks, arrows, summary

**Complexity:** integration.

**Files:**
- Create: `src/review/run.ts`, `src/review/run.test.ts`
- Create: `src/review/summary.ts`, `src/review/summary.test.ts`
- Create: `src/match/result.ts`, `src/match/result.test.ts`
- Create: `src/ui/review/reviewView.ts`, `src/ui/review/reviewView.test.ts`, `src/ui/review/useReview.ts`, `src/ui/review/ReviewPanel.tsx`
- Modify: `src/ui/panels/MoveList.tsx`, `src/ui/panels/MoveList.test.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Create: `tests/e2e/review.spec.ts`

**Interfaces:**
- Consumes: `classifyMove`, `gameAccuracy`, `MoveClass` (T11); `evalFromLines`, `whiteWinPercent`, `WhiteEval` (T4); `principalLine`, `uciToIntent`; `uciOf` (T7); `controller.analyze` via App's `analyzeForEval` (T4); `CoachClient.review` (T6); `ReviewRequest`, `LIMITS` (T5); `moveLabel` (T5); `Annotation` (T2); `parseReviewRequest` (server, contract test only).
- Produces:
  - `REVIEW_BUDGET = { depth: 12, moveTimeMs: 150, multiPv: 1 }`; `type ReviewAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>`
  - `interface ReviewedMove { ply; san; uci; mover: Color; classification: MoveClass; loss: number; bestUci: string | null; bestSan: string | null }`
  - `interface GameReview { firstMover: Color; evals: WhiteEval[]; moves: ReviewedMove[]; accuracy: { w: number | null; b: number | null } }`
  - `interface ReviewInput { startFen: string; moves: readonly PlayedMove[]; finalStatus: GameStatus }`; `runReview(input & { analyze; signal; onProgress?; onEval? }): Promise<GameReview>`
  - `templatedSummary(review, { opening, result }): string`; `reviewRequestFrom(review, { result, opening, humanSide }): ReviewRequest`
  - `resultTagOf(phase: MatchPhase): '1-0' | '0-1' | '1/2-1/2' | '*'`; `humanSideOf(config: MatchConfig): Color | null` (match/result.ts — reused by Task 13)
  - `reviewMarks(review): Map<number, MoveClass>`, `reviewAnnotations(review, ply): Annotation[]`, `currentMoveText(review, ply): string` (ui/review/reviewView.ts)
  - `useReview({ analyze, summarize, onEval, onComplete })` → `{ state: ReviewState; start(input: ReviewInput): void; cancel(): void }`, `type ReviewState = { kind: 'idle' } | { kind: 'running'; done: number; total: number } | { kind: 'done'; review: GameReview; summary: string | null; summarySource: 'claude' | 'templated' | null } | { kind: 'error'; message: string }`
  - `MoveList` prop `marks?: ReadonlyMap<number, MoveClass>`; mark DOM `data-testid="mark-<ply>"` with `?!`, `?`, `??` (and `!` for the engine's own choice).
  - DOM: `review-start`, `review-progress`, `review-cancel`, `accuracy-w`, `accuracy-b` (numbers only), `review-summary`, `review-summary-source`, `review-current`.

**Budget ruling — depth 12, capped at 150 ms per position.** A review must finish in human time: 150 ms × (plies + 1) is ~12 s for an 80-ply game, and the move-time cap bounds the worst case even in sharp middlegames. Depth 12 is enough for the thresholds used here — 10/20/30 win-percentage points are swings of roughly 0.4–1.5 pawns around equality, far above depth-12 noise — and matches the hint budget's depth. Positions already evaluated deeper by the eval bar are NOT reused for the review (mixed depths would make the per-move deltas inconsistent); instead the review writes its evals into the eval-bar cache.

The review runs through `controller.analyze`, so it automatically yields the worker to any engine move (e.g. the user starts a new one-player game mid-review — which also cancels the review). Cancel aborts the in-flight analysis and discards partial results.

- [ ] **Step 1: Write the failing pure tests**

`src/match/result.test.ts`:

```ts
import { expect, test } from 'vitest'
import { humanSideOf, resultTagOf } from './result'

const status = { kind: 'in-progress', inCheck: false } as const

test('resultTagOf', () => {
  expect(resultTagOf({ kind: 'finished', status, reason: 'resign', winner: 'w' })).toBe('1-0')
  expect(resultTagOf({ kind: 'finished', status, reason: 'flag', winner: 'b' })).toBe('0-1')
  expect(resultTagOf({ kind: 'finished', status: { kind: 'draw', reason: 'stalemate' }, reason: 'normal', winner: null })).toBe('1/2-1/2')
  expect(resultTagOf({ kind: 'finished', status, reason: 'engine-error', winner: null })).toBe('*')
  expect(resultTagOf({ kind: 'awaiting-human', side: 'w' })).toBe('*')
})

test('humanSideOf', () => {
  const tc = { kind: 'untimed' } as const
  expect(humanSideOf({ white: { kind: 'human' }, black: { kind: 'engine', level: 3 }, timeControl: tc })).toBe('w')
  expect(humanSideOf({ white: { kind: 'engine', level: 3 }, black: { kind: 'human' }, timeControl: tc })).toBe('b')
  expect(humanSideOf({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: tc })).toBeNull()
})
```

`src/review/run.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { runReview, type ReviewAnalyze } from './run'
import { gameFromSan } from '../game-core/io'

const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']

/** Engine output per position (side-to-move POV), in position order 0..6. Position 7 is mate: never asked. */
const SCRIPT = [
  { cp: 30, pv: 'e2e4' },
  { cp: -30, pv: 'e7e5' },
  { cp: 30, pv: 'f1c4' },
  { cp: -30, pv: 'b8c6' },
  { cp: 30, pv: 'd1h5' },
  { cp: -50, pv: 'g7g6' }, // after 3.Qh5, Black to move: g6 was the move
  { mate: 1, pv: 'h5f7' }, // after 3...Nf6??, White mates in one
]

function scholar() {
  const r = gameFromSan(SCHOLAR)
  if (!r.ok) throw new Error(r.error)
  return r.game
}

describe('runReview', () => {
  test('analyses every non-terminal position once and classifies each move', async () => {
    const game = scholar()
    let call = 0
    const analyze = vi.fn<ReviewAnalyze>(async () => {
      const s = SCRIPT[call++]!
      return {
        best: s.pv,
        lines: [{ depth: 12, pv: [s.pv], ...(s.mate !== undefined ? { scoreMate: s.mate } : { scoreCp: s.cp }) }],
      }
    })
    const progress: Array<[number, number]> = []
    const cached: string[] = []
    const review = await runReview({
      startFen: game.startFen,
      moves: game.moves,
      finalStatus: game.status(),
      analyze,
      signal: new AbortController().signal,
      onProgress: (done, total) => progress.push([done, total]),
      onEval: (fen) => cached.push(fen),
    })

    expect(analyze).toHaveBeenCalledTimes(7)
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ depth: 12, moveTimeMs: 150, multiPv: 1 })
    expect(progress.at(-1)).toEqual([8, 8])
    expect(cached).toHaveLength(7)

    expect(review.evals[5]).toEqual({ kind: 'cp', cp: 50 }) // flipped to White POV
    expect(review.evals[7]).toEqual({ kind: 'result', winner: 'w' })

    const nf6 = review.moves[5]!
    expect(nf6).toMatchObject({ ply: 6, san: 'Nf6', mover: 'b', classification: 'blunder', bestUci: 'g7g6', bestSan: 'g6' })
    expect(review.moves[6]).toMatchObject({ san: 'Qxf7#', classification: 'best' })
    expect(review.moves[0]?.classification).toBe('best')
    expect(review.accuracy.b!).toBeLessThan(review.accuracy.w!)
    expect(review.firstMover).toBe('w')
  })

  test('an aborted analysis rejects the whole review', async () => {
    const game = scholar()
    const ctrl = new AbortController()
    const analyze: ReviewAnalyze = async (_req, signal) => {
      ctrl.abort()
      if (signal.aborted) throw new Error('analysis aborted')
      return { best: 'e2e4', lines: [] }
    }
    await expect(
      runReview({ startFen: game.startFen, moves: game.moves, finalStatus: game.status(), analyze, signal: ctrl.signal }),
    ).rejects.toThrow(/aborted/)
  })
})
```

`src/review/summary.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { reviewRequestFrom, templatedSummary } from './summary'
import type { GameReview } from './run'
import { parseReviewRequest } from '../../server/validate'

const REVIEW: GameReview = {
  firstMover: 'w',
  evals: [],
  accuracy: { w: 97.26, b: 41.04 },
  moves: [
    { ply: 1, san: 'e4', uci: 'e2e4', mover: 'w', classification: 'best', loss: 0, bestUci: 'e2e4', bestSan: 'e4' },
    { ply: 2, san: 'e5', uci: 'e7e5', mover: 'b', classification: 'ok', loss: 1, bestUci: 'c7c5', bestSan: 'c5' },
    { ply: 3, san: 'Bc4', uci: 'f1c4', mover: 'w', classification: 'best', loss: 0, bestUci: 'f1c4', bestSan: 'Bc4' },
    { ply: 4, san: 'Nc6', uci: 'b8c6', mover: 'b', classification: 'inaccuracy', loss: 11.2, bestUci: 'g8f6', bestSan: 'Nf6' },
    { ply: 5, san: 'Qh5', uci: 'd1h5', mover: 'w', classification: 'ok', loss: 2, bestUci: 'g1f3', bestSan: 'Nf3' },
    { ply: 6, san: 'Nf6', uci: 'g8f6', mover: 'b', classification: 'blunder', loss: 45.41, bestUci: 'g7g6', bestSan: 'g6' },
    { ply: 7, san: 'Qxf7#', uci: 'h5f7', mover: 'w', classification: 'best', loss: 0, bestUci: 'h5f7', bestSan: 'Qxf7#' },
  ],
}

describe('templatedSummary', () => {
  test('reports accuracy, error counts per side, and the turning point', () => {
    const text = templatedSummary(REVIEW, { opening: "C23 Bishop's Opening", result: '1-0' })
    expect(text).toContain('White won')
    expect(text).toContain('Accuracy: White 97%, Black 41%')
    expect(text).toContain("Opening: C23 Bishop's Opening")
    expect(text).toContain('Black: 1 inaccuracy, 0 mistakes, 1 blunder')
    expect(text).toContain('White: 0 inaccuracies, 0 mistakes, 0 blunders')
    expect(text).toContain('The turning point was 3... Nf6?? — g6 was stronger.')
  })

  test('a clean game says so', () => {
    const clean = { ...REVIEW, moves: REVIEW.moves.map((m) => ({ ...m, classification: 'best' as const })) }
    expect(templatedSummary(clean, { opening: null, result: '1/2-1/2' })).toContain('No serious mistakes')
  })
})

describe('reviewRequestFrom', () => {
  test('produces a request the server accepts', () => {
    const req = reviewRequestFrom(REVIEW, { result: '1-0', opening: "C23 Bishop's Opening", humanSide: 'b' })
    expect(req.flagged.map((f) => f.ply)).toEqual([4, 6])
    expect(req.flagged[1]).toEqual({ ply: 6, san: 'Nf6', classification: 'blunder', bestSan: 'g6', lossPct: 45.4 })
    expect(req.accuracy).toEqual({ w: 97.3, b: 41 })
    expect(parseReviewRequest(req).ok).toBe(true)
  })
})
```

`src/ui/review/reviewView.test.ts`:

```ts
import { expect, test } from 'vitest'
import { currentMoveText, reviewAnnotations, reviewMarks } from './reviewView'
import type { GameReview } from '../../review/run'

const review: GameReview = {
  firstMover: 'w',
  evals: [],
  accuracy: { w: 100, b: 20 },
  moves: [
    { ply: 1, san: 'e4', uci: 'e2e4', mover: 'w', classification: 'best', loss: 0, bestUci: 'e2e4', bestSan: 'e4' },
    { ply: 2, san: 'f6', uci: 'f7f6', mover: 'b', classification: 'mistake', loss: 22, bestUci: 'e7e5', bestSan: 'e5' },
  ],
}

test('marks every reviewed ply', () => {
  expect([...reviewMarks(review)]).toEqual([[1, 'best'], [2, 'mistake']])
})

test('a flagged move shows where it went and an arrow for the better move', () => {
  expect(reviewAnnotations(review, 2)).toEqual([
    { kind: 'square', square: 'f6', tone: 'mistake' },
    { kind: 'arrow', from: 'e7', to: 'e5', tone: 'best' },
  ])
  expect(reviewAnnotations(review, 1)).toEqual([]) // not flagged
  expect(reviewAnnotations(review, 0)).toEqual([])
  expect(reviewAnnotations(null, 2)).toEqual([])
})

test('currentMoveText explains the flagged move', () => {
  expect(currentMoveText(review, 2)).toBe('1... f6? is a mistake. Better was e5.')
  expect(currentMoveText(review, 1)).toBe('1. e4! was the engine’s choice.')
  expect(currentMoveText(review, 0)).toBe('')
})
```

Append to `src/ui/panels/MoveList.test.tsx`:

```tsx
  test('review marks are shown next to the moves', () => {
    render(
      <MoveList
        moves={[move('e4', 'w'), move('f6', 'b')]}
        currentPly={2}
        onJump={vi.fn()}
        marks={new Map([[1, 'best'], [2, 'blunder']])}
      />,
    )
    expect(screen.getByTestId('mark-1')).toHaveTextContent('!')
    expect(screen.getByTestId('mark-2')).toHaveTextContent('??')
    expect(screen.getByTestId('move-2')).toHaveTextContent('f6??')
  })
```

Run: `npx vitest run src/review src/match/result.test.ts src/ui/review src/ui/panels/MoveList.test.tsx` → FAIL.

- [ ] **Step 2: Implement the pure modules**

`src/match/result.ts`:

```ts
import type { Color } from '../game-core/types'
import type { MatchConfig, MatchPhase } from './types'

/** The PGN result of a match: decided by phase.winner, never by status alone (resign/flag). */
export function resultTagOf(phase: MatchPhase): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (phase.kind !== 'finished' || phase.reason === 'engine-error') return '*'
  return phase.winner === 'w' ? '1-0' : phase.winner === 'b' ? '0-1' : '1/2-1/2'
}

/** The single human side in a one-player game; null for two- or zero-player. */
export function humanSideOf(config: MatchConfig): Color | null {
  const w = config.white.kind === 'human'
  const b = config.black.kind === 'human'
  if (w === b) return null
  return w ? 'w' : 'b'
}
```

`src/review/run.ts`:

```ts
import { evalFromLines, whiteWinPercent, type WhiteEval } from '../engine/evaluation'
import type { AnalysisRequest, SearchOutcome } from '../engine/lane'
import { principalLine, uciToIntent } from '../engine/uci'
import { uciOf } from '../game-core/notation'
import { Position } from '../game-core/position'
import type { Color, GameStatus, PlayedMove } from '../game-core/types'
import { classifyMove, gameAccuracy, type MoveClass } from './analysis'

/** Fixed per-position budget; see the Task 12 ruling. */
export const REVIEW_BUDGET = { depth: 12, moveTimeMs: 150, multiPv: 1 } as const

export type ReviewAnalyze = (req: AnalysisRequest, signal: AbortSignal) => Promise<SearchOutcome>

export interface ReviewedMove {
  ply: number
  san: string
  uci: string
  mover: Color
  classification: MoveClass
  /** Mover's win-percentage points lost. */
  loss: number
  bestUci: string | null
  bestSan: string | null
}

export interface GameReview {
  firstMover: Color
  /** White-POV evaluation of the position after each ply (index 0 = start). */
  evals: WhiteEval[]
  moves: ReviewedMove[]
  accuracy: { w: number | null; b: number | null }
}

export interface ReviewInput {
  startFen: string
  moves: readonly PlayedMove[]
  /** The LIVE game's status: decides whether the last position is terminal. */
  finalStatus: GameStatus
}

function terminalEval(status: GameStatus): WhiteEval | null {
  if (status.kind === 'checkmate') return { kind: 'result', winner: status.winner }
  if (status.kind === 'draw') return { kind: 'result', winner: null }
  return null
}

function sanOf(fen: string, uci: string | null): string | null {
  const intent = uci ? uciToIntent(uci) : null
  if (!intent) return null
  const r = new Position(fen).tryMove(intent)
  return r.ok ? r.move.san : null
}

export async function runReview(
  opts: ReviewInput & {
    analyze: ReviewAnalyze
    signal: AbortSignal
    onProgress?: (done: number, total: number) => void
    onEval?: (fen: string, e: WhiteEval) => void
  },
): Promise<GameReview> {
  const fens = [opts.startFen, ...opts.moves.map((m) => m.fenAfter)]
  const total = fens.length
  const evals: WhiteEval[] = []
  const bests: Array<string | null> = []

  for (let i = 0; i < total; i++) {
    const fen = fens[i] ?? opts.startFen
    const terminal = i === total - 1 ? terminalEval(opts.finalStatus) : null
    if (terminal) {
      evals.push(terminal)
      bests.push(null)
    } else {
      const out = await opts.analyze({ fen, ...REVIEW_BUDGET }, opts.signal)
      const turn: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w'
      const e: WhiteEval = evalFromLines(out.lines, turn) ?? { kind: 'cp', cp: 0 }
      evals.push(e)
      bests.push(principalLine(out.lines)?.pv[0] ?? (out.best && out.best !== '(none)' ? out.best : null))
      opts.onEval?.(fen, e)
    }
    opts.onProgress?.(i + 1, total)
  }

  const firstMover: Color = opts.moves[0]?.color ?? (opts.startFen.split(' ')[1] === 'b' ? 'b' : 'w')
  const moves: ReviewedMove[] = opts.moves.map((m, idx) => {
    const ply = idx + 1
    const bestUci = bests[idx] ?? null
    const uci = uciOf(m)
    const before = evals[idx] ?? { kind: 'cp', cp: 0 }
    const after = evals[ply] ?? before
    const { classification, loss } = classifyMove({ before, after, mover: m.color, playedUci: uci, bestUci })
    return { ply, san: m.san, uci, mover: m.color, classification, loss, bestUci, bestSan: sanOf(fens[idx] ?? opts.startFen, bestUci) }
  })

  return { firstMover, evals, moves, accuracy: gameAccuracy(evals.map(whiteWinPercent), firstMover) }
}
```

`src/review/summary.ts`:

```ts
import { LIMITS, type FlaggedClass, type ReviewRequest } from '../coach/protocol'
import type { Color } from '../game-core/types'
import { moveLabel } from './moveNumber'
import type { GameReview, ReviewedMove } from './run'

export const MARK: Record<string, string> = { best: '!', inaccuracy: '?!', mistake: '?', blunder: '??' }
const FLAGGED: readonly FlaggedClass[] = ['inaccuracy', 'mistake', 'blunder']

const isFlagged = (m: ReviewedMove): m is ReviewedMove & { classification: FlaggedClass } =>
  (FLAGGED as readonly string[]).includes(m.classification)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function counts(review: GameReview, side: Color): string {
  const of = (c: FlaggedClass) => review.moves.filter((m) => m.mover === side && m.classification === c).length
  return `${plural(of('inaccuracy'), 'inaccuracy', 'inaccuracies')}, ${plural(of('mistake'), 'mistake', 'mistakes')}, ${plural(of('blunder'), 'blunder', 'blunders')}`
}

const RESULT_TEXT: Record<string, string> = {
  '1-0': 'White won.',
  '0-1': 'Black won.',
  '1/2-1/2': 'The game was drawn.',
  '*': 'The game was not finished.',
}

/** The no-network summary: only facts the review itself established. */
export function templatedSummary(review: GameReview, opts: { opening: string | null; result: string }): string {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x)}%`)
  const parts = [
    RESULT_TEXT[opts.result] ?? '',
    `Accuracy: White ${pct(review.accuracy.w)}, Black ${pct(review.accuracy.b)}.`,
  ]
  if (opts.opening) parts.push(`Opening: ${opts.opening}.`)
  parts.push(`White: ${counts(review, 'w')}. Black: ${counts(review, 'b')}.`)
  const worst = review.moves.filter(isFlagged).sort((a, b) => b.loss - a.loss)[0]
  if (worst) {
    const label = moveLabel(worst.ply, `${worst.san}${MARK[worst.classification] ?? ''}`, review.firstMover)
    parts.push(`The turning point was ${label}${worst.bestSan ? ` — ${worst.bestSan} was stronger` : ''}.`)
  } else {
    parts.push('No serious mistakes by either side.')
  }
  return parts.filter(Boolean).join(' ')
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function reviewRequestFrom(
  review: GameReview,
  opts: { result: ReviewRequest['result']; opening: string | null; humanSide: Color | null },
): ReviewRequest {
  const flagged = review.moves
    .filter(isFlagged)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, LIMITS.maxFlagged)
    .sort((a, b) => a.ply - b.ply)
    .map((m) => ({ ply: m.ply, san: m.san, classification: m.classification, bestSan: m.bestSan, lossPct: round1(Math.min(100, m.loss)) }))
  return {
    moves: review.moves.slice(0, LIMITS.maxMoves).map((m) => m.san),
    firstMover: review.firstMover,
    result: opts.result,
    opening: opts.opening ? opts.opening.slice(0, LIMITS.maxOpeningName) : null,
    accuracy: {
      w: review.accuracy.w === null ? null : round1(review.accuracy.w),
      b: review.accuracy.b === null ? null : round1(review.accuracy.b),
    },
    flagged: flagged.filter((f) => f.ply <= LIMITS.maxMoves),
    humanSide: opts.humanSide,
  }
}
```

`src/ui/review/reviewView.ts`:

```ts
import { uciToIntent } from '../../engine/uci'
import type { Square } from '../../game-core/types'
import type { MoveClass } from '../../review/analysis'
import { moveLabel } from '../../review/moveNumber'
import type { GameReview } from '../../review/run'
import { MARK } from '../../review/summary'
import type { Annotation } from '../Board/annotations'

export function reviewMarks(review: GameReview): Map<number, MoveClass> {
  return new Map(review.moves.map((m) => [m.ply, m.classification]))
}

/** On a flagged move: tint where it went, and an arrow for the engine's better move from the position before. */
export function reviewAnnotations(review: GameReview | null, ply: number): Annotation[] {
  const m = review && ply >= 1 ? review.moves[ply - 1] : undefined
  if (!m || (m.classification !== 'inaccuracy' && m.classification !== 'mistake' && m.classification !== 'blunder')) {
    return []
  }
  const out: Annotation[] = [{ kind: 'square', square: m.uci.slice(2, 4) as Square, tone: m.classification }]
  const best = m.bestUci ? uciToIntent(m.bestUci) : null
  if (best) out.push({ kind: 'arrow', from: best.from, to: best.to, tone: 'best' })
  return out
}

const NAME: Record<MoveClass, string> = {
  best: 'best', ok: 'ok', inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder',
}

export function currentMoveText(review: GameReview, ply: number): string {
  const m = ply >= 1 ? review.moves[ply - 1] : undefined
  if (!m) return ''
  const label = moveLabel(m.ply, `${m.san}${MARK[m.classification] ?? ''}`, review.firstMover)
  if (m.classification === 'best') return `${label} was the engine’s choice.`
  if (m.classification === 'ok') return `${label} — fine.${m.bestSan ? ` The engine preferred ${m.bestSan}.` : ''}`
  return `${label} is ${NAME[m.classification]}.${m.bestSan ? ` Better was ${m.bestSan}.` : ''}`
}
```

In `src/ui/panels/MoveList.tsx`: add `import type { MoveClass } from '../../review/analysis'` and `import { MARK } from '../../review/summary'`; add the prop

```tsx
  /** Post-game review classifications by ply. */
  marks?: ReadonlyMap<number, MoveClass>
```

(to both destructuring and type), and replace the `entry` helper with:

```tsx
  const entry = (e?: { san: string; ply: number }) => {
    if (!e) return <span className="move empty">…</span>
    const mark = marks?.get(e.ply)
    const symbol = mark ? MARK[mark] : undefined
    return (
      <button
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => jump(e.ply)}
        disabled={disabled}
      >
        {e.san}
        {symbol ? (
          <span className={`mark mark-${mark}`} data-testid={`mark-${e.ply}`} title={mark}>
            {symbol}
          </span>
        ) : null}
      </button>
    )
  }
```

Run: `npx vitest run src/review src/match src/ui/review src/ui/panels` → PASS.

- [ ] **Step 3: The hook and the panel**

`src/ui/review/useReview.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WhiteEval } from '../../engine/evaluation'
import { runReview, type GameReview, type ReviewAnalyze, type ReviewInput } from '../../review/run'

export type ReviewState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'done'; review: GameReview; summary: string | null; summarySource: 'claude' | 'templated' | null }
  | { kind: 'error'; message: string }

export type Summarize = (review: GameReview, signal: AbortSignal) => Promise<{ text: string; source: 'claude' | 'templated' }>

export function useReview(deps: {
  analyze: ReviewAnalyze | null
  summarize: Summarize
  onEval: (fen: string, e: WhiteEval) => void
  onComplete: (review: GameReview) => void
}) {
  const [state, setState] = useState<ReviewState>({ kind: 'idle' })
  const ctrlRef = useRef<AbortController | null>(null)
  // The latest callbacks, without restarting a running review when they change.
  const depsRef = useRef(deps)
  depsRef.current = deps

  const cancel = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setState({ kind: 'idle' })
  }, [])

  useEffect(() => () => ctrlRef.current?.abort(), [])

  const start = useCallback((input: ReviewInput) => {
    const analyze = depsRef.current.analyze
    if (!analyze) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const total = input.moves.length + 1
    setState({ kind: 'running', done: 0, total })

    runReview({
      ...input,
      analyze,
      signal: ctrl.signal,
      onProgress: (done) => {
        if (!ctrl.signal.aborted) setState({ kind: 'running', done, total })
      },
      onEval: (fen, e) => depsRef.current.onEval(fen, e),
    })
      .then(async (review) => {
        if (ctrl.signal.aborted) return
        setState({ kind: 'done', review, summary: null, summarySource: null })
        depsRef.current.onComplete(review)
        const s = await depsRef.current.summarize(review, ctrl.signal)
        if (!ctrl.signal.aborted) setState({ kind: 'done', review, summary: s.text, summarySource: s.source })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ kind: 'error', message: 'The review could not be completed: the engine is unavailable.' })
      })
  }, [])

  return { state, start, cancel }
}
```

`src/ui/review/ReviewPanel.tsx`:

```tsx
import type { ReviewState } from './useReview'

const fmt = (x: number | null) => (x === null ? '—' : x.toFixed(1))

export function ReviewPanel({
  state,
  canReview,
  currentText,
  onStart,
  onCancel,
}: {
  state: ReviewState
  canReview: boolean
  /** Explanation of the displayed move, when reviewed. */
  currentText: string
  onStart: () => void
  onCancel: () => void
}) {
  if (state.kind === 'running') {
    return (
      <div className="review" data-testid="review">
        <progress data-testid="review-progress" value={state.done} max={state.total} />
        <span className="review-count">
          Analysing {state.done}/{state.total}
        </span>
        <button type="button" data-testid="review-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  if (state.kind === 'done') {
    return (
      <div className="review" data-testid="review">
        <p>
          White accuracy: <span data-testid="accuracy-w">{fmt(state.review.accuracy.w)}</span>%
        </p>
        <p>
          Black accuracy: <span data-testid="accuracy-b">{fmt(state.review.accuracy.b)}</span>%
        </p>
        <p className="review-current" data-testid="review-current">
          {currentText}
        </p>
        <p className="review-summary" data-testid="review-summary">
          {state.summary ?? 'Writing the summary…'}
        </p>
        {state.summarySource ? (
          <p className="review-source" data-testid="review-summary-source">
            {state.summarySource === 'claude' ? 'Summary by Claude' : 'Built-in summary'}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="review" data-testid="review">
      {state.kind === 'error' ? <p className="review-error">{state.message}</p> : null}
      <button type="button" data-testid="review-start" onClick={onStart} disabled={!canReview}>
        Review game
      </button>
      {!canReview ? <p className="review-hint">Finish a game to review it.</p> : null}
    </div>
  )
}
```

Append to `src/ui/app.css`:

```css
.review { display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.review p { margin: 0; }
.review-summary { white-space: pre-wrap; }
.review-source, .review-hint { font-size: 0.8em; color: var(--color-muted); }
.review-error { color: var(--color-error); }
.mark { margin-left: 2px; font-weight: 700; }
.mark-best { color: #27ae60; }
.mark-inaccuracy { color: #b8860b; }
.mark-mistake { color: #e67e22; }
.mark-blunder { color: #e74c3c; }
```

- [ ] **Step 4: Wire App**

In `src/ui/App.tsx`:

1. Imports:

```tsx
import { useReview, type Summarize } from './review/useReview'
import { ReviewPanel } from './review/ReviewPanel'
import { currentMoveText, reviewAnnotations, reviewMarks } from './review/reviewView'
import { reviewRequestFrom, templatedSummary } from '../review/summary'
import { humanSideOf, resultTagOf } from '../match/result'
```

2. After the `opening` memo, add the FINAL opening (for summaries and history):

```tsx
  const liveSanKey = game.moves.map((m) => m.san).join(' ')
  const finalOpening = useMemo(
    () => (book ? book.identify(game.epds(Math.min(game.livePly, book.maxPly))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, game, liveSanKey],
  )
  const finalOpeningName = finalOpening ? `${finalOpening.eco} ${finalOpening.name}` : null
```

3. After `hints` is defined, add:

```tsx
  const summarizeReview = useCallback<Summarize>(
    async (review, signal) => {
      const result = resultTagOf(snapshot.phase)
      const fallback = templatedSummary(review, { opening: finalOpeningName, result })
      const text = await coach.review(
        reviewRequestFrom(review, { result, opening: finalOpeningName, humanSide: humanSideOf(snapshot.config) }),
        signal,
      )
      return text ? { text, source: 'claude' } : { text: fallback, source: 'templated' }
    },
    [snapshot.phase, snapshot.config, finalOpeningName, coach],
  )

  const review = useReview({
    analyze: analyzeForEval,
    summarize: summarizeReview,
    onEval: (fen, e) => evalCache.set(fen, e),
    onComplete: () => {},
  })
  const reviewed = review.state.kind === 'done' ? review.state.review : null

  // A new or loaded game invalidates any review (and frees the engine).
  const cancelReview = review.cancel
  useEffect(() => {
    cancelReview()
  }, [game, cancelReview])

  const handleReview = () =>
    review.start({ startFen: game.startFen, moves: game.moves, finalStatus: game.status() })
```

4. `<Board … annotations={hints.annotations} />` becomes `annotations={[...hints.annotations, ...reviewAnnotations(reviewed, game.ply)]}`.

5. The `MoveList` in the Moves tab gets `marks={reviewed ? reviewMarks(reviewed) : undefined}` (compute once: `const marks = useMemo(() => (reviewed ? reviewMarks(reviewed) : undefined), [reviewed])` next to `reviewed`, and pass `marks={marks}`).

6. Add a third tab after Explorer:

```tsx
              {
                id: 'review',
                label: 'Review',
                content: (
                  <ReviewPanel
                    state={review.state}
                    canReview={engineAvailable && snapshot.phase.kind === 'finished' && game.moves.length > 0}
                    currentText={reviewed ? currentMoveText(reviewed, game.ply) : ''}
                    onStart={handleReview}
                    onCancel={review.cancel}
                  />
                ),
              },
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 5: Write the browser test**

`tests/e2e/review.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline, coachOnline } from './helpers'

const SCHOLAR = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0'
const LEGALS_MATE = '1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0'

async function importFinished(page: Page, pgn: string) {
  await page.getByTestId('import-text').fill(pgn)
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
}

async function reviewNow(page: Page) {
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  // The source line appears only once the summary text is in (analysis + summary done).
  await expect(page.getByTestId('review-summary-source')).toBeVisible({ timeout: 60_000 })
}

test('marks the blunder, scores accuracy, draws the better move, and summarises (offline)', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await importFinished(page, SCHOLAR)
  await reviewNow(page)

  await expect(page.getByTestId('review-summary-source')).toHaveText('Built-in summary')
  await expect(page.getByTestId('review-summary')).toContainText('Accuracy: White')
  const w = Number(await page.getByTestId('accuracy-w').textContent())
  const b = Number(await page.getByTestId('accuracy-b').textContent())
  expect(b).toBeLessThan(w)

  await page.getByTestId('tab-moves').click()
  await expect(page.getByTestId('mark-6')).toHaveText('??')

  await page.getByTestId('move-6').click()
  await expect(page.locator('[data-annotation="arrow"][data-tone="best"]')).toHaveCount(1)
  await expect(page.locator('[data-annotation="square"][data-tone="blunder"]')).toHaveAttribute('data-annotation-square', 'f6')
  await page.getByTestId('tab-review').click()
  await expect(page.getByTestId('review-current')).toContainText('3... Nf6?? is a blunder')
})

test('with the server up, the summary comes from Claude and carries the flagged moves', async ({ page }) => {
  // A holder object: TS does not see assignments made inside callbacks to a plain `let`.
  const sent: { body: { flagged: Array<{ ply: number; classification: string }> } | null } = { body: null }
  await coachOnline(page, {
    review: async (route) => {
      sent.body = route.request().postDataJSON()
      await route.fulfill({ json: { text: 'MOCK review summary.' } })
    },
  })
  await page.goto('/')
  await importFinished(page, SCHOLAR)
  await reviewNow(page)
  await expect(page.getByTestId('review-summary')).toHaveText('MOCK review summary.')
  await expect(page.getByTestId('review-summary-source')).toHaveText('Summary by Claude')
  expect(sent.body?.flagged).toContainEqual(expect.objectContaining({ ply: 6, classification: 'blunder' }))
})

test('cancelling a review frees the engine for the next game', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  await importFinished(page, LEGALS_MATE)
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('review-progress')).toBeVisible()
  await page.getByTestId('review-cancel').click()
  await expect(page.getByTestId('review-start')).toBeVisible()

  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('color').selectOption('white')
  await page.getByTestId('new-game').click()
  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
})
```

- [ ] **Step 6: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/review.spec.ts`
Expected: PASS (each review of these short games takes a few seconds). Then swap `before`/`after` in `runReview`'s `classifyMove` call: the `mark-6` assertion must FAIL. Restore. Then delete `setState({ kind: 'idle' })` from `useReview`'s `cancel`: the third test must FAIL waiting for `review-start`. Restore.

- [ ] **Step 7: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(review): post-game review with move marks, best-move arrows, accuracy and a Claude summary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Persistent game history

**Complexity:** integration.

**Files:**
- Modify: `src/storage/storage.ts`, `src/storage/storage.test.ts`
- Modify: `src/match/controller.ts`, `src/match/controller.test.ts` (`finishAs`)
- Create: `src/ui/history/record.ts`, `src/ui/history/record.test.ts`, `src/ui/history/HistoryPanel.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/app.css`
- Create: `tests/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `resultTagOf` (T12), `exportPgn`/`importPgn`, `GameReview.accuracy` (T12), `finalOpeningName` (T12, App).
- Produces:
  - `interface HistoryEntry { id: string; date: string /* ISO */; result: '1-0' | '0-1' | '1/2-1/2'; termination: 'normal' | 'resign' | 'flag'; opening: string | null; pgn: string; accuracy: { w: number | null; b: number | null } | null; white: string; black: string }`
  - `HISTORY_LIMIT = 200`; `loadHistory(): HistoryEntry[]`; `addHistoryEntry(e): HistoryEntry[]`; `updateHistoryAccuracy(id, accuracy): HistoryEntry[]` — storage key `chess-game:history`, value `{ v: 1, games }`, newest first.
  - `MatchController.finishAs(reason: 'resign' | 'flag', winner: Color): void` — for replaying a stored game whose result was not a rules result.
  - `historyEntryFor({ phase, game, config, opening, now, id }): HistoryEntry | null`, `seatLabel(seat): string`, `newHistoryId(): string`
  - `<HistoryPanel entries onReplay={(e: HistoryEntry) => void} />` — `history-list`, `history-entry`, `history-empty`.

Recording rules: a game is recorded once, when its finish is observed live (not when an already-finished game is imported, resumed or replayed); `engine-error` games and games with no moves are not recorded; zero-player games are recorded (they are games). The review, when completed on the current recorded game, writes its accuracy onto that entry.

- [ ] **Step 1: Write the failing tests**

Append to `src/storage/storage.test.ts` (extend the import with `addHistoryEntry, loadHistory, updateHistoryAccuracy, HISTORY_LIMIT, type HistoryEntry`):

```ts
describe('history', () => {
  const entry = (id: string): HistoryEntry => ({
    id,
    date: '2026-09-21T10:00:00.000Z',
    result: '1-0',
    termination: 'normal',
    opening: 'B20 Sicilian Defense',
    pgn: '1. e4 c5 *',
    accuracy: null,
    white: 'Human',
    black: 'Stockfish (level 3)',
  })

  test('empty by default; newest first; versioned record', () => {
    expect(loadHistory()).toEqual([])
    addHistoryEntry(entry('a'))
    addHistoryEntry(entry('b'))
    expect(loadHistory().map((e) => e.id)).toEqual(['b', 'a'])
    expect(JSON.parse(localStorage.getItem('chess-game:history') ?? 'null')).toMatchObject({ v: 1 })
  })

  test(`capped at the newest ${HISTORY_LIMIT}`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) addHistoryEntry(entry(`g${i}`))
    const all = loadHistory()
    expect(all).toHaveLength(HISTORY_LIMIT)
    expect(all[0]?.id).toBe(`g${HISTORY_LIMIT + 4}`)
  })

  test('accuracy can be added later', () => {
    addHistoryEntry(entry('a'))
    updateHistoryAccuracy('a', { w: 91.2, b: 64 })
    expect(loadHistory()[0]?.accuracy).toEqual({ w: 91.2, b: 64 })
  })

  test('malformed entries are dropped; an unknown version reads as empty', () => {
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 1, games: [entry('ok'), { id: 3 }, null] }))
    expect(loadHistory().map((e) => e.id)).toEqual(['ok'])
    localStorage.setItem('chess-game:history', JSON.stringify({ v: 9, games: [entry('x')] }))
    expect(loadHistory()).toEqual([])
    localStorage.setItem('chess-game:history', '{broken')
    expect(loadHistory()).toEqual([])
  })
})
```

`src/ui/history/record.test.ts`:

```ts
import { expect, test } from 'vitest'
import { historyEntryFor, seatLabel } from './record'
import { gameFromSan } from '../../game-core/io'
import type { MatchConfig } from '../../match/types'

const TWO: MatchConfig = { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }
const NOW = new Date('2026-09-21T10:00:00.000Z')

function scholar() {
  const r = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  if (!r.ok) throw new Error(r.error)
  return r.game
}

test('a checkmate becomes a history entry with a PGN carrying the result', () => {
  const game = scholar()
  const e = historyEntryFor({
    phase: { kind: 'finished', status: game.status(), reason: 'normal', winner: 'w' },
    game,
    config: TWO,
    opening: "C23 Bishop's Opening",
    now: NOW,
    id: 'id-1',
  })
  expect(e).toMatchObject({ id: 'id-1', date: '2026-09-21T10:00:00.000Z', result: '1-0', termination: 'normal', accuracy: null })
  expect(e?.pgn).toContain('[Result "1-0"]')
  expect(e?.pgn).toContain('Qxf7#')
})

test('a resignation keeps its termination and winner', () => {
  const r = gameFromSan(['e4'])
  if (!r.ok) throw new Error(r.error)
  const e = historyEntryFor({
    phase: { kind: 'finished', status: r.game.status(), reason: 'resign', winner: 'w' },
    game: r.game,
    config: { ...TWO, black: { kind: 'engine', level: 5 } },
    opening: null,
    now: NOW,
    id: 'id-2',
  })
  expect(e).toMatchObject({ result: '1-0', termination: 'resign', black: 'Stockfish (level 5)' })
  expect(e?.pgn).toContain('[Black "Stockfish (level 5)"]')
})

test('engine errors and empty games are not recorded', () => {
  const game = scholar()
  expect(historyEntryFor({ phase: { kind: 'finished', status: game.status(), reason: 'engine-error', winner: null }, game, config: TWO, opening: null, now: NOW, id: 'x' })).toBeNull()
  const empty = gameFromSan([])
  if (!empty.ok) throw new Error(empty.error)
  expect(historyEntryFor({ phase: { kind: 'finished', status: empty.game.status(), reason: 'resign', winner: 'b' }, game: empty.game, config: TWO, opening: null, now: NOW, id: 'x' })).toBeNull()
})

test('seatLabel', () => {
  expect(seatLabel({ kind: 'human' })).toBe('Human')
  expect(seatLabel({ kind: 'engine', level: 2 })).toBe('Stockfish (level 2)')
})
```

Append to `src/match/controller.test.ts` inside the main describe:

```ts
  test('finishAs ends a replayed game with a non-rules result', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    c.finishAs('resign', 'w')
    expect(c.snapshot().phase).toMatchObject({ kind: 'finished', reason: 'resign', winner: 'w' })
    expect(c.submitHumanMove({ from: 'e7', to: 'e5' }).ok).toBe(false)
  })
```

Run: `npx vitest run src/storage src/ui/history src/match` → FAIL.

- [ ] **Step 2: Implement storage, finishAs, and the record builder**

Append to `src/storage/storage.ts` (and add `history: 'chess-game:history'` to `KEYS`):

```ts
export const HISTORY_LIMIT = 200

export interface HistoryEntry {
  id: string
  /** ISO 8601. */
  date: string
  result: '1-0' | '0-1' | '1/2-1/2'
  termination: 'normal' | 'resign' | 'flag'
  opening: string | null
  pgn: string
  /** Null until the game is reviewed. */
  accuracy: { w: number | null; b: number | null } | null
  white: string
  black: string
}

const RESULTS = ['1-0', '0-1', '1/2-1/2'] as const
const TERMINATIONS = ['normal', 'resign', 'flag'] as const

function numOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

function parseHistoryEntry(v: unknown): HistoryEntry | null {
  if (!isRecord(v)) return null
  const { id, date, result, termination, opening, pgn, accuracy, white, black } = v
  if (typeof id !== 'string' || typeof date !== 'string' || typeof pgn !== 'string') return null
  if (typeof white !== 'string' || typeof black !== 'string') return null
  if (!RESULTS.includes(result as HistoryEntry['result'])) return null
  if (!TERMINATIONS.includes(termination as HistoryEntry['termination'])) return null
  if (opening !== null && typeof opening !== 'string') return null
  let acc: HistoryEntry['accuracy'] = null
  if (accuracy !== null) {
    if (!isRecord(accuracy) || !numOrNull(accuracy['w']) || !numOrNull(accuracy['b'])) return null
    acc = { w: accuracy['w'] as number | null, b: accuracy['b'] as number | null }
  }
  return {
    id,
    date,
    result: result as HistoryEntry['result'],
    termination: termination as HistoryEntry['termination'],
    opening,
    pgn,
    accuracy: acc,
    white,
    black,
  }
}

/** Finished games, newest first. Unknown versions and malformed entries read as absent. */
export function loadHistory(): HistoryEntry[] {
  const raw = readJson(KEYS.history)
  if (!isRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['games'])) return []
  return raw['games'].map(parseHistoryEntry).filter((e): e is HistoryEntry => e !== null)
}

function saveHistory(games: HistoryEntry[]): HistoryEntry[] {
  const capped = games.slice(0, HISTORY_LIMIT)
  writeJson(KEYS.history, { v: 1, games: capped })
  return capped
}

export function addHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  return saveHistory([entry, ...loadHistory().filter((e) => e.id !== entry.id)])
}

export function updateHistoryAccuracy(id: string, accuracy: { w: number | null; b: number | null }): HistoryEntry[] {
  return saveHistory(loadHistory().map((e) => (e.id === id ? { ...e, accuracy } : e)))
}
```

In `src/match/controller.ts`, after `resign()`:

```ts
  /**
   * End the match with a result the rules did not produce — used to replay a
   * stored game that ended by resignation or on time. Same bookkeeping as resign().
   */
  finishAs(reason: 'resign' | 'flag', winner: Color): void {
    this.requestId++
    this.stepRequestId = null
    this.clock.pause()
    this.phase = { kind: 'finished', status: this.game.status(), reason, winner }
    this.emit()
  }
```

`src/ui/history/record.ts`:

```ts
import type { Game } from '../../game-core/game'
import { exportPgn } from '../../game-core/io'
import { resultTagOf } from '../../match/result'
import type { MatchConfig, MatchPhase, Seat } from '../../match/types'
import type { HistoryEntry } from '../../storage/storage'

export function seatLabel(seat: Seat): string {
  return seat.kind === 'human' ? 'Human' : `Stockfish (level ${seat.level})`
}

export function newHistoryId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** The history record for a just-finished match, or null if it should not be kept. */
export function historyEntryFor(opts: {
  phase: MatchPhase
  game: Game
  config: MatchConfig
  opening: string | null
  now: Date
  id: string
}): HistoryEntry | null {
  const { phase, game, config } = opts
  if (phase.kind !== 'finished' || phase.reason === 'engine-error' || game.moves.length === 0) return null
  const result = resultTagOf(phase)
  if (result === '*') return null
  const white = seatLabel(config.white)
  const black = seatLabel(config.black)
  return {
    id: opts.id,
    date: opts.now.toISOString(),
    result,
    termination: phase.reason === 'normal' ? 'normal' : phase.reason,
    opening: opts.opening,
    pgn: exportPgn(game, { White: white, Black: black, Result: result }),
    accuracy: null,
    white,
    black,
  }
}
```

`src/ui/history/HistoryPanel.tsx`:

```tsx
import type { HistoryEntry } from '../../storage/storage'

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const fmtAcc = (x: number | null) => (x === null ? '—' : `${x.toFixed(0)}%`)

export function HistoryPanel({
  entries,
  onReplay,
}: {
  entries: readonly HistoryEntry[]
  onReplay: (entry: HistoryEntry) => void
}) {
  if (entries.length === 0) {
    return (
      <p className="history-empty" data-testid="history-empty">
        No finished games yet.
      </p>
    )
  }
  return (
    <ol className="history-list" data-testid="history-list">
      {entries.map((e) => (
        <li key={e.id} data-testid="history-entry" className="history-entry">
          <div className="history-line">
            <span className="history-result">{e.result}</span>
            <span className="history-players">
              {e.white} – {e.black}
            </span>
          </div>
          <div className="history-line history-meta">
            <span>{fmtDate(e.date)}</span>
            <span>{e.opening ?? 'Unnamed opening'}</span>
          </div>
          <div className="history-line">
            <span className="history-accuracy">
              {e.accuracy ? `Accuracy ${fmtAcc(e.accuracy.w)} / ${fmtAcc(e.accuracy.b)}` : 'not reviewed'}
            </span>
            <button type="button" onClick={() => onReplay(e)}>
              Replay
            </button>
          </div>
        </li>
      ))}
    </ol>
  )
}
```

Append to `src/ui/app.css`:

```css
.history-list { list-style: none; margin: 0; padding: 8px; max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.history-entry { border-bottom: 1px solid var(--color-panel-border); padding-bottom: 6px; }
.history-line { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.history-meta { font-size: 0.8em; color: var(--color-muted); }
.history-result { font-weight: 700; font-variant-numeric: tabular-nums; }
.history-empty { padding: 8px; color: var(--color-muted); }
```

Run: `npx vitest run src/storage src/ui/history src/match` → PASS.

- [ ] **Step 3: Wire App**

In `src/ui/App.tsx`:

1. Imports: add `addHistoryEntry, loadHistory, updateHistoryAccuracy, type HistoryEntry` to the storage import, and

```tsx
import { HistoryPanel } from './history/HistoryPanel'
import { historyEntryFor, newHistoryId } from './history/record'
```

2. State/refs next to `scoredRef`:

```tsx
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  /** True once the current match's finish has been written to history. */
  const recordedRef = useRef(false)
  /** The history entry the current match corresponds to (for the review's accuracy). */
  const historyIdRef = useRef<string | null>(null)
```

3. In `startMatch`, next to `scoredRef.current = false`, add `recordedRef.current = false` and `historyIdRef.current = null`. In `loadMatch`, after the `scoredRef.current = …` line add `recordedRef.current = scoredRef.current` and `historyIdRef.current = null` (a history that is already finished — an import, a resume, a replay — is never re-recorded).

4. After the scoring effect, add:

```tsx
  useEffect(() => {
    if (snapshot.phase.kind !== 'finished' || recordedRef.current) return
    recordedRef.current = true
    const entry = historyEntryFor({
      phase: snapshot.phase,
      game,
      config: snapshot.config,
      opening: finalOpeningName,
      now: new Date(),
      id: newHistoryId(),
    })
    if (!entry) return
    setHistory(addHistoryEntry(entry))
    historyIdRef.current = entry.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.phase])
```

(This effect must be declared AFTER `finalOpeningName` — move it below the Task 12 block if needed; hooks order only has to be stable, not early.)

5. In the `useReview({...})` call, replace `onComplete: () => {}` with:

```tsx
    onComplete: (r) => {
      const id = historyIdRef.current
      if (id) setHistory(updateHistoryAccuracy(id, r.accuracy))
    },
```

6. After `handleStartOpening`:

```tsx
  /** Replay a stored game: load it as a finished two-player game to browse and review. */
  const handleReplay = (entry: HistoryEntry) => {
    const parsed = importPgn(entry.pgn)
    if (!parsed.ok) return
    loadMatch({ white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }, parsed.game, true)
    recordedRef.current = true
    historyIdRef.current = entry.id
    if (parsed.game.status().kind === 'in-progress' && entry.termination !== 'normal') {
      const winner = entry.result === '1-0' ? 'w' : entry.result === '0-1' ? 'b' : null
      if (winner) controller.finishAs(entry.termination, winner)
    }
    setMode('two-player')
    setOrientation('white')
    setTab('moves')
  }
```

7. Add the fourth tab:

```tsx
              { id: 'history', label: 'History', content: <HistoryPanel entries={history} onReplay={handleReplay} /> },
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 4: Write the browser test**

`tests/e2e/history.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

test('a finished game is kept across reloads, gains accuracy when reviewed, and replays', async ({ page }) => {
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-empty')).toBeVisible()

  await play(page, [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']])
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  const entries = page.getByTestId('history-entry')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('1-0')
  await expect(entries.first()).toContainText('not reviewed')

  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('tab-history').click()
  await expect(entries.first()).toContainText('Accuracy')

  await page.reload()
  await page.getByTestId('tab-history').click()
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toContainText('Accuracy')

  await entries.first().getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('ply-count')).toHaveText('7')
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await expect(page.getByTestId('tab-moves')).toHaveAttribute('aria-selected', 'true')
  // Replaying does not add a second entry.
  await page.getByTestId('tab-history').click()
  await expect(entries).toHaveCount(1)
})

test('a resigned game replays as a resignation', async ({ page }) => {
  await play(page, [['e2', 'e4']])
  await page.getByTestId('resign').click() // Black (to move) resigns
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-entry').first()).toContainText('1-0')
  await page.getByTestId('history-entry').first().getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByTestId('result')).toContainText('Black resigns')
})
```

- [ ] **Step 5: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/history.spec.ts`
Expected: PASS. Then reduce the recording effect's guard to `if (snapshot.phase.kind !== 'finished') return` (drop the `recordedRef` check): Replay re-records the game and "Replaying does not add a second entry" must FAIL. Restore. Then delete the `finishAs` call in `handleReplay`: the resignation test must FAIL. Restore.

- [ ] **Step 6: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(history): persistent finished-game history with replay and review accuracy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Sounds

**Complexity:** integration.

**Files:**
- Create: `src/sound/sounds.ts`, `src/sound/sounds.test.ts`
- Modify: `src/ui/panels/SettingsPanel.tsx`, `src/ui/App.tsx`
- Create: `tests/e2e/sounds.spec.ts`

**Interfaces:**
- Consumes: `Settings.soundEnabled` (exists since Phase 1), `updateSettings` (T4), `PlayedMove`, `GameStatus`, `Game`.
- Produces:
  - `type SoundName = 'move' | 'capture' | 'check' | 'game-end'`; `SOUND_TONES: Record<SoundName, readonly Tone[]>`
  - `interface AudioLike { currentTime: number; destination: AudioNode; state: string; resume(): Promise<void>; createOscillator(): OscillatorNode; createGain(): GainNode }`
  - `class SoundPlayer { constructor(opts: { enabled: boolean; createContext?: () => AudioLike | null }); setEnabled(on: boolean): void; unlock(): void; play(name: SoundName): void }`
  - `soundForMove(move: PlayedMove, statusAfter: GameStatus): SoundName`
  - `interface SoundFrame { game: Game; livePly: number; finished: boolean }`; `soundForTransition(prev: SoundFrame | null, next: SoundFrame & { lastMove: PlayedMove | undefined; status: GameStatus }): SoundName | null`
  - Settings UI: `data-testid="sound-toggle"`.

Rules: sounds play only when the live game grows by exactly one ply on the SAME `Game` object (a move — including an engine move and a single-ply redo) or when a match finishes without a move (resign, flag). Loading, importing, resuming, starting a game, undo and browsing are silent. A move that ends the game plays `game-end` instead of its move sound. The `AudioContext` is created on the first `pointerdown`/`keydown` anywhere (browsers refuse to start audio outside a gesture); before that, `play()` is a no-op.

- [ ] **Step 1: Write the failing tests**

`src/sound/sounds.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'
import { Game } from '../game-core/game'
import type { PlayedMove } from '../game-core/types'
import { SOUND_TONES, SoundPlayer, soundForMove, soundForTransition, type AudioLike } from './sounds'

function fakeContext() {
  const started: number[] = []
  const param = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 }
  const node = () => ({ connect: (n: unknown) => n })
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: node(),
    resume: vi.fn(async () => {}),
    createOscillator: () => ({ ...node(), type: 'sine', frequency: { ...param }, start: (t: number) => started.push(t), stop: vi.fn() }),
    createGain: () => ({ ...node(), gain: { ...param } }),
  }
  return { ctx: ctx as unknown as AudioLike, started }
}

const move = (over: Partial<PlayedMove> = {}): PlayedMove => ({
  san: 'e4', from: 'e2', to: 'e4', piece: 'p', color: 'w',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '', ...over,
})
const LIVE = { kind: 'in-progress', inCheck: false } as const

describe('SoundPlayer', () => {
  test('silent and context-free until the first gesture unlocks it', () => {
    const f = fakeContext()
    const create = vi.fn(() => f.ctx)
    const p = new SoundPlayer({ enabled: true, createContext: create })
    p.play('move')
    expect(create).not.toHaveBeenCalled()
    p.unlock()
    p.unlock()
    expect(create).toHaveBeenCalledTimes(1)
    p.play('move')
    expect(f.started).toHaveLength(SOUND_TONES.move.length)
  })

  test('muted means no oscillators', () => {
    const f = fakeContext()
    const p = new SoundPlayer({ enabled: false, createContext: () => f.ctx })
    p.unlock()
    p.play('capture')
    expect(f.started).toHaveLength(0)
    p.setEnabled(true)
    p.play('capture')
    expect(f.started).toHaveLength(SOUND_TONES.capture.length)
  })

  test('no WebAudio at all is harmless', () => {
    const p = new SoundPlayer({ enabled: true, createContext: () => null })
    p.unlock()
    expect(() => p.play('check')).not.toThrow()
  })
})

describe('which sound', () => {
  test('soundForMove: end > check > capture > move', () => {
    expect(soundForMove(move(), LIVE)).toBe('move')
    expect(soundForMove(move({ isCapture: true }), LIVE)).toBe('capture')
    expect(soundForMove(move({ isCapture: true }), { kind: 'in-progress', inCheck: true })).toBe('check')
    expect(soundForMove(move(), { kind: 'checkmate', winner: 'w' })).toBe('game-end')
  })

  test('soundForTransition: only a one-ply growth of the same game, or a finish', () => {
    const g = new Game()
    const other = new Game()
    const frame = (game: Game, livePly: number, finished = false) => ({ game, livePly, finished })
    const next = (game: Game, livePly: number, finished = false) => ({ ...frame(game, livePly, finished), lastMove: move(), status: LIVE })
    expect(soundForTransition(null, next(g, 1))).toBeNull()
    expect(soundForTransition(frame(g, 0), next(g, 1))).toBe('move')
    expect(soundForTransition(frame(g, 0), next(other, 1))).toBeNull() // new/loaded game
    expect(soundForTransition(frame(g, 2), next(g, 1))).toBeNull() // undo
    expect(soundForTransition(frame(g, 0), next(g, 6))).toBeNull() // bulk load
    expect(soundForTransition(frame(g, 3), next(g, 3, true))).toBe('game-end') // resign / flag
  })
})
```

Run: `npx vitest run src/sound` → FAIL.

- [ ] **Step 2: Implement**

`src/sound/sounds.ts`:

```ts
import type { Game } from '../game-core/game'
import type { GameStatus, PlayedMove } from '../game-core/types'

export type SoundName = 'move' | 'capture' | 'check' | 'game-end'

export interface Tone {
  freq: number
  /** Seconds after the sound starts. */
  start: number
  duration: number
  type: OscillatorType
  gain: number
}

/** Synthesised: no audio assets, nothing to license. */
export const SOUND_TONES: Record<SoundName, readonly Tone[]> = {
  move: [{ freq: 440, start: 0, duration: 0.06, type: 'triangle', gain: 0.25 }],
  capture: [
    { freq: 220, start: 0, duration: 0.05, type: 'square', gain: 0.12 },
    { freq: 330, start: 0.04, duration: 0.08, type: 'triangle', gain: 0.22 },
  ],
  check: [
    { freq: 660, start: 0, duration: 0.08, type: 'sine', gain: 0.25 },
    { freq: 880, start: 0.09, duration: 0.1, type: 'sine', gain: 0.25 },
  ],
  'game-end': [
    { freq: 523.25, start: 0, duration: 0.14, type: 'sine', gain: 0.22 },
    { freq: 659.25, start: 0.12, duration: 0.14, type: 'sine', gain: 0.22 },
    { freq: 783.99, start: 0.24, duration: 0.3, type: 'sine', gain: 0.22 },
  ],
}

export interface AudioLike {
  currentTime: number
  destination: AudioNode
  state: string
  resume(): Promise<void>
  createOscillator(): OscillatorNode
  createGain(): GainNode
}

function defaultCreateContext(): AudioLike | null {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

export class SoundPlayer {
  private ctx: AudioLike | null = null
  private unlocked = false
  private enabled: boolean
  private readonly createContext: () => AudioLike | null

  constructor(opts: { enabled: boolean; createContext?: () => AudioLike | null }) {
    this.enabled = opts.enabled
    this.createContext = opts.createContext ?? defaultCreateContext
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  /** Call from a user gesture; creates the AudioContext the first time. */
  unlock(): void {
    if (!this.unlocked) {
      this.unlocked = true
      this.ctx = this.createContext()
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
  }

  play(name: SoundName): void {
    const ctx = this.ctx
    if (!this.enabled || !ctx) return
    try {
      for (const tone of SOUND_TONES[name]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const t0 = ctx.currentTime + tone.start
        osc.type = tone.type
        osc.frequency.value = tone.freq
        gain.gain.setValueAtTime(tone.gain, t0)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.duration)
        osc.connect(gain).connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + tone.duration + 0.02)
      }
    } catch {
      // Audio is garnish: never let it break a move.
    }
  }
}

export function soundForMove(move: PlayedMove, statusAfter: GameStatus): SoundName {
  if (statusAfter.kind !== 'in-progress') return 'game-end'
  if (statusAfter.inCheck) return 'check'
  if (move.isCapture) return 'capture'
  return 'move'
}

export interface SoundFrame {
  game: Game
  livePly: number
  finished: boolean
}

export function soundForTransition(
  prev: SoundFrame | null,
  next: SoundFrame & { lastMove: PlayedMove | undefined; status: GameStatus },
): SoundName | null {
  if (!prev || prev.game !== next.game) return null
  if (next.livePly === prev.livePly + 1 && next.lastMove) return soundForMove(next.lastMove, next.status)
  if (!prev.finished && next.finished) return 'game-end'
  return null
}
```

Add to `src/ui/panels/SettingsPanel.tsx`, inside the fieldset before the eval label:

```tsx
      <label>
        <input
          type="checkbox"
          data-testid="sound-toggle"
          checked={settings.soundEnabled}
          onChange={(e) => onChange({ soundEnabled: e.target.checked })}
        />
        Sound
      </label>
```

In `src/ui/App.tsx`: add `import { SoundPlayer, soundForTransition, type SoundFrame } from '../sound/sounds'`, and after `updateSettings`:

```tsx
  const [sound] = useState(() => new SoundPlayer({ enabled: settings.soundEnabled }))
  useEffect(() => {
    sound.setEnabled(settings.soundEnabled)
  }, [sound, settings.soundEnabled])
  useEffect(() => {
    // Browsers only start audio inside a user gesture: create it on the first one.
    const unlock = () => sound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [sound])
```

and after `const game: Game = snapshot.game` (and its neighbours):

```tsx
  const lastSoundFrame = useRef<SoundFrame | null>(null)
  useEffect(() => {
    const finished = snapshot.phase.kind === 'finished'
    const prev = lastSoundFrame.current
    lastSoundFrame.current = { game, livePly: game.livePly, finished }
    const name = soundForTransition(prev, {
      game,
      livePly: game.livePly,
      finished,
      lastMove: game.moves[game.livePly - 1],
      status: game.status(),
    })
    if (name) sound.play(name)
  }, [sound, game, game.livePly, snapshot.phase.kind])
```

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 3: Write the browser test**

`tests/e2e/sounds.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

declare global {
  interface Window {
    __audio: { contexts: number; tones: number }
  }
}

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.addInitScript(() => {
    const log = { contexts: 0, tones: 0 }
    window.__audio = log
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
    class Node_ { connect(n: unknown) { return n } }
    class Osc extends Node_ { type = 'sine'; frequency = param(); start() { log.tones++ } stop() {} }
    class Gain extends Node_ { gain = param() }
    class Ctx {
      currentTime = 0
      state = 'running'
      destination = new Node_()
      constructor() { log.contexts++ }
      resume() { return Promise.resolve() }
      createOscillator() { return new Osc() }
      createGain() { return new Gain() }
    }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = Ctx
  })
  await page.goto('/')
})

const audio = (page: import('@playwright/test').Page) => page.evaluate(() => window.__audio)

test('no audio before a gesture; a move plays; mute persists', async ({ page }) => {
  expect(await audio(page)).toEqual({ contexts: 0, tones: 0 })

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()
  await expect.poll(async () => (await audio(page)).tones).toBeGreaterThan(0)
  expect((await audio(page)).contexts).toBe(1)

  await page.getByTestId('sound-toggle').uncheck()
  const before = (await audio(page)).tones
  await page.locator('[data-square="e7"]').click()
  await page.locator('[data-square="e5"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('2')
  expect((await audio(page)).tones).toBe(before)

  await page.reload()
  await page.getByTestId('resume-decline').click()
  await expect(page.getByTestId('sound-toggle')).not.toBeChecked()
})

test('importing a game is silent', async ({ page }) => {
  await page.getByTestId('import-text').fill('1. e4 e5 2. Nf3 Nc6 *')
  await page.getByTestId('import-submit').click() // this click unlocks audio
  await expect(page.getByTestId('ply-count')).toHaveText('4')
  expect((await audio(page)).tones).toBe(0)
})
```

- [ ] **Step 4: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/sounds.spec.ts`
Expected: PASS. Then make `soundForTransition` return `'move'` whenever `next.livePly > prev.livePly` (drop the same-game check and the `+ 1`): "importing a game is silent" must FAIL. Restore.

- [ ] **Step 5: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(sound): synthesised move, capture, check and game-end sounds with a persisted mute

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Board themes

**Complexity:** mechanical.

**Files:**
- Create: `src/ui/themes.ts`, `src/ui/themes.test.ts`
- Modify: `src/ui/Board/Board.tsx`, `src/ui/Board/board.css`, `src/ui/panels/SettingsPanel.tsx`, `src/ui/App.tsx`
- Create: `tests/e2e/themes.spec.ts`

**Interfaces:**
- Consumes: `Settings.themeId` (exists since Phase 1, default `'classic'`), `updateSettings` (T4).
- Produces: `BOARD_THEMES: readonly { id; label; light; dark }[]`, `boardTheme(id: string)` (unknown ids fall back to classic); `<Board theme?: string />` sets `--sq-light`/`--sq-dark` on `.board-frame`; settings select `data-testid="board-theme"`.

Piece-set ruling (see Global Constraints): board colour themes only; the piece set stays Rhosgfx.

- [ ] **Step 1: Write the failing test**

`src/ui/themes.test.ts`:

```ts
import { expect, test } from 'vitest'
import { BOARD_THEMES, boardTheme } from './themes'

test('four themes with distinct ids, classic first', () => {
  expect(BOARD_THEMES.map((t) => t.id)).toEqual(['classic', 'green', 'blue', 'slate'])
})

test('unknown ids fall back to classic (e.g. a setting saved by a future version)', () => {
  expect(boardTheme('green').dark).toBe('#769656')
  expect(boardTheme('neon').id).toBe('classic')
})
```

Run: `npx vitest run src/ui/themes.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`src/ui/themes.ts`:

```ts
export const BOARD_THEMES = [
  { id: 'classic', label: 'Classic', light: '#f0d9b5', dark: '#b58863' },
  { id: 'green', label: 'Green', light: '#eeeed2', dark: '#769656' },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'slate', label: 'Slate', light: '#d9dce1', dark: '#7d8594' },
] as const

export type BoardTheme = (typeof BOARD_THEMES)[number]

export function boardTheme(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0]
}
```

In `src/ui/Board/Board.tsx`: `import type { CSSProperties } from 'react'` and `import { boardTheme } from '../themes'`; add the prop `theme = 'classic'` / `theme?: string` (documented "Board colour theme id"); on the `.board-frame` div add

```tsx
      data-board-theme={boardTheme(theme).id}
      style={{ '--sq-light': boardTheme(theme).light, '--sq-dark': boardTheme(theme).dark } as CSSProperties}
```

In `src/ui/Board/board.css` replace the two square colour rules with:

```css
.square.light { background: var(--sq-light, #f0d9b5); }
.square.dark  { background: var(--sq-dark, #b58863); }
```

In `src/ui/panels/SettingsPanel.tsx` add `import { BOARD_THEMES } from '../themes'` and, first in the fieldset:

```tsx
      <label>
        Board
        <select
          data-testid="board-theme"
          value={settings.themeId}
          onChange={(e) => onChange({ themeId: e.target.value })}
        >
          {BOARD_THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
```

In `src/ui/App.tsx`, pass `theme={settings.themeId}` to `<Board>`.

Run: `npm run typecheck && npm test` → PASS.

- [ ] **Step 3: Write the browser test**

`tests/e2e/themes.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { coachOffline } from './helpers'

test('a board theme recolours the squares and persists', async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
  const a1 = page.locator('[data-square="a1"]') // a dark square
  const h1 = page.locator('[data-square="h1"]') // a light square
  await expect(a1).toHaveCSS('background-color', 'rgb(181, 136, 99)')

  await page.getByTestId('board-theme').selectOption('green')
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
  await expect(h1).toHaveCSS('background-color', 'rgb(238, 238, 210)')

  await page.reload()
  await expect(page.getByTestId('board-theme')).toHaveValue('green')
  await expect(a1).toHaveCSS('background-color', 'rgb(118, 150, 86)')
})
```

- [ ] **Step 4: Run it, and prove it can fail**

Run: `npx playwright test tests/e2e/themes.spec.ts`
Expected: PASS. Then remove the `style={…}` prop from `.board-frame`: the green assertion must FAIL. Restore.

- [ ] **Step 5: Full suites and commit**

Run: `npm run typecheck && npm test && npm run e2e`

```bash
git add src tests/e2e
git commit -m "feat(ui): selectable board colour themes, persisted in settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Phase 2 verification sweep

**Complexity:** mechanical.

**Files:**
- Modify only if a check below fails (fix in the owning module, with a test).

**Interfaces:**
- Consumes: everything above.
- Produces: a green tree, a production smoke test, and the checklist below ticked.

- [ ] **Step 1: Full automated suites from a clean build**

```bash
rm -rf dist
npm run typecheck
npm test
npm run build
npm run e2e
```

Expected: all green. Unit count well above the 236 baseline; e2e = the six Phase 1 specs + `coordinates`, `hints`, `eval-bar`, `coach`, `opening-name`, `explorer`, `book-moves`, `review`, `history`, `sounds`, `themes`.

- [ ] **Step 2: Production smoke test (server serves the built app)**

```bash
npm run build
npm run server &
sleep 2
curl -s http://127.0.0.1:8787/api/health                       # {"ok":true,"claude":<true|false>}
curl -s http://127.0.0.1:8787/ | grep -c '<div id="root">'     # 1
curl -sI http://127.0.0.1:8787/openings/openings.json | head -1 # HTTP/1.1 200 OK
curl -sI http://127.0.0.1:8787/engine/stockfish-19-lite-single.wasm | head -1  # HTTP/1.1 200 OK
kill %1
grep -rl "ANTHROPIC_API_KEY\|sk-ant" dist/ || echo "no key material in the bundle"
```

Expected: exactly those outputs; the last line prints `no key material in the bundle`.

- [ ] **Step 3: Manual browser checklist (`npm run server` + `npm run dev`, then http://localhost:5173)**

Tick each in a real browser, light AND dark system theme:
- [ ] Coordinates a–h under the board and 1–8 to its left, readable; flip reverses both.
- [ ] One-player level 3: Hint → highlight + "Look at your …"; again → arrow; again → reasoning; making any move clears all of it.
- [ ] Eval bar moves after each move and never delays the engine's reply.
- [ ] With no `.env`: "coaching offline" badge; hints and review still work (templated).
- [ ] With a real `ANTHROPIC_API_KEY` in `.env` (only if the user supplies one — never commit it): press-3 hints and the review summary come from Claude ("Summary by Claude"); the key does not appear in the browser's network tab.
- [ ] Opening name updates while playing a Najdorf; Explorer search → Start works.
- [ ] Finish a game → Review: progress bar, marks in the move list, arrow on a flagged move, summary. Cancel mid-review, then start a one-player game: the engine replies.
- [ ] History lists the game after a reload; Replay loads it; accuracy appears after a review.
- [ ] Sounds on move/capture/check/mate after the first click; mute persists.
- [ ] Each board theme recolours the squares; the choice persists.
- [ ] Narrow window (≤ 768 px): single column, tabs below the board, board still square.

- [ ] **Step 4: Commit (only if Steps 1–3 required fixes)**

```bash
git add -A
git commit -m "fix: Phase 2 verification sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec Coverage (self-review)

| Spec requirement (Phase 2 + binding sections) | Task |
|---|---|
| Express server, `/api/hint`, `/api/review`, key in `.env` | 5 |
| Graded hints: nudge → move → reasoning | 2 (graphics, grades), 6 (Claude reasoning) |
| Evaluation bar beside the board | 4 (single-worker safety: 3) |
| Opening naming as you play; transpositions | 7, 8 |
| Opening explorer with "start from this opening" | 9 |
| Engine book moves from the same dataset; levels 1–3 prefer the book | 10 |
| Post-game review: blunder/mistake/good-move marking + Claude summary | 11, 12 |
| Persistent history: date, result, opening, accuracy (+ PGN) | 13 |
| Sounds (move, capture, check, game end) | 14 |
| Board and piece themes | 15 (board themes; piece set ruled out — see Global Constraints) |
| Interface layout: right column tab group (moves, explorer, analysis) | 9, 12, 13 |
| Coordinates (Phase 1 item, visibility ruling) | 1 |
| Error table: hint server unreachable → fallback + "coaching offline" | 6 |
| Error table: Claude error/rate limit → fallback, surfaced once | 6 |
| Persistence: `history` key; settings theme/sound | 13, 4, 14, 15 |
| Testing: coach tested against mocked boundaries, no live API | 5, 6 |
| Testing: openings named correctly on known transpositions | 7, 8 |

Deliberately not in Phase 2: puzzles (Phase 3), a second piece set (licence unverified).
