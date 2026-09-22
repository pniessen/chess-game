# Chess Game Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Puzzles mode: about 3,000 curated Lichess tactics puzzles (CC0) with an adaptive Elo-style puzzle rating, graded graphical hints, retry / show-solution / next, and "My mistakes" puzzles generated automatically from the human's blunders in reviewed games. The in-progress game is paused, not touched, while puzzling.

**Architecture:** A pure, React-free `src/puzzles/` module owns everything puzzle-shaped: the data format and lazy loader, spec validation through `game-core`, a session state machine (setup move, expected-move checking with the "any mate solves" rule, opponent replies, solved/failed/revealed), rating, selection with an injected RNG, persistence, and blunder-puzzle extraction from a `GameReview`. A curation script (run once by hand, never by install/build/test) streams the full Lichess dump from stdin into a committed curated CSV; `npm run puzzles` builds the committed `public/puzzles/puzzles.json`, which the browser fetches only when puzzle mode opens. The UI is a self-contained `PuzzleScreen` (reusing `Board`, `Promotion`, the selection reducer and the hint overlay) plus a two-line switch in `App.tsx`, which pauses the match through `MatchController.pause()` and resumes it on exit.

**Tech Stack:** TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63, chess.js 1.4 (game-core only), `tsx` for scripts, `zstd` (only for the one-off curation run).

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md` (Phase 3 section is the scope; "Interface layout", "Persistence", "Error handling" and "Testing" sections bind every task). User decisions made after the spec (binding): separate Puzzles screen; adaptive puzzle rating; full Lichess DB already downloaded, curated to ~3,000; blunder puzzles auto-saved from reviews with a "Rated" / "My mistakes" source switch.

## Global Constraints

- **Node >= 22.9.** Verified machine: Node 26.7.0.
- **Stack versions stay as installed:** TypeScript 7, Vite 8, React 19, Vitest 5 (jsdom by default; any test file that reads the filesystem or otherwise needs Node APIs starts with `// @vitest-environment node`), Playwright 1.63, chess.js 1.4.0. No new dependencies.
- **`src/game-core/` is the ONLY directory that imports chess.js** — including `scripts/`, `server/` and the new `src/puzzles/`. Every puzzle move is validated/applied through `Position` (`Position.fromFen`, `tryMove`, `status`, `turn`, `clone`), with `uciToIntent` (`src/engine/uci.ts`) and `uciOf` (`src/game-core/notation.ts`) for notation.
- **chess.js facts:** `.move()` THROWS on illegal input (game-core's `tryMove` returns a value instead); `isCapture()` is false for en passant; use `setHeader`, never `header()`.
- **MatchController owns all game state.** Puzzle mode never reads or writes the game; it only calls `controller.pause()` on entry and `controller.resume()` on exit (and only when it was the one that paused). While puzzle mode is open no engine move is made for the game and no game clock runs.
- **Exactly ONE Stockfish worker; only `EngineLane` talks to the engine; UI analysis goes only through `controller.analyze(req, signal)`.** Phase 3 adds NO new engine calls: rated puzzles are checked against their stored solution, and blunder puzzles take the engine's best move from the review's own data (`ReviewedMove.bestUci`, already produced through `controller.analyze` at `REVIEW_BUDGET`).
- **Puzzle data:** the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles), credited in `NOTICE.md`. Committed: `data/puzzles/puzzles.csv` (curated subset, columns `PuzzleId,FEN,Moves,Rating,Themes`, values unmodified) and the generated `public/puzzles/puzzles.json`. The 304 MB `.csv.zst` dump is never committed and never needed by `npm install`, `npm run build`, `npm test` or `npm run e2e`.
- **Lichess puzzle format:** `FEN` is the position BEFORE the opponent's setup move; `Moves[0]` is that setup move (auto-played), then the solver plays `Moves[1]`, the opponent `Moves[2]`, …, ending with a solver move. Any solver move that gives checkmate solves the puzzle (Lichess rule), even if it is not the listed move.
- **Storage:** every key is namespaced `chess-game:` and declared in `storage.ts`'s `STORAGE_KEYS`. New keys: `chess-game:puzzles` = `{ v: 1, rating, games, wins, losses, seen: string[] }` and `chess-game:blunder-puzzles` = `{ v: 1, puzzles: BlunderPuzzle[] }` (newest first, one per position, capped at 200). Reads validate defensively; unparseable or malformed data resets to defaults and is overwritten on the next write; a record with a NEWER `v` reads as defaults but is never overwritten (the history lesson, commit `57057d2`). Writes swallow quota errors (`writeJson`).
- **Rating:** start 1200; K = 40 for the first 20 rated results, then 20; rounded to an integer; clamped to 400–3200. The FIRST decisive event of a rated puzzle decides it, once: a clean solve = win; a wrong move, a hint, or Show solution = loss. Skipping (Next before anything decisive) changes nothing. My-mistakes puzzles never change the rating.
- **Selection:** unseen puzzles first, nearest the user's rating (windows ±100, ±200, ±400, ±800, then any), optional theme filter over `PUZZLE_THEMES`, RNG injected (`random: () => number`, default `Math.random`). E2E pins it with the existing `pinRandom(page, 0)`.
- **Board orientation in puzzles:** the solver's side at the bottom.
- **Error handling:** `puzzles.json` failing to load → a clear message on the puzzle screen, the game mode unaffected, a retry on the next open; corrupt puzzle storage → reset gracefully (see Storage).
- **App.tsx does not grow a puzzle feature:** its Phase 3 changes are limited to (T7) turning a completed review into blunder puzzles and (T9) the screen switch, the `Puzzles` button prop and the `usePuzzleMode` call.
- **The pattern to keep:** logic lives in pure, tested modules (`src/puzzles/*`, `puzzleView.ts`); components render.
- **Testing discipline:** every UI task ships a Playwright spec; each test step names the breaking change that turns it red; every e2e spec routes `/api` with `page.route` (`coachOffline`) so results never depend on a local server or key; puzzle e2e specs serve a tiny fixture `puzzles.json` via `page.route` (`servePuzzles`) so they never depend on the bundled set.
- **Baseline:** 492 unit tests pass (6 skipped), `npm run typecheck` is clean, 35/35 e2e pass — before Task 1 and after every task.
- **Commits:** one per task (more is fine), on the current branch `phase-3-puzzles`, message ending with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Model tier per task** (for the executor matching subagents to complexity): cheap = mechanical/transcription; standard = ordinary TDD with clear specs; most capable = state machines or integration with delicate existing invariants.

---

## File Structure

```
chess-game/
├── NOTICE.md                              # + Lichess puzzle database credit            (T3)
├── package.json                           # + "puzzles", "curate-puzzles" scripts        (T2)
├── data/puzzles/puzzles.csv               # NEW curated subset, committed                (T3)
├── public/puzzles/puzzles.json            # NEW generated, committed, fetched lazily      (T3)
├── scripts/
│   ├── puzzles-curate-lib.ts              # NEW pure curation: parse, quality, buckets, diversity (T2)
│   ├── puzzles-curate-lib.test.ts         # NEW                                           (T2)
│   ├── curate-puzzles.ts                  # NEW stdin (Lichess CSV) -> data/puzzles/puzzles.csv (T2)
│   ├── puzzles-lib.ts                     # NEW paths + buildPuzzlesJson()                (T2)
│   ├── build-puzzles.ts                   # NEW `npm run puzzles`                          (T2)
│   └── build-puzzles.test.ts              # NEW committed JSON up to date; set shape       (T3)
├── src/
│   ├── puzzles/                           # NEW, React-free
│   │   ├── types.ts                       # RatedPuzzle, PuzzleRow, PuzzleData, PuzzleSpec, BlunderPuzzle (T1)
│   │   ├── spec.ts                        # isUci, specOfRated/Blunder, positionAfter, validateSpec (T1)
│   │   ├── themes.ts                      # PUZZLE_THEMES, themeLabel()                   (T1)
│   │   ├── data.ts                        # parsePuzzleData(), loadPuzzleSet() (lazy, cached) (T1)
│   │   ├── build.ts                       # curated CSV <-> rows, buildPuzzleData(), puzzleJsonOf() (T1)
│   │   ├── session.ts                     # the puzzle state machine                      (T4)
│   │   ├── rating.ts                      # Elo update                                    (T5)
│   │   ├── select.ts                      # selectPuzzle()                                (T5)
│   │   ├── store.ts                       # chess-game:puzzles + chess-game:blunder-puzzles (T6)
│   │   └── blunders.ts                    # blunderPuzzlesFrom(review)                    (T7)
│   ├── storage/storage.ts                 # export readJson/writeJson/isRecord/STORAGE_KEYS (T6)
│   └── ui/
│       ├── App.tsx                        # review -> blunder puzzles (T7); screen switch (T9)
│       ├── history/record.ts              # + humanSidesOf()                              (T7)
│       ├── panels/NewGame.tsx             # + Puzzles button                              (T9)
│       └── puzzles/                       # NEW
│           ├── puzzleView.ts              # pure: status/hint text, annotations, origin   (T8, T10)
│           ├── usePuzzleSession.ts        # session + timers + hint stage                 (T8)
│           ├── usePuzzleMode.ts           # game <-> puzzles switch, pause/resume         (T9)
│           ├── PuzzleScreen.tsx           # the screen                                    (T9, T10)
│           ├── MistakesList.tsx           # "My mistakes" list                            (T10)
│           └── puzzles.css                #                                                (T9, T10)
└── tests/
    ├── fixtures/puzzles.ts                # NEW DEFENCE, MULTI, BACK_RANK, PUZZLE_FIXTURE  (T1)
    └── e2e/
        ├── helpers.ts                     # + servePuzzles(), openPuzzles()               (T9)
        ├── blunder-puzzles.spec.ts        # NEW                                            (T7, T10)
        └── puzzles.spec.ts                # NEW                                            (T9)
```

---

## Task Order

| # | Task | Model tier |
|---|---|---|
| 1 | Puzzle types, spec validation, themes, asset parsing + lazy loader | standard |
| 2 | Curated-CSV builder and the curation script | standard |
| 3 | Run the curation on the downloaded dump; commit data; NOTICE | cheap |
| 4 | Puzzle session state machine | most capable |
| 5 | Rating and selection | cheap |
| 6 | Puzzle persistence (stats + blunder store) | standard |
| 7 | Blunder puzzles from reviewed games | most capable |
| 8 | `usePuzzleSession` hook + pure puzzle view helpers | standard |
| 9 | Puzzle screen (rated) + App switch that pauses the game | most capable |
| 10 | "My mistakes" source | standard |
| 11 | Phase 3 verification sweep | cheap |

Tasks 1–3 are the data track, 4–6 the pure core, 7 hooks puzzles into the review, 8–10 are the UI. Each task leaves `npm test`, `npm run typecheck` and `npm run e2e` green.

---

### Task 1: Puzzle types, spec validation, themes, asset parsing + lazy loader

**Model tier:** standard.

**Files:**
- Create: `src/puzzles/types.ts`, `src/puzzles/spec.ts`, `src/puzzles/themes.ts`, `src/puzzles/data.ts`, `src/puzzles/build.ts`
- Create: `tests/fixtures/puzzles.ts`
- Test: `src/puzzles/spec.test.ts`, `src/puzzles/themes.test.ts`, `src/puzzles/data.test.ts`, `src/puzzles/build.test.ts`

**Interfaces:**
- Consumes: `Position` (`src/game-core/position.ts`: `Position.fromFen(fen) -> { ok: true; position } | { ok: false; error }`, `tryMove(intent) -> MoveResult`), `uciToIntent(uci): MoveIntent | null` (`src/engine/uci.ts`), `Color` (`src/game-core/types.ts`).
- Produces:
  - `interface RatedPuzzle { id: string; fen: string; moves: string[]; rating: number; themes: string[] }` — Lichess semantics: `moves[0]` is the setup move.
  - `type PuzzleRow = [id: string, fen: string, moves: string, rating: number, themes: string]`; `interface PuzzleData { v: 1; puzzles: PuzzleRow[] }`.
  - `interface PuzzleSpec { fen: string; setup: string | null; solution: readonly string[] }` — solution has odd length and ends with the solver's move.
  - `interface BlunderPuzzle { id: string; fen: string; solution: string; bestSan: string; blunderLabel: string; solver: Color; gameId: string; gameDate: string; opening: string | null; createdAt: string; solved: boolean }`.
  - `isUci(s: string): boolean`, `specOfRated(p: RatedPuzzle): PuzzleSpec`, `specOfBlunder(p: BlunderPuzzle): PuzzleSpec`, `positionAfter(fen: string, ucis: readonly string[]): Position | null`, `validateSpec(spec: PuzzleSpec): string | null` (null = valid).
  - `PUZZLE_THEMES: readonly string[]` (18 ids), `themeLabel(theme: string): string`.
  - `parsePuzzleData(raw: unknown): RatedPuzzle[] | null`, `loadPuzzleSet(fetchImpl?, url = '/puzzles/puzzles.json'): Promise<RatedPuzzle[] | null>` (cached; a failure is not cached), `resetPuzzleSetCache(): void`.
  - `CURATED_HEADER = 'PuzzleId,FEN,Moves,Rating,Themes'`, `parseCuratedCsv(text): RatedPuzzle[]` (throws), `curatedCsvOf(puzzles): string`, `buildPuzzleData(csvText): PuzzleData` (throws on any invalid or duplicate puzzle), `puzzleJsonOf(data): string` (one row per line, trailing newline).
  - Fixtures: `DEFENCE` (real Lichess `0000D`, solver Black), `MULTI` (real Lichess `00008`, three solver moves), `BACK_RANK` (synthetic `T0001`: both `Qd8#` and `Ra8#` mate), `PUZZLE_FIXTURE` (`PuzzleData` with `[DEFENCE, BACK_RANK]`).

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/puzzles.ts`:

```ts
import type { PuzzleData, PuzzleRow, RatedPuzzle } from '../../src/puzzles/types'

/**
 * Lichess puzzle 0000D (CC0). White's setup 27.Qd6 hits the queen on b6 and
 * the bishop on f6; Black (the solver) answers ...Rd8, White takes Qxd8+,
 * Black recaptures Bxd8. Verified move by move through game-core.
 */
export const DEFENCE: RatedPuzzle = {
  id: '0000D',
  fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27',
  moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'],
  rating: 1468,
  themes: ['advantage', 'endgame', 'short'],
}

/** Lichess puzzle 00008 (CC0): solver White, three solver moves. */
export const MULTI: RatedPuzzle = {
  id: '00008',
  fen: 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24',
  moves: ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'],
  rating: 1797,
  themes: ['crushing', 'hangingPiece', 'long', 'middlegame'],
}

/**
 * SYNTHETIC (not from Lichess): after the setup ...b6, White (the solver)
 * mates with the listed Qd8# — but Ra8# is mate too, so it must also solve.
 */
export const BACK_RANK: RatedPuzzle = {
  id: 'T0001',
  fen: '6k1/1p3ppp/8/8/8/8/5PPP/R2Q2K1 b - - 0 1',
  moves: ['b7b6', 'd1d8'],
  rating: 1500,
  themes: ['mate', 'mateIn1', 'backRankMate'],
}

/** A two-puzzle stand-in for public/puzzles/puzzles.json (unit tests and e2e). */
export const PUZZLE_FIXTURE: PuzzleData = {
  v: 1,
  puzzles: [DEFENCE, BACK_RANK].map((p): PuzzleRow => [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')]),
}
```

- [ ] **Step 2: Write the failing tests**

`src/puzzles/spec.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { isUci, positionAfter, specOfBlunder, specOfRated, validateSpec } from './spec'
import type { BlunderPuzzle } from './types'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

test('isUci accepts long algebraic moves only', () => {
  expect(isUci('e2e4')).toBe(true)
  expect(isUci('e7e8q')).toBe(true)
  expect(isUci('e7e8k')).toBe(false)
  expect(isUci('Nf3')).toBe(false)
  expect(isUci('z9a1')).toBe(false)
})

// Breaks if the Lichess setup move is treated as the solver's first move.
test('specOfRated: moves[0] is the setup, the rest is the solution', () => {
  expect(specOfRated(DEFENCE)).toEqual({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8', 'f6d8'] })
})

test('specOfBlunder: no setup, a one-move solution', () => {
  const p: BlunderPuzzle = {
    id: 'b:x', fen: DEFENCE.fen, solution: 'd3d6', bestSan: 'Qd6', blunderLabel: '27. Qe2', solver: 'w',
    gameId: 'g', gameDate: '2026-09-21T00:00:00.000Z', opening: null, createdAt: '2026-09-21T00:00:00.000Z', solved: false,
  }
  expect(specOfBlunder(p)).toEqual({ fen: DEFENCE.fen, setup: null, solution: ['d3d6'] })
})

describe('validateSpec (through game-core)', () => {
  test('real Lichess lines and the synthetic fixture validate', () => {
    for (const p of [DEFENCE, MULTI, BACK_RANK]) expect(validateSpec(specOfRated(p))).toBeNull()
  })

  // Breaks if a move is skipped or applied without legality checking.
  test('an illegal move is reported with its 1-based index in the full line', () => {
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8', 'a1a8'] })).toMatch(
      /^move 4 \(a1a8\) is illegal/,
    )
  })

  // Breaks if a line ending on the opponent's move is accepted (nothing left for the solver).
  test('an even-length solution is rejected', () => {
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'd3d6', solution: ['f8d8', 'd6d8'] })).toMatch(/odd number/)
    expect(validateSpec({ fen: DEFENCE.fen, setup: null, solution: [] })).toMatch(/odd number/)
  })

  test('a bad FEN and non-UCI text are rejected, never thrown', () => {
    expect(validateSpec({ fen: 'not a fen', setup: null, solution: ['e2e4'] })).toMatch(/^bad FEN/)
    expect(validateSpec({ fen: DEFENCE.fen, setup: 'Qd6', solution: ['f8d8'] })).toMatch(/^move 1 is not UCI/)
  })
})

test('positionAfter replays through game-core and returns null on any failure', () => {
  expect(positionAfter(DEFENCE.fen, ['d3d6'])?.fen()).toBe('5rk1/1p3ppp/pq1Q1b2/8/8/1P3N2/P4PPP/3R2K1 b - - 3 27')
  expect(positionAfter(DEFENCE.fen, ['a1a8'])).toBeNull()
  expect(positionAfter(DEFENCE.fen, ['zz'])).toBeNull()
  expect(positionAfter('garbage', [])).toBeNull()
})
```

`src/puzzles/themes.test.ts`:

```ts
import { expect, test } from 'vitest'
import { PUZZLE_THEMES, themeLabel } from './themes'

test('the filter list is fixed, unique, and every entry has a label', () => {
  expect(PUZZLE_THEMES).toHaveLength(18)
  expect(new Set(PUZZLE_THEMES).size).toBe(PUZZLE_THEMES.length)
  for (const t of PUZZLE_THEMES) expect(themeLabel(t)).not.toBe('')
})

test('known themes use their label; unknown Lichess themes are humanised', () => {
  expect(themeLabel('mateIn2')).toBe('Mate in 2')
  expect(themeLabel('backRankMate')).toBe('Back-rank mate')
  expect(themeLabel('kingsideAttack')).toBe('Kingside attack')
  expect(themeLabel('mateIn4')).toBe('Mate in 4')
  expect(themeLabel('short')).toBe('Short')
})
```

`src/puzzles/data.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadPuzzleSet, parsePuzzleData, resetPuzzleSetCache } from './data'
import { DEFENCE, PUZZLE_FIXTURE } from '../../tests/fixtures/puzzles'

afterEach(() => resetPuzzleSetCache())

const respond = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response

describe('parsePuzzleData', () => {
  test('reads the compact rows back into puzzles', () => {
    const set = parsePuzzleData(PUZZLE_FIXTURE)
    expect(set).toHaveLength(2)
    expect(set?.[0]).toEqual(DEFENCE)
  })

  // Breaks if one bad row makes the whole set unusable (or slips through).
  test('malformed rows are dropped, the rest kept', () => {
    const raw = {
      v: 1,
      puzzles: [
        ...PUZZLE_FIXTURE.puzzles,
        ['x'],
        null,
        ['odd', 'fen', 'e2e4', 1500, 'fork'],
        ['notuci', 'fen', 'e2e4 zz99', 1500, ''],
        ['norating', 'fen', 'e2e4 e7e5', 'high', ''],
      ],
    }
    expect(parsePuzzleData(raw)?.map((p) => p.id)).toEqual(['0000D', 'T0001'])
  })

  test('another version, another shape, or no usable rows read as null', () => {
    expect(parsePuzzleData({ v: 2, puzzles: PUZZLE_FIXTURE.puzzles })).toBeNull()
    expect(parsePuzzleData({ v: 1 })).toBeNull()
    expect(parsePuzzleData({ v: 1, puzzles: [] })).toBeNull()
    expect(parsePuzzleData('nope')).toBeNull()
  })
})

describe('loadPuzzleSet', () => {
  // Breaks if every open of puzzle mode refetches the file.
  test('fetches the bundled file once and caches it', async () => {
    const fetchImpl = vi.fn(async (_url: string) => respond(PUZZLE_FIXTURE))
    expect(await loadPuzzleSet(fetchImpl)).toHaveLength(2)
    expect(await loadPuzzleSet(fetchImpl)).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('/puzzles/puzzles.json')
  })

  // Breaks if a failure is cached (puzzles would stay broken until reload) or thrown.
  test('a 404 or a network error resolves to null and is retried next time', async () => {
    expect(await loadPuzzleSet(async (_url: string) => respond('missing', false))).toBeNull()
    expect(await loadPuzzleSet(async (_url: string) => { throw new TypeError('network') })).toBeNull()
    expect(await loadPuzzleSet(async (_url: string) => respond(PUZZLE_FIXTURE))).toHaveLength(2)
  })
})
```

`src/puzzles/build.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { CURATED_HEADER, buildPuzzleData, curatedCsvOf, parseCuratedCsv, puzzleJsonOf } from './build'
import { parsePuzzleData } from './data'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

describe('curated CSV', () => {
  test('round-trips through curatedCsvOf / parseCuratedCsv', () => {
    const csv = curatedCsvOf([DEFENCE, MULTI])
    expect(csv.startsWith(`${CURATED_HEADER}\n`)).toBe(true)
    expect(csv.endsWith('\n')).toBe(true)
    expect(parseCuratedCsv(csv)).toEqual([DEFENCE, MULTI])
  })

  test('a wrong header or a malformed row throws', () => {
    expect(() => parseCuratedCsv('PuzzleId,FEN\nx,y')).toThrow(/header/)
    expect(() => parseCuratedCsv(`${CURATED_HEADER}\n0000D,fen,e2e4 e7e5,notanumber,fork`)).toThrow(/row 2/)
  })
})

describe('buildPuzzleData', () => {
  // Breaks if the builder stops validating moves through game-core.
  test('validates every puzzle and names the bad one', () => {
    const bad = { ...DEFENCE, id: 'BAD01', moves: ['d3d6', 'a1a8'] }
    expect(() => buildPuzzleData(curatedCsvOf([DEFENCE, bad]))).toThrow(/puzzle BAD01: move 2 \(a1a8\) is illegal/)
  })

  test('rejects duplicate ids', () => {
    expect(() => buildPuzzleData(curatedCsvOf([DEFENCE, DEFENCE]))).toThrow(/duplicate puzzle id 0000D/)
  })

  test('the JSON it writes parses back to the same puzzles', () => {
    const json = puzzleJsonOf(buildPuzzleData(curatedCsvOf([DEFENCE, MULTI, BACK_RANK])))
    expect(json.endsWith('\n')).toBe(true)
    expect(json.split('\n')).toHaveLength(6) // opening line, 3 rows, closing line, trailing ''
    expect(parsePuzzleData(JSON.parse(json))).toEqual([DEFENCE, MULTI, BACK_RANK])
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/puzzles`
Expected: FAIL — `Failed to resolve import "./spec"` (and likewise for the other modules).

- [ ] **Step 4: Implement**

`src/puzzles/types.ts`:

```ts
import type { Color } from '../game-core/types'

/** A Lichess puzzle as bundled in public/puzzles/puzzles.json. */
export interface RatedPuzzle {
  id: string
  /** The position BEFORE the opponent's setup move (Lichess format). */
  fen: string
  /** UCI. moves[0] is the opponent's setup move; then solver, opponent, …, solver. */
  moves: string[]
  rating: number
  themes: string[]
}

/** One row of the bundled JSON: [id, fen, space-separated UCI moves, rating, space-separated themes]. */
export type PuzzleRow = [id: string, fen: string, moves: string, rating: number, themes: string]

export interface PuzzleData {
  v: 1
  puzzles: PuzzleRow[]
}

/** What a session needs, whatever the puzzle's source. */
export interface PuzzleSpec {
  fen: string
  /** An opponent move played automatically before the solver's turn (Lichess); null for a blunder puzzle. */
  setup: string | null
  /** Solver, opponent, …, solver (odd length), UCI. */
  solution: readonly string[]
}

/** A position from one of the user's own reviewed games where they blundered. */
export interface BlunderPuzzle {
  /** `b:` + the position's EPD — one puzzle per position. */
  id: string
  /** The position before the blunder; the solver is to move. */
  fen: string
  /** The engine's best move there, from the review (UCI). */
  solution: string
  bestSan: string
  /** The blunder that was actually played, e.g. "3... Nf6". */
  blunderLabel: string
  solver: Color
  gameId: string
  /** ISO 8601, from the history entry. */
  gameDate: string
  opening: string | null
  /** ISO 8601. */
  createdAt: string
  solved: boolean
}
```

`src/puzzles/spec.ts`:

```ts
import { Position } from '../game-core/position'
import { uciToIntent } from '../engine/uci'
import type { BlunderPuzzle, PuzzleSpec, RatedPuzzle } from './types'

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function isUci(s: string): boolean {
  return UCI.test(s)
}

export function specOfRated(p: RatedPuzzle): PuzzleSpec {
  return { fen: p.fen, setup: p.moves[0] ?? null, solution: p.moves.slice(1) }
}

export function specOfBlunder(p: BlunderPuzzle): PuzzleSpec {
  return { fen: p.fen, setup: null, solution: [p.solution] }
}

/** The position after `ucis` from `fen`, through game-core; null if the FEN or any move is not legal. */
export function positionAfter(fen: string, ucis: readonly string[]): Position | null {
  const loaded = Position.fromFen(fen)
  if (!loaded.ok) return null
  for (const uci of ucis) {
    const intent = isUci(uci) ? uciToIntent(uci) : null
    if (!intent || !loaded.position.tryMove(intent).ok) return null
  }
  return loaded.position
}

/** Null when the whole line (setup, then solution) plays legally; otherwise why not. Never throws. */
export function validateSpec(spec: PuzzleSpec): string | null {
  const n = spec.solution.length
  if (n === 0 || n % 2 === 0) return `the solution must have an odd number of moves (got ${n})`
  const loaded = Position.fromFen(spec.fen)
  if (!loaded.ok) return `bad FEN: ${loaded.error}`
  const line = spec.setup === null ? [...spec.solution] : [spec.setup, ...spec.solution]
  for (const [i, uci] of line.entries()) {
    const intent = isUci(uci) ? uciToIntent(uci) : null
    if (!intent) return `move ${i + 1} is not UCI: ${uci}`
    const r = loaded.position.tryMove(intent)
    if (!r.ok) return `move ${i + 1} (${uci}) is ${r.reason}`
  }
  return null
}
```

`src/puzzles/themes.ts`:

```ts
/** The theme filter: common Lichess themes, in display order. */
export const PUZZLE_THEMES: readonly string[] = [
  'mate', 'mateIn1', 'mateIn2', 'mateIn3', 'backRankMate', 'fork', 'pin', 'skewer',
  'discoveredAttack', 'hangingPiece', 'trappedPiece', 'sacrifice', 'deflection', 'attraction',
  'promotion', 'quietMove', 'defensiveMove', 'endgame',
]

const LABELS: Record<string, string> = {
  mate: 'Checkmate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  backRankMate: 'Back-rank mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  hangingPiece: 'Hanging piece',
  trappedPiece: 'Trapped piece',
  sacrifice: 'Sacrifice',
  deflection: 'Deflection',
  attraction: 'Attraction',
  promotion: 'Promotion',
  quietMove: 'Quiet move',
  defensiveMove: 'Defensive move',
  endgame: 'Endgame',
}

/** "kingsideAttack" -> "Kingside attack"; known themes use their label. */
export function themeLabel(theme: string): string {
  const known = LABELS[theme]
  if (known) return known
  const words = theme.replace(/([A-Z])/g, ' $1').replace(/(\d+)/g, ' $1').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
```

`src/puzzles/data.ts`:

```ts
import { isUci } from './spec'
import type { RatedPuzzle } from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Shape check for our own asset: a truncated or stale file must not crash
 * puzzle mode. Rows that do not fit are dropped; chess legality was already
 * checked at build time (scripts/build-puzzles.ts).
 */
export function parsePuzzleData(raw: unknown): RatedPuzzle[] | null {
  if (!isRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['puzzles'])) return null
  const out: RatedPuzzle[] = []
  for (const row of raw['puzzles'] as unknown[]) {
    if (!Array.isArray(row) || row.length !== 5) continue
    const [id, fen, moves, rating, themes] = row as unknown[]
    if (typeof id !== 'string' || typeof fen !== 'string' || typeof moves !== 'string' || typeof themes !== 'string') continue
    if (typeof rating !== 'number' || !Number.isFinite(rating)) continue
    const ms = moves.split(' ').filter(Boolean)
    if (ms.length < 2 || ms.length % 2 !== 0 || !ms.every(isUci)) continue
    out.push({ id, fen, moves: ms, rating, themes: themes.split(' ').filter(Boolean) })
  }
  return out.length > 0 ? out : null
}

let cached: Promise<RatedPuzzle[] | null> | null = null

/** Fetched only when puzzle mode opens; cached on success, retried after a failure. */
export function loadPuzzleSet(
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
  url = '/puzzles/puzzles.json',
): Promise<RatedPuzzle[] | null> {
  cached ??= fetchImpl(url)
    .then((res) => (res.ok ? res.json() : null))
    .then((raw: unknown) => parsePuzzleData(raw))
    .catch(() => null)
    .then((set) => {
      if (!set) cached = null
      return set
    })
  return cached
}

export function resetPuzzleSetCache(): void {
  cached = null
}
```

`src/puzzles/build.ts`:

```ts
import { specOfRated, validateSpec } from './spec'
import type { PuzzleData, PuzzleRow, RatedPuzzle } from './types'

/** The committed curated file: the Lichess columns we keep, values unmodified. */
export const CURATED_HEADER = 'PuzzleId,FEN,Moves,Rating,Themes'

/** FEN, moves and themes contain spaces but never commas, so a plain split is exact. */
export function parseCuratedCsv(text: string): RatedPuzzle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const [header, ...rows] = lines
  if (header?.trim() !== CURATED_HEADER) throw new Error(`unexpected puzzles CSV header: ${header ?? '(empty)'}`)
  return rows.map((row, i) => {
    const fields = row.split(',')
    const [id, fen, moves, rating, themes] = fields
    const r = Number(rating)
    if (fields.length !== 5 || !id || !fen || !moves || themes === undefined || !Number.isInteger(r)) {
      throw new Error(`malformed puzzles CSV row ${i + 2}: ${row}`)
    }
    return { id, fen, moves: moves.split(' ').filter(Boolean), rating: r, themes: themes.split(' ').filter(Boolean) }
  })
}

export function curatedCsvOf(puzzles: readonly RatedPuzzle[]): string {
  const rows = puzzles.map((p) => [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')].join(','))
  return `${[CURATED_HEADER, ...rows].join('\n')}\n`
}

/** Every puzzle is replayed through game-core; any bad or duplicate one fails the build. Deterministic. */
export function buildPuzzleData(csvText: string): PuzzleData {
  const seen = new Set<string>()
  const puzzles: PuzzleRow[] = []
  for (const p of parseCuratedCsv(csvText)) {
    if (seen.has(p.id)) throw new Error(`duplicate puzzle id ${p.id}`)
    seen.add(p.id)
    const problem = validateSpec(specOfRated(p))
    if (problem) throw new Error(`puzzle ${p.id}: ${problem}`)
    puzzles.push([p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' ')])
  }
  return { v: 1, puzzles }
}

/** One row per line, so a re-curation shows up as a readable diff. */
export function puzzleJsonOf(data: PuzzleData): string {
  return `{"v":1,"puzzles":[\n${data.puzzles.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/puzzles && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — 492 + the new tests; 6 skipped as before.

- [ ] **Step 7: Commit**

```bash
git add src/puzzles tests/fixtures/puzzles.ts
git commit -m "feat(puzzles): puzzle types, game-core validation, themes and lazy loader

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Curated-CSV builder and the curation script

**Model tier:** standard.

**Files:**
- Create: `scripts/puzzles-curate-lib.ts`, `scripts/puzzles-curate-lib.test.ts`, `scripts/curate-puzzles.ts`, `scripts/puzzles-lib.ts`, `scripts/build-puzzles.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `specOfRated`, `validateSpec` (T1), `PUZZLE_THEMES` (T1), `RatedPuzzle` (T1), `CURATED_HEADER`, `curatedCsvOf`, `buildPuzzleData`, `puzzleJsonOf` (T1).
- Produces:
  - `LICHESS_HEADER`, `QUALITY = { maxRatingDeviation: 80, minPopularity: 85, minPlays: 1000 }`, `RATING_MIN = 600`, `RATING_MAX = 2600` (exclusive), `BUCKET_WIDTH = 200`, `BUCKET_COUNT = 10`.
  - `interface LichessRow extends RatedPuzzle { ratingDeviation: number; popularity: number; plays: number }`
  - `parseLichessLine(line): LichessRow | null`, `passesQuality(row): boolean`, `bucketOf(rating): number | null`, `fnv1a(s): number`, `pickDiverse(candidates, n, minPerTheme, isValid): LichessRow[]`
  - `class Curator { constructor(opts?: Partial<CuratorOptions>); add(row: LichessRow): void; result(): CurationResult }` with `CuratorOptions = { perBucket: 300; minPerTheme: 6; candidatesPerBucket: 4000 }` defaults and `CurationResult = { puzzles: RatedPuzzle[]; perBucket: number[]; invalid: string[]; considered: number }`.
  - `scripts/puzzles-lib.ts`: `CURATED_FILE`, `PUZZLES_JSON`, `buildPuzzlesJson(): string`.
  - npm scripts: `npm run puzzles` (CSV -> JSON), `npm run curate-puzzles` (stdin -> CSV).

**Selection rules (the design — do not simplify):** quality filter `RatingDeviation <= 80`, `Popularity >= 85`, `NbPlays >= 1000`; ten 200-point buckets over ratings 600–2599; per bucket, the 4,000 candidates with the lowest FNV-1a hash of `PuzzleId` (ties by id) — an order-independent, deterministic sample; from those, `pickDiverse` first takes up to 6 rounds of one puzzle per `PUZZLE_THEMES` theme (so every theme is represented in every bucket where it exists), then fills to 300 in hash order. Every picked puzzle must pass `validateSpec` (through game-core); rejected ones are reported. Output is sorted by rating, then id.

- [ ] **Step 1: Write the failing tests**

`scripts/puzzles-curate-lib.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  Curator,
  LICHESS_HEADER,
  bucketOf,
  fnv1a,
  parseLichessLine,
  passesQuality,
  type LichessRow,
} from './puzzles-curate-lib'
import { DEFENCE } from '../tests/fixtures/puzzles'

const REAL_LINE =
  '0000D,5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27,d3d6 f8d8 d6d8 f6d8,1468,75,96,37410,advantage endgame short,https://lichess.org/F8M8OS71#53,,'

/** A quality row replaying DEFENCE's (legal) line under another id, rating and themes. */
function row(id: string, rating: number, themes: string[], over: Partial<LichessRow> = {}): LichessRow {
  return {
    id, fen: DEFENCE.fen, moves: [...DEFENCE.moves], rating, themes,
    ratingDeviation: 75, popularity: 95, plays: 5000, ...over,
  }
}

describe('parseLichessLine', () => {
  test('reads a real dump row', () => {
    expect(parseLichessLine(REAL_LINE)).toEqual({
      id: '0000D', fen: DEFENCE.fen, moves: DEFENCE.moves, rating: 1468,
      ratingDeviation: 75, popularity: 96, plays: 37410, themes: ['advantage', 'endgame', 'short'],
    })
  })

  test('the header and junk read as null', () => {
    expect(parseLichessLine(LICHESS_HEADER)).toBeNull()
    expect(parseLichessLine('a,b')).toBeNull()
    expect(parseLichessLine('x,fen,e2e4 e7e5,abc,1,1,1,fork')).toBeNull()
  })
})

// Breaks if a threshold is off by one (the decision says <= 80, >= 85, >= 1000).
test('quality thresholds are inclusive', () => {
  expect(passesQuality(row('a', 1500, [], { ratingDeviation: 80, popularity: 85, plays: 1000 }))).toBe(true)
  expect(passesQuality(row('a', 1500, [], { ratingDeviation: 81 }))).toBe(false)
  expect(passesQuality(row('a', 1500, [], { popularity: 84 }))).toBe(false)
  expect(passesQuality(row('a', 1500, [], { plays: 999 }))).toBe(false)
})

test('ten 200-point buckets over 600..2599', () => {
  expect(bucketOf(599)).toBeNull()
  expect(bucketOf(600)).toBe(0)
  expect(bucketOf(799)).toBe(0)
  expect(bucketOf(800)).toBe(1)
  expect(bucketOf(2599)).toBe(9)
  expect(bucketOf(2600)).toBeNull()
})

test('fnv1a is standard 32-bit FNV-1a', () => {
  expect(fnv1a('')).toBe(0x811c9dc5)
  expect(fnv1a('a')).toBe(0xe40c292c)
})

describe('Curator', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    row(`p${String(i).padStart(2, '0')}`, 1200 + i, i === 7 ? ['skewer'] : ['advantage']),
  )
  const small = { perBucket: 3, minPerTheme: 1, candidatesPerBucket: 50 }

  // Breaks if selection depends on file order (a re-download would reshuffle the set).
  test('the same puzzles whatever the input order', () => {
    const a = new Curator(small)
    rows.forEach((r) => a.add(r))
    const b = new Curator(small)
    ;[...rows].reverse().forEach((r) => b.add(r))
    expect(a.result().puzzles).toEqual(b.result().puzzles)
  })

  // Breaks if the theme pass is dropped (rare themes would vanish from the set).
  test('per-bucket quota; a rare filter theme is always represented; output sorted and trimmed', () => {
    const c = new Curator(small)
    rows.forEach((r) => c.add(r))
    const out = c.result()
    expect(out.puzzles).toHaveLength(3)
    expect(out.perBucket).toEqual([0, 0, 0, 3, 0, 0, 0, 0, 0, 0])
    expect(out.puzzles.map((p) => p.id)).toContain('p07')
    const ratings = out.puzzles.map((p) => p.rating)
    expect(ratings).toEqual([...ratings].sort((x, y) => x - y))
    expect(Object.keys(out.puzzles[0] ?? {}).sort()).toEqual(['fen', 'id', 'moves', 'rating', 'themes'])
  })

  test('low-quality and out-of-range rows are ignored', () => {
    const c = new Curator(small)
    c.add(row('low', 1500, [], { plays: 10 }))
    c.add(row('high', 3000, []))
    c.add(row('easy', 400, []))
    expect(c.result()).toMatchObject({ puzzles: [], considered: 0 })
  })

  // Breaks if a puzzle is committed without being replayed through game-core.
  test('rows whose moves do not replay are rejected and reported', () => {
    const c = new Curator(small)
    c.add(row('bad', 1500, ['fork'], { moves: ['d3d6', 'a1a8'] }))
    c.add(row('good', 1500, ['fork']))
    const out = c.result()
    expect(out.puzzles.map((p) => p.id)).toEqual(['good'])
    expect(out.invalid).toEqual([expect.stringMatching(/^bad: move 2 \(a1a8\) is illegal/)])
  })

  // Breaks if the streaming trim keeps anything but the lowest hashes.
  test('keeps exactly the lowest-hash candidates while trimming as it streams', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`q${i}`, 1000, []))
    const c = new Curator({ perBucket: 30, minPerTheme: 0, candidatesPerBucket: 5 })
    many.forEach((r) => c.add(r))
    const expected = [...many].sort((x, y) => fnv1a(x.id) - fnv1a(y.id)).slice(0, 5).map((r) => r.id).sort()
    expect(c.result().puzzles.map((p) => p.id).sort()).toEqual(expected)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run scripts/puzzles-curate-lib.test.ts`
Expected: FAIL — `Failed to resolve import "./puzzles-curate-lib"`.

- [ ] **Step 3: Implement the curation library**

`scripts/puzzles-curate-lib.ts`:

```ts
import { specOfRated, validateSpec } from '../src/puzzles/spec'
import { PUZZLE_THEMES } from '../src/puzzles/themes'
import type { RatedPuzzle } from '../src/puzzles/types'

export const LICHESS_HEADER =
  'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate'

export const QUALITY = { maxRatingDeviation: 80, minPopularity: 85, minPlays: 1000 } as const
export const RATING_MIN = 600
/** Exclusive. */
export const RATING_MAX = 2600
export const BUCKET_WIDTH = 200
export const BUCKET_COUNT = (RATING_MAX - RATING_MIN) / BUCKET_WIDTH

export interface LichessRow extends RatedPuzzle {
  ratingDeviation: number
  popularity: number
  plays: number
}

/** One dump line; null for the header or anything malformed. Extra columns are ignored. */
export function parseLichessLine(line: string): LichessRow | null {
  const f = line.split(',')
  if (f.length < 8) return null
  const [id, fen, moves, rating, rd, popularity, plays, themes] = f
  if (!id || !fen || !moves || id === 'PuzzleId') return null
  const [r, d, p, n] = [rating, rd, popularity, plays].map((x) => Number(x))
  if (r === undefined || d === undefined || p === undefined || n === undefined) return null
  if (![r, d, p, n].every((x) => Number.isFinite(x))) return null
  return {
    id, fen, moves: moves.split(' ').filter(Boolean), rating: r,
    themes: (themes ?? '').split(' ').filter(Boolean),
    ratingDeviation: d, popularity: p, plays: n,
  }
}

export function passesQuality(r: LichessRow): boolean {
  return r.ratingDeviation <= QUALITY.maxRatingDeviation && r.popularity >= QUALITY.minPopularity && r.plays >= QUALITY.minPlays
}

export function bucketOf(rating: number): number | null {
  if (rating < RATING_MIN || rating >= RATING_MAX) return null
  return Math.floor((rating - RATING_MIN) / BUCKET_WIDTH)
}

/** 32-bit FNV-1a: a stable, order-independent sampling key. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

interface Candidate {
  row: LichessRow
  hash: number
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const byHash = (a: Candidate, b: Candidate) => a.hash - b.hash || byId(a.row.id, b.row.id)

/**
 * From candidates in hash order: first up to `minPerTheme` rounds of one
 * puzzle per filter theme, then fill to `n` in hash order. `isValid` runs
 * at most once per candidate.
 */
export function pickDiverse(
  candidates: readonly LichessRow[],
  n: number,
  minPerTheme: number,
  isValid: (r: LichessRow) => boolean,
): LichessRow[] {
  const verdict = new Map<string, boolean>()
  const taken = new Set<string>()
  const chosen: LichessRow[] = []
  const usable = (r: LichessRow): boolean => {
    if (taken.has(r.id)) return false
    let ok = verdict.get(r.id)
    if (ok === undefined) {
      ok = isValid(r)
      verdict.set(r.id, ok)
    }
    return ok
  }
  const take = (r: LichessRow) => {
    taken.add(r.id)
    chosen.push(r)
  }
  for (let round = 0; round < minPerTheme; round++) {
    for (const theme of PUZZLE_THEMES) {
      if (chosen.length >= n) return chosen
      const next = candidates.find((r) => r.themes.includes(theme) && usable(r))
      if (next) take(next)
    }
  }
  for (const r of candidates) {
    if (chosen.length >= n) break
    if (usable(r)) take(r)
  }
  return chosen
}

export interface CuratorOptions {
  perBucket: number
  minPerTheme: number
  candidatesPerBucket: number
}

export const DEFAULT_CURATOR_OPTIONS: CuratorOptions = { perBucket: 300, minPerTheme: 6, candidatesPerBucket: 4000 }

export interface CurationResult {
  puzzles: RatedPuzzle[]
  perBucket: number[]
  /** `id: reason` for every sampled row that failed game-core validation. */
  invalid: string[]
  /** Rows that passed the quality filter and fell in a bucket. */
  considered: number
}

/** Streams dump rows in; memory stays bounded (about 2 x candidatesPerBucket rows per bucket). */
export class Curator {
  private readonly opts: CuratorOptions
  private readonly buckets: Candidate[][] = Array.from({ length: BUCKET_COUNT }, () => [])
  private considered = 0

  constructor(opts: Partial<CuratorOptions> = {}) {
    this.opts = { ...DEFAULT_CURATOR_OPTIONS, ...opts }
  }

  add(row: LichessRow): void {
    if (!passesQuality(row)) return
    const b = bucketOf(row.rating)
    const bucket = b === null ? undefined : this.buckets[b]
    if (!bucket) return
    this.considered++
    bucket.push({ row, hash: fnv1a(row.id) })
    // Dropping anything outside the current lowest K is safe: at least K
    // lower hashes already exist, so it can never be in the final lowest K.
    if (bucket.length >= 2 * this.opts.candidatesPerBucket) {
      bucket.sort(byHash)
      bucket.length = this.opts.candidatesPerBucket
    }
  }

  result(): CurationResult {
    const invalid: string[] = []
    const isValid = (r: LichessRow): boolean => {
      const problem = validateSpec(specOfRated(r))
      if (problem) invalid.push(`${r.id}: ${problem}`)
      return problem === null
    }
    const chosen: LichessRow[] = []
    const perBucket: number[] = []
    for (const bucket of this.buckets) {
      const sorted = [...bucket].sort(byHash).slice(0, this.opts.candidatesPerBucket).map((c) => c.row)
      const picked = pickDiverse(sorted, this.opts.perBucket, this.opts.minPerTheme, isValid)
      perBucket.push(picked.length)
      chosen.push(...picked)
    }
    chosen.sort((a, b) => a.rating - b.rating || byId(a.id, b.id))
    return {
      puzzles: chosen.map(({ id, fen, moves, rating, themes }) => ({ id, fen, moves, rating, themes })),
      perBucket,
      invalid,
      considered: this.considered,
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run scripts/puzzles-curate-lib.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two scripts and their shared paths**

`scripts/puzzles-lib.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildPuzzleData, puzzleJsonOf } from '../src/puzzles/build'

const fromRoot = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))

export const CURATED_FILE = fromRoot('data/puzzles/puzzles.csv')
export const PUZZLES_JSON = fromRoot('public/puzzles/puzzles.json')

export function buildPuzzlesJson(): string {
  return puzzleJsonOf(buildPuzzleData(readFileSync(CURATED_FILE, 'utf8')))
}
```

`scripts/build-puzzles.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PUZZLES_JSON, buildPuzzlesJson } from './puzzles-lib'

const json = buildPuzzlesJson()
mkdirSync(dirname(PUZZLES_JSON), { recursive: true })
writeFileSync(PUZZLES_JSON, json)
const count = (JSON.parse(json) as { puzzles: unknown[] }).puzzles.length
console.log(`wrote ${PUZZLES_JSON}: ${count} puzzles, ${(json.length / 1024).toFixed(0)} KiB`)
```

`scripts/curate-puzzles.ts`:

```ts
/**
 * One-off, run by hand — never by npm install, build or test:
 *
 *   zstd -dc lichess_db_puzzle.csv.zst | npm run -s curate-puzzles
 *
 * Streams the full Lichess puzzle dump (CC0) from stdin and writes the
 * curated subset to data/puzzles/puzzles.csv. Then run `npm run puzzles`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { curatedCsvOf } from '../src/puzzles/build'
import { Curator, LICHESS_HEADER, parseLichessLine } from './puzzles-curate-lib'
import { CURATED_FILE } from './puzzles-lib'

if (process.stdin.isTTY) {
  console.error('usage: zstd -dc lichess_db_puzzle.csv.zst | npm run -s curate-puzzles')
  process.exit(2)
}

const curator = new Curator()
let header: string | null = null
let rows = 0
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (header === null) {
    header = line.trim()
    if (header !== LICHESS_HEADER) {
      console.error(`unexpected header: ${header}`)
      process.exit(1)
    }
    continue
  }
  rows++
  const row = parseLichessLine(line)
  if (row) curator.add(row)
}

const { puzzles, perBucket, invalid, considered } = curator.result()
mkdirSync(dirname(CURATED_FILE), { recursive: true })
writeFileSync(CURATED_FILE, curatedCsvOf(puzzles))
console.log(`read ${rows} rows; ${considered} passed quality in 600-2599`)
console.log(`kept ${puzzles.length} puzzles; per bucket: ${perBucket.join(' ')}`)
if (invalid.length > 0) console.log(`rejected ${invalid.length} sampled rows that do not replay:\n${invalid.join('\n')}`)
console.log(`wrote ${CURATED_FILE}`)
```

In `package.json` `"scripts"`, after the `"openings"` line add:

```json
    "puzzles": "tsx scripts/build-puzzles.ts",
    "curate-puzzles": "tsx scripts/curate-puzzles.ts",
```

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean (`tsconfig.node.json` covers `scripts/`); all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/puzzles-curate-lib.ts scripts/puzzles-curate-lib.test.ts scripts/curate-puzzles.ts scripts/puzzles-lib.ts scripts/build-puzzles.ts package.json
git commit -m "feat(puzzles): deterministic Lichess curation script and JSON builder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Run the curation on the downloaded dump; commit the data; NOTICE

**Model tier:** cheap.

**Files:**
- Create (generated): `data/puzzles/puzzles.csv`, `public/puzzles/puzzles.json`
- Create: `scripts/build-puzzles.test.ts`
- Modify: `NOTICE.md`

**Interfaces:**
- Consumes: `npm run curate-puzzles`, `npm run puzzles`, `CURATED_FILE`, `PUZZLES_JSON`, `buildPuzzlesJson` (T2), `parsePuzzleData`, `PUZZLE_THEMES` (T1), `bucketOf` (T2).
- Produces: the committed curated CSV and the bundled `public/puzzles/puzzles.json` (served by Vite at `/puzzles/puzzles.json`).

- [ ] **Step 1: Check the dump is there**

Run:

```bash
ls -la /private/tmp/claude-501/-Users-pniessen-CLAUDE-CODE-projects-chess-game/6760f14d-5f28-4ee6-9acb-d644e947875e/scratchpad/puzzles/lichess_db_puzzle.csv.zst
/opt/homebrew/bin/zstd -dc /private/tmp/claude-501/-Users-pniessen-CLAUDE-CODE-projects-chess-game/6760f14d-5f28-4ee6-9acb-d644e947875e/scratchpad/puzzles/lichess_db_puzzle.csv.zst | head -1
```

Expected: a ~304 MB file (304429328 bytes when planned); the header `PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate`. **If the file is gone** (scratch space is temporary), STOP and ask the user before downloading `https://database.lichess.org/lichess_db_puzzle.csv.zst` again (≈300 MB) — downloads need their explicit OK.

- [ ] **Step 2: Run the curation (takes about a minute)**

Run from the repository root:

```bash
/opt/homebrew/bin/zstd -dc /private/tmp/claude-501/-Users-pniessen-CLAUDE-CODE-projects-chess-game/6760f14d-5f28-4ee6-9acb-d644e947875e/scratchpad/puzzles/lichess_db_puzzle.csv.zst | npm run -s curate-puzzles
```

Expected output (measured on this dump while planning: 6,100,952 data rows, 1,422,037 of them passing the quality filter inside 600–2599, smallest bucket 600–799 with 1,993):

```
read 6100952 rows; 1422037 passed quality in 600-2599
kept 3000 puzzles; per bucket: 300 300 300 300 300 300 300 300 300 300
wrote .../data/puzzles/puzzles.csv
```

A few `rejected … rows that do not replay` lines are acceptable (they are replaced from the same bucket). If any bucket is below 300, stop and report it rather than loosening the filter.

- [ ] **Step 3: Build the JSON and check its size**

```bash
npm run puzzles
ls -la data/puzzles/puzzles.csv public/puzzles/puzzles.json
```

Expected: `wrote …/public/puzzles/puzzles.json: 3000 puzzles, NNN KiB` with NNN under 800 (about 450–550 expected). Run `npm run puzzles` a second time and `git diff --stat public/puzzles` — no change (deterministic).

- [ ] **Step 4: Write the data test**

`scripts/build-puzzles.test.ts`:

```ts
// @vitest-environment node
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { CURATED_FILE, PUZZLES_JSON, buildPuzzlesJson } from './puzzles-lib'
import { bucketOf } from './puzzles-curate-lib'
import { parsePuzzleData } from '../src/puzzles/data'
import { PUZZLE_THEMES } from '../src/puzzles/themes'
import type { RatedPuzzle } from '../src/puzzles/types'

function bundled(): RatedPuzzle[] {
  const set = parsePuzzleData(JSON.parse(readFileSync(PUZZLES_JSON, 'utf8')))
  if (!set) throw new Error('public/puzzles/puzzles.json is unreadable')
  return set
}

describe('bundled puzzles', () => {
  // Breaks when the CSV is edited (or the builder changes) without `npm run puzzles`.
  test('the committed JSON is exactly what the curated CSV builds to (fix: npm run puzzles)', () => {
    expect(readFileSync(PUZZLES_JSON, 'utf8') === buildPuzzlesJson()).toBe(true)
  }, 120_000)

  test('about three thousand unique puzzles, none dropped by the browser parser', () => {
    const rows = (JSON.parse(readFileSync(PUZZLES_JSON, 'utf8')) as { puzzles: unknown[] }).puzzles
    const set = bundled()
    expect(set.length).toBe(rows.length)
    expect(set.length).toBeGreaterThanOrEqual(2900)
    expect(set.length).toBeLessThanOrEqual(3000)
    expect(new Set(set.map((p) => p.id)).size).toBe(set.length)
  })

  test('balanced across the ten rating buckets 600-2599', () => {
    const counts = Array.from({ length: 10 }, () => 0)
    for (const p of bundled()) {
      const b = bucketOf(p.rating)
      if (b === null) throw new Error(`${p.id} rating ${p.rating} is out of range`)
      counts[b] = (counts[b] ?? 0) + 1
    }
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(250)
  })

  test('every theme in the filter has puzzles', () => {
    const set = bundled()
    for (const t of PUZZLE_THEMES) expect(set.filter((p) => p.themes.includes(t)).length, t).toBeGreaterThanOrEqual(10)
  })

  test('small enough to fetch lazily', () => {
    expect(statSync(PUZZLES_JSON).size).toBeLessThan(800 * 1024)
    expect(statSync(CURATED_FILE).size).toBeLessThan(800 * 1024)
  })
})
```

Run: `npx vitest run scripts/build-puzzles.test.ts`
Expected: PASS.

- [ ] **Step 5: Credit the source in NOTICE.md**

Append to `NOTICE.md`:

```markdown

Tactics puzzles: a curated subset of about 3,000 puzzles from the **Lichess
puzzle database**, released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
Source: https://database.lichess.org/#puzzles (`lichess_db_puzzle.csv.zst`,
downloaded 2026-09-21). `data/puzzles/puzzles.csv` keeps the columns
PuzzleId, FEN, Moves, Rating and Themes of the selected rows, unmodified; it
was selected by `scripts/curate-puzzles.ts` (quality filter, rating buckets,
theme diversity). `public/puzzles/puzzles.json` is generated from it by
`npm run puzzles`.

CC0 requires no attribution; this credit is given voluntarily.
```

- [ ] **Step 6: Full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add data/puzzles/puzzles.csv public/puzzles/puzzles.json scripts/build-puzzles.test.ts NOTICE.md
git commit -m "feat(puzzles): bundle 3,000 curated Lichess puzzles (CC0)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Puzzle session state machine

**Model tier:** most capable (the rules below are the design; each has a test that names the break).

**Files:**
- Create: `src/puzzles/session.ts`
- Test: `src/puzzles/session.test.ts`

**Interfaces:**
- Consumes: `PuzzleSpec` (T1), `positionAfter` (T1), `Position` (`src/game-core/position.ts`), `uciOf` (`src/game-core/notation.ts`), `uciToIntent` (`src/engine/uci.ts`), `Color`, `MoveIntent`, `Square` (`src/game-core/types.ts`).
- Produces (all pure; every transition returns a NEW object, or the SAME object when it does not apply):
  - `type SessionPhase = 'setup' | 'solver' | 'reply' | 'showing' | 'solved' | 'failed' | 'revealed'`
  - `type PuzzleOutcome = 'win' | 'loss'`
  - `interface PuzzleSession { readonly spec: PuzzleSpec; readonly played: readonly string[]; readonly step: number; readonly phase: SessionPhase; readonly wrongMove: string | null; readonly outcome: PuzzleOutcome | null }`
  - `type Verdict = 'correct' | 'solved' | 'wrong' | 'illegal' | 'ignored'`
  - `startSession(spec)`, `playSetup(s)`, `submitMove(s, intent): { session; verdict }`, `playReply(s)`, `retrySession(s)`, `noteHint(s)`, `revealSolution(s)`, `playSolutionStep(s)`
  - `positionOf(s): Position` (never throws), `solverColorOf(spec): Color`, `lastMoveOf(s): { from: Square; to: Square } | null`, `expectedMove(s): MoveIntent | null`

**Rules:**
1. `startSession`: phase `'setup'` when the spec has a setup move (the UI auto-plays it after a short delay via `playSetup`), else `'solver'`. `played` lists every UCI move applied to `spec.fen` so far.
2. `submitMove` only acts in `'solver'`; an illegal move leaves the session unchanged (`'illegal'`). A legal move is correct if it equals `solution[step]` **or gives checkmate** (any mate solves — the Lichess rule). Correct + more solution left → `'reply'` (the UI auto-plays the opponent's answer via `playReply`); correct + last move or mate → `'solved'`. Anything else → `'failed'`: the wrong move stays on the board, `wrongMove` names it.
3. `outcome` is decided ONCE, by the first decisive event, and never changes after: first clean solve → `'win'`; a wrong move, a hint (`noteHint` while in `'solver'`), or Show solution → `'loss'`. Retrying after a loss and solving never turns it into a win; revealing after a win never turns it into a loss.
4. `retrySession` (from `'solver'`, `'reply'`, `'failed'`, `'solved'`, `'revealed'`): back to the position after the setup, `step` 0, phase `'solver'`.
5. `revealSolution` (from anything but `'setup'`/`'showing'`): back to after the setup, phase `'showing'`; `playSolutionStep` then plays the whole solution one move per call, ending in `'revealed'`.

- [ ] **Step 1: Write the failing tests**

`src/puzzles/session.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  expectedMove,
  lastMoveOf,
  noteHint,
  playReply,
  playSetup,
  playSolutionStep,
  positionOf,
  retrySession,
  revealSolution,
  solverColorOf,
  startSession,
  submitMove,
  type PuzzleSession,
} from './session'
import { specOfRated } from './spec'
import type { PuzzleSpec } from './types'
import { BACK_RANK, DEFENCE, MULTI } from '../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const ready = (spec: PuzzleSpec) => playSetup(startSession(spec))
const play = (s: PuzzleSession, uci: string) =>
  submitMove(s, { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) } as never)

describe('setup', () => {
  test('a Lichess puzzle starts before the setup move, from the solver side', () => {
    const s = startSession(DEF)
    expect(s).toMatchObject({ phase: 'setup', played: [], step: 0, outcome: null, wrongMove: null })
    expect(positionOf(s).fen()).toBe(DEFENCE.fen)
    expect(solverColorOf(DEF)).toBe('b')
    expect(expectedMove(s)).toBeNull()
  })

  // Breaks if the setup move is skipped or counted as the solver's.
  test('playSetup plays moves[0] and hands the move to the solver', () => {
    const s = ready(DEF)
    expect(s).toMatchObject({ phase: 'solver', played: ['d3d6'], step: 0 })
    expect(positionOf(s).turn()).toBe('b')
    expect(lastMoveOf(s)).toEqual({ from: 'd3', to: 'd6' })
    expect(expectedMove(s)).toEqual({ from: 'f8', to: 'd8' })
  })

  test('a spec without a setup starts on the solver', () => {
    const s = startSession({ fen: DEFENCE.fen, setup: null, solution: ['d3d6'] })
    expect(s.phase).toBe('solver')
    expect(solverColorOf(s.spec)).toBe('w')
  })

  test('moves are ignored before the setup has been played', () => {
    const s = startSession(DEF)
    expect(play(s, 'd3d6')).toEqual({ session: s, verdict: 'ignored' })
  })
})

describe('solving', () => {
  // Breaks if the opponent's reply is not waited for, or the last move does not end the puzzle.
  test('correct, opponent reply, correct: solved, first try is a win', () => {
    const a = play(ready(DEF), 'f8d8')
    expect(a.verdict).toBe('correct')
    expect(a.session.phase).toBe('reply')
    const b = playReply(a.session)
    expect(b).toMatchObject({ phase: 'solver', step: 2, played: ['d3d6', 'f8d8', 'd6d8'] })
    const c = play(b, 'f6d8')
    expect(c.verdict).toBe('solved')
    expect(c.session).toMatchObject({ phase: 'solved', outcome: 'win', step: 3 })
    expect(positionOf(c.session).fen()).toBe('3b2k1/1p3ppp/pq6/8/8/1P3N2/P4PPP/3R2K1 w - - 0 29')
  })

  test('a three-move line with two replies (Lichess 00008)', () => {
    let s = ready(specOfRated(MULTI))
    for (const [mine, reply] of [['e6e7', 'b2b1'], ['b3c1', 'b1c1']] as const) {
      const out = play(s, mine)
      expect(out.verdict).toBe('correct')
      s = playReply(out.session)
      expect(s.played.at(-1)).toBe(reply)
    }
    expect(play(s, 'h6c1').session.phase).toBe('solved')
  })

  // Breaks if only the listed move is accepted (the Lichess any-mate rule).
  test('any checkmate solves, even when it is not the listed move', () => {
    const s = ready(specOfRated(BACK_RANK))
    const alt = play(s, 'a1a8')
    expect(alt.verdict).toBe('solved')
    expect(alt.session.outcome).toBe('win')
    expect(play(s, 'd1d8').verdict).toBe('solved')
    expect(play(s, 'd1d7').verdict).toBe('wrong')
  })

  test('an illegal move changes nothing', () => {
    const s = ready(DEF)
    expect(play(s, 'a6a4')).toEqual({ session: s, verdict: 'illegal' })
  })

  test('moves are ignored while the reply is pending and after the end', () => {
    const r = play(ready(DEF), 'f8d8').session
    expect(play(r, 'g8h8').verdict).toBe('ignored')
    const done = play(playReply(r), 'f6d8').session
    expect(play(done, 'g8f8').verdict).toBe('ignored')
  })
})

describe('failing, retrying and the once-only outcome', () => {
  // Breaks if the wrong move is hidden or the loss is not recorded at once.
  test('a wrong move stays on the board, fails the puzzle and decides a loss', () => {
    const out = play(ready(DEF), 'b6c7')
    expect(out.verdict).toBe('wrong')
    expect(out.session).toMatchObject({ phase: 'failed', wrongMove: 'b6c7', outcome: 'loss' })
    expect(positionOf(out.session).fen()).toBe('5rk1/1pq2ppp/p2Q1b2/8/8/1P3N2/P4PPP/3R2K1 w - - 4 28')
  })

  // Breaks if a retry wipes the loss (free rating by retrying).
  test('retry returns to after the setup; solving then stays a loss', () => {
    const failed = play(ready(DEF), 'b6c7').session
    const again = retrySession(failed)
    expect(again).toMatchObject({ phase: 'solver', played: ['d3d6'], step: 0, wrongMove: null, outcome: 'loss' })
    const solved = play(playReply(play(again, 'f8d8').session), 'f6d8').session
    expect(solved).toMatchObject({ phase: 'solved', outcome: 'loss' })
  })

  test('a hint decides a loss, but only on the solver turn', () => {
    expect(noteHint(ready(DEF)).outcome).toBe('loss')
    const setup = startSession(DEF)
    expect(noteHint(setup)).toBe(setup)
  })

  // Breaks if revealing (or hinting) after a clean solve takes the win away.
  test('after a clean solve the win is kept whatever happens next', () => {
    const won = play(ready(specOfRated(BACK_RANK)), 'd1d8').session
    expect(revealSolution(won).outcome).toBe('win')
    expect(noteHint(retrySession(won)).outcome).toBe('win')
  })

  test('retry is refused during setup and playback', () => {
    const setup = startSession(DEF)
    expect(retrySession(setup)).toBe(setup)
    const showing = revealSolution(ready(DEF))
    expect(retrySession(showing)).toBe(showing)
  })
})

describe('show solution', () => {
  // Breaks if playback starts mid-line or never reaches 'revealed'.
  test('replays the whole solution from after the setup, one move per step', () => {
    let s = revealSolution(play(ready(DEF), 'b6c7').session)
    expect(s).toMatchObject({ phase: 'showing', played: ['d3d6'], step: 0, wrongMove: null, outcome: 'loss' })
    s = playSolutionStep(s)
    expect(s).toMatchObject({ phase: 'showing', played: ['d3d6', 'f8d8'] })
    s = playSolutionStep(playSolutionStep(s))
    expect(s.phase).toBe('revealed')
    expect(positionOf(s).fen()).toBe('3b2k1/1p3ppp/pq6/8/8/1P3N2/P4PPP/3R2K1 w - - 0 29')
    expect(playSolutionStep(s)).toBe(s)
  })

  test('revealing before any move is a loss', () => {
    expect(revealSolution(ready(DEF)).outcome).toBe('loss')
  })
})

test('a corrupt spec never throws: positionOf falls back to the puzzle start or the initial position', () => {
  const s = { ...ready(DEF), played: ['a1a8'] }
  expect(positionOf(s).fen()).toBe(DEFENCE.fen)
  expect(positionOf(startSession({ fen: 'garbage', setup: null, solution: ['e2e4'] })).fen()).toBe(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  )
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/puzzles/session.test.ts`
Expected: FAIL — `Failed to resolve import "./session"`.

- [ ] **Step 3: Implement**

`src/puzzles/session.ts`:

```ts
import { Position } from '../game-core/position'
import { uciOf } from '../game-core/notation'
import type { Color, MoveIntent, Square } from '../game-core/types'
import { uciToIntent } from '../engine/uci'
import { positionAfter } from './spec'
import type { PuzzleSpec } from './types'

export type SessionPhase =
  | 'setup' //    the opponent's setup move has not been played yet (UI plays it after a delay)
  | 'solver' //   waiting for the solver's move
  | 'reply' //    the solver was right; the opponent's reply is pending (UI plays it after a delay)
  | 'showing' //  Show solution: the line is being played back
  | 'solved'
  | 'failed' //   a wrong move was played; it stays on the board
  | 'revealed' // the whole solution has been shown

export type PuzzleOutcome = 'win' | 'loss'

export interface PuzzleSession {
  readonly spec: PuzzleSpec
  /** UCI moves applied to spec.fen so far (the setup move first, when there is one). */
  readonly played: readonly string[]
  /** Index in spec.solution of the next move to be played. */
  readonly step: number
  readonly phase: SessionPhase
  /** The rejected move, while phase is 'failed'. */
  readonly wrongMove: string | null
  /** Decided once, by the first decisive event; never changes afterwards. */
  readonly outcome: PuzzleOutcome | null
}

export type Verdict = 'correct' | 'solved' | 'wrong' | 'illegal' | 'ignored'

const opening = (spec: PuzzleSpec): string[] => (spec.setup === null ? [] : [spec.setup])
const decide = (s: PuzzleSession, o: PuzzleOutcome): PuzzleOutcome => s.outcome ?? o

export function startSession(spec: PuzzleSpec): PuzzleSession {
  return { spec, played: [], step: 0, phase: spec.setup === null ? 'solver' : 'setup', wrongMove: null, outcome: null }
}

export function playSetup(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'setup' || s.spec.setup === null) return s
  return { ...s, played: [s.spec.setup], phase: 'solver' }
}

/** The displayed position. Validated specs always replay; a corrupt one degrades instead of throwing. */
export function positionOf(s: PuzzleSession): Position {
  return positionAfter(s.spec.fen, s.played) ?? positionAfter(s.spec.fen, []) ?? new Position()
}

/** The side the user plays: whoever is to move once the setup move is on the board. */
export function solverColorOf(spec: PuzzleSpec): Color {
  return positionAfter(spec.fen, opening(spec))?.turn() ?? 'w'
}

export function lastMoveOf(s: PuzzleSession): { from: Square; to: Square } | null {
  const uci = s.played[s.played.length - 1]
  const intent = uci ? uciToIntent(uci) : null
  return intent ? { from: intent.from, to: intent.to } : null
}

/** The listed solution move the solver should play now; null when it is not their turn. */
export function expectedMove(s: PuzzleSession): MoveIntent | null {
  if (s.phase !== 'solver') return null
  const uci = s.spec.solution[s.step]
  return uci ? uciToIntent(uci) : null
}

export function submitMove(s: PuzzleSession, intent: MoveIntent): { session: PuzzleSession; verdict: Verdict } {
  if (s.phase !== 'solver') return { session: s, verdict: 'ignored' }
  const position = positionOf(s)
  const r = position.tryMove(intent)
  if (!r.ok) return { session: s, verdict: 'illegal' }
  const uci = uciOf(r.move)
  const played = [...s.played, uci]
  const mates = position.status().kind === 'checkmate'
  if (uci === s.spec.solution[s.step] || mates) {
    const step = s.step + 1
    if (mates || step >= s.spec.solution.length) {
      return { session: { ...s, played, step, phase: 'solved', outcome: decide(s, 'win') }, verdict: 'solved' }
    }
    return { session: { ...s, played, step, phase: 'reply' }, verdict: 'correct' }
  }
  return { session: { ...s, played, phase: 'failed', wrongMove: uci, outcome: decide(s, 'loss') }, verdict: 'wrong' }
}

export function playReply(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'reply') return s
  const uci = s.spec.solution[s.step]
  if (uci === undefined) return { ...s, phase: 'solved' }
  return { ...s, played: [...s.played, uci], step: s.step + 1, phase: 'solver' }
}

export function retrySession(s: PuzzleSession): PuzzleSession {
  if (s.phase === 'setup' || s.phase === 'showing') return s
  return { ...s, played: opening(s.spec), step: 0, phase: 'solver', wrongMove: null }
}

/** A hint was shown: on a rated puzzle that is a loss (if nothing decided it earlier). */
export function noteHint(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'solver') return s
  return { ...s, outcome: decide(s, 'loss') }
}

export function revealSolution(s: PuzzleSession): PuzzleSession {
  if (s.phase === 'setup' || s.phase === 'showing') return s
  return { ...s, played: opening(s.spec), step: 0, phase: 'showing', wrongMove: null, outcome: decide(s, 'loss') }
}

export function playSolutionStep(s: PuzzleSession): PuzzleSession {
  if (s.phase !== 'showing') return s
  const uci = s.spec.solution[s.step]
  if (uci === undefined) return { ...s, phase: 'revealed' }
  const step = s.step + 1
  return { ...s, played: [...s.played, uci], step, phase: step >= s.spec.solution.length ? 'revealed' : 'showing' }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puzzles/session.test.ts && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/puzzles/session.ts src/puzzles/session.test.ts
git commit -m "feat(puzzles): session state machine with the any-mate rule and once-only outcome

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rating and selection

**Model tier:** cheap.

**Files:**
- Create: `src/puzzles/rating.ts`, `src/puzzles/select.ts`
- Test: `src/puzzles/rating.test.ts`, `src/puzzles/select.test.ts`

**Interfaces:**
- Consumes: `RatedPuzzle` (T1), `PuzzleOutcome` (T4).
- Produces:
  - `START_RATING = 1200`, `PROVISIONAL_GAMES = 20`, `RATING_FLOOR = 400`, `RATING_CEIL = 3200`, `kFactor(games): number`, `expectedScore(rating, opponent): number`, `nextRating(rating, puzzleRating, outcome: PuzzleOutcome, games): number`.
  - `RATING_WINDOWS = [100, 200, 400, 800, Infinity]`, `selectPuzzle(puzzles, { rating, seen, theme, excludeId?, random }): RatedPuzzle | null`.

- [ ] **Step 1: Write the failing tests**

`src/puzzles/rating.test.ts`:

```ts
import { expect, test } from 'vitest'
import { expectedScore, kFactor, nextRating, START_RATING } from './rating'

test('starts at 1200; K is 40 for the first 20 rated puzzles, then 20', () => {
  expect(START_RATING).toBe(1200)
  expect(kFactor(0)).toBe(40)
  expect(kFactor(19)).toBe(40)
  expect(kFactor(20)).toBe(20)
})

test('expected score is the Elo logistic', () => {
  expect(expectedScore(1500, 1500)).toBe(0.5)
  expect(expectedScore(1200, 1468)).toBeCloseTo(0.17614, 4)
})

// These exact values are asserted by the e2e specs too; recompute them if K or rounding change.
test('the numbers the UI will show', () => {
  expect(nextRating(1200, 1468, 'win', 0)).toBe(1233)
  expect(nextRating(1200, 1468, 'loss', 0)).toBe(1193)
  expect(nextRating(1200, 1500, 'loss', 0)).toBe(1194)
  expect(nextRating(1500, 1500, 'win', 20)).toBe(1510)
})

test('clamped to 400..3200', () => {
  expect(nextRating(400, 3000, 'loss', 0)).toBe(400)
  expect(nextRating(3200, 600, 'win', 0)).toBe(3200)
})
```

`src/puzzles/select.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { selectPuzzle } from './select'
import type { RatedPuzzle } from './types'
import { DEFENCE } from '../../tests/fixtures/puzzles'

const mk = (id: string, rating: number, themes: string[] = []): RatedPuzzle => ({ ...DEFENCE, id, rating, themes })
const SET = [mk('a', 1150), mk('b', 1310), mk('c', 1450, ['fork']), mk('d', 2100, ['fork']), mk('e', 1195)]
const base = { rating: 1200, seen: new Set<string>(), theme: null, random: () => 0 }

describe('selectPuzzle', () => {
  test('nearest window first (±100): only a and e qualify; random picks among them in data order', () => {
    expect(selectPuzzle(SET, base)?.id).toBe('a')
    expect(selectPuzzle(SET, { ...base, random: () => 0.99 })?.id).toBe('e')
  })

  // Breaks if the window never widens (a strong or weak user would get nothing).
  test('the window widens until something fits', () => {
    expect(selectPuzzle(SET, { ...base, rating: 1800 })?.id).toBe('c') // ±400 → c and d, data order → c
    expect(selectPuzzle(SET, { ...base, rating: 2800 })?.id).toBe('d') // ±800 → d only
    expect(selectPuzzle(SET, { ...base, rating: 4000 })?.id).toBe('a') // nothing within 800: anything
  })

  // Breaks if seen puzzles are served again while unseen ones remain.
  test('unseen puzzles first; once all are seen they come round again', () => {
    expect(selectPuzzle(SET, { ...base, seen: new Set(['a', 'e']) })?.id).toBe('b')
    expect(selectPuzzle(SET, { ...base, seen: new Set(['a', 'b', 'c', 'd', 'e']) })?.id).toBe('a')
  })

  test('theme filter; null when nothing has the theme', () => {
    expect(selectPuzzle(SET, { ...base, theme: 'fork' })?.id).toBe('c')
    expect(selectPuzzle(SET, { ...base, theme: 'zugzwang' })).toBeNull()
    expect(selectPuzzle([], base)).toBeNull()
  })

  test('Next never repeats the current puzzle, even when everything is seen', () => {
    expect(selectPuzzle(SET, { ...base, excludeId: 'a' })?.id).toBe('e')
    expect(selectPuzzle([mk('only', 1200)], { ...base, excludeId: 'only' })).toBeNull()
  })

  test('a random() of exactly 1 cannot index past the end', () => {
    expect(selectPuzzle(SET, { ...base, random: () => 1 })?.id).toBe('e')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/puzzles/rating.test.ts src/puzzles/select.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement**

`src/puzzles/rating.ts`:

```ts
import type { PuzzleOutcome } from './session'

export const START_RATING = 1200
/** Rated results played with the fast-moving K. */
export const PROVISIONAL_GAMES = 20
export const RATING_FLOOR = 400
export const RATING_CEIL = 3200

export function kFactor(games: number): number {
  return games < PROVISIONAL_GAMES ? 40 : 20
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400))
}

/** Elo against the puzzle's own rating; `games` = rated results before this one. */
export function nextRating(rating: number, puzzleRating: number, outcome: PuzzleOutcome, games: number): number {
  const score = outcome === 'win' ? 1 : 0
  const raw = rating + kFactor(games) * (score - expectedScore(rating, puzzleRating))
  return Math.min(RATING_CEIL, Math.max(RATING_FLOOR, Math.round(raw)))
}
```

`src/puzzles/select.ts`:

```ts
import type { RatedPuzzle } from './types'

/** Widening distance from the user's rating; the last window takes anything. */
export const RATING_WINDOWS = [100, 200, 400, 800, Number.POSITIVE_INFINITY] as const

export interface SelectOptions {
  rating: number
  seen: ReadonlySet<string>
  /** A theme id from PUZZLE_THEMES, or null for all. */
  theme: string | null
  /** The puzzle on screen: Next never serves it again. */
  excludeId?: string | null
  /** Injected so tests and e2e are deterministic. */
  random: () => number
}

export function selectPuzzle(puzzles: readonly RatedPuzzle[], o: SelectOptions): RatedPuzzle | null {
  const pool = puzzles.filter((p) => p.id !== o.excludeId && (o.theme === null || p.themes.includes(o.theme)))
  if (pool.length === 0) return null
  const unseen = pool.filter((p) => !o.seen.has(p.id))
  const source = unseen.length > 0 ? unseen : pool
  for (const w of RATING_WINDOWS) {
    const near = source.filter((p) => Math.abs(p.rating - o.rating) <= w)
    if (near.length > 0) return near[Math.min(near.length - 1, Math.floor(o.random() * near.length))] ?? null
  }
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/puzzles && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/puzzles/rating.ts src/puzzles/rating.test.ts src/puzzles/select.ts src/puzzles/select.test.ts
git commit -m "feat(puzzles): Elo puzzle rating and rating-window selection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Puzzle persistence (stats + blunder store)

**Model tier:** standard.

**Files:**
- Modify: `src/storage/storage.ts` (the `KEYS` block at lines 32–37, and the `readJson`/`writeJson`/`isRecord` helpers at lines 39–59)
- Modify: `src/storage/storage.test.ts`
- Create: `src/puzzles/store.ts`
- Test: `src/puzzles/store.test.ts`

**Interfaces:**
- Consumes: `nextRating`, `START_RATING`, `RATING_FLOOR`, `RATING_CEIL` (T5), `PuzzleOutcome` (T4), `BlunderPuzzle` (T1), `isUci`, `specOfBlunder`, `validateSpec` (T1).
- Produces:
  - From `storage.ts`: `export const STORAGE_KEYS` (adds `puzzles: 'chess-game:puzzles'`, `blunderPuzzles: 'chess-game:blunder-puzzles'`), `export function readJson(key): unknown`, `export function writeJson(key, value): void`, `export function isRecord(v): v is Record<string, unknown>` (bodies unchanged).
  - `interface PuzzleStats { rating: number; games: number; wins: number; losses: number; seen: string[] }`, `SEEN_LIMIT = 5000`, `loadPuzzleStats(): PuzzleStats`, `markPuzzleSeen(id): PuzzleStats`, `recordPuzzleResult(puzzleRating, outcome): PuzzleStats`.
  - `BLUNDER_PUZZLE_LIMIT = 200`, `loadBlunderPuzzles(): BlunderPuzzle[]`, `addBlunderPuzzles(list): BlunderPuzzle[]`, `markBlunderPuzzleSolved(id): BlunderPuzzle[]`.
  - Every mutator re-reads storage first and returns what is now stored (the caller renders the return value).

- [ ] **Step 1: Write the failing tests**

Append to `src/storage/storage.test.ts` (add `STORAGE_KEYS` to its existing import from `./storage`):

```ts
test('every storage key is namespaced and unique', () => {
  const keys = Object.values(STORAGE_KEYS)
  for (const k of keys) expect(k.startsWith('chess-game:')).toBe(true)
  expect(new Set(keys).size).toBe(keys.length)
  expect(STORAGE_KEYS.puzzles).toBe('chess-game:puzzles')
  expect(STORAGE_KEYS.blunderPuzzles).toBe('chess-game:blunder-puzzles')
})
```

`src/puzzles/store.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import {
  BLUNDER_PUZZLE_LIMIT,
  SEEN_LIMIT,
  addBlunderPuzzles,
  loadBlunderPuzzles,
  loadPuzzleStats,
  markBlunderPuzzleSolved,
  markPuzzleSeen,
  recordPuzzleResult,
} from './store'
import type { BlunderPuzzle } from './types'

const STATS = 'chess-game:puzzles'
const BLUNDERS = 'chess-game:blunder-puzzles'
const raw = (k: string) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown

beforeEach(() => localStorage.clear())

describe('puzzle stats', () => {
  test('defaults: 1200, nothing played, nothing seen', () => {
    expect(loadPuzzleStats()).toEqual({ rating: 1200, games: 0, wins: 0, losses: 0, seen: [] })
  })

  test('a result updates the rating with the right K and counts it; versioned record', () => {
    expect(recordPuzzleResult(1468, 'win')).toMatchObject({ rating: 1233, games: 1, wins: 1, losses: 0 })
    expect(recordPuzzleResult(1468, 'loss')).toMatchObject({ games: 2, wins: 1, losses: 1 })
    expect(raw(STATS)).toMatchObject({ v: 1, games: 2 })
  })

  test('seen ids are kept once each, newest last, capped (oldest dropped)', () => {
    markPuzzleSeen('a')
    markPuzzleSeen('b')
    expect(markPuzzleSeen('a').seen).toEqual(['a', 'b'])
    const full = Array.from({ length: SEEN_LIMIT }, (_, i) => `p${i}`)
    localStorage.setItem(STATS, JSON.stringify({ v: 1, rating: 1200, games: 0, wins: 0, losses: 0, seen: full }))
    const seen = markPuzzleSeen('new').seen
    expect(seen).toHaveLength(SEEN_LIMIT)
    expect(seen[0]).toBe('p1')
    expect(seen.at(-1)).toBe('new')
  })

  // Breaks if corrupt storage crashes puzzle mode or is never repaired.
  test('corrupt or malformed stats reset gracefully and are overwritten', () => {
    localStorage.setItem(STATS, '{broken')
    expect(loadPuzzleStats().rating).toBe(1200)
    markPuzzleSeen('x')
    expect(raw(STATS)).toMatchObject({ v: 1, rating: 1200, seen: ['x'] })
    localStorage.setItem(STATS, JSON.stringify({ v: 1, rating: 'high', games: -3, wins: 1.5, seen: ['a', 7, null] }))
    expect(loadPuzzleStats()).toEqual({ rating: 1200, games: 0, wins: 0, losses: 0, seen: ['a'] })
  })

  // Breaks if a newer build's data is destroyed by this build (the history lesson).
  test('a record from a newer version reads as defaults and is never overwritten', () => {
    const future = JSON.stringify({ v: 2, rating: 2000, extra: true })
    localStorage.setItem(STATS, future)
    expect(loadPuzzleStats().rating).toBe(1200)
    recordPuzzleResult(1500, 'win')
    markPuzzleSeen('z')
    expect(localStorage.getItem(STATS)).toBe(future)
  })
})

describe('blunder puzzles', () => {
  const blunder = (id: string, over: Partial<BlunderPuzzle> = {}): BlunderPuzzle => ({
    id,
    fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
    solution: 'd1d8',
    bestSan: 'Qd8#',
    blunderLabel: '25. h3',
    solver: 'w',
    gameId: 'g1',
    gameDate: '2026-09-20T10:00:00.000Z',
    opening: null,
    createdAt: '2026-09-20T10:05:00.000Z',
    solved: false,
    ...over,
  })

  test('empty by default; added ones come first, in the order given; versioned record', () => {
    expect(loadBlunderPuzzles()).toEqual([])
    addBlunderPuzzles([blunder('b:1')])
    addBlunderPuzzles([blunder('b:2'), blunder('b:3')])
    expect(loadBlunderPuzzles().map((p) => p.id)).toEqual(['b:2', 'b:3', 'b:1'])
    expect(raw(BLUNDERS)).toMatchObject({ v: 1 })
  })

  // Breaks if reviewing the same game twice (or the same position twice) duplicates puzzles.
  test('one puzzle per position: an existing id is kept as it is (solved state too)', () => {
    addBlunderPuzzles([blunder('b:1')])
    markBlunderPuzzleSolved('b:1')
    const after = addBlunderPuzzles([blunder('b:1'), blunder('b:1'), blunder('b:2')])
    expect(after.map((p) => [p.id, p.solved])).toEqual([['b:2', false], ['b:1', true]])
  })

  test(`capped at the newest ${BLUNDER_PUZZLE_LIMIT}`, () => {
    addBlunderPuzzles(Array.from({ length: BLUNDER_PUZZLE_LIMIT + 5 }, (_, i) => blunder(`b:${i}`)))
    expect(loadBlunderPuzzles()).toHaveLength(BLUNDER_PUZZLE_LIMIT)
  })

  test('markBlunderPuzzleSolved flags one puzzle and persists it', () => {
    addBlunderPuzzles([blunder('b:1'), blunder('b:2')])
    expect(markBlunderPuzzleSolved('b:2').find((p) => p.id === 'b:2')?.solved).toBe(true)
    expect(loadBlunderPuzzles().find((p) => p.id === 'b:1')?.solved).toBe(false)
  })

  // Breaks if a tampered entry can reach the board (illegal solution, wrong types).
  test('malformed or unplayable entries are dropped; corrupt data resets; a newer version is left alone', () => {
    localStorage.setItem(BLUNDERS, JSON.stringify({
      v: 1,
      puzzles: [blunder('ok'), { id: 3 }, null, blunder('illegal', { solution: 'h2h5' }), blunder('bad-side', { solver: 'x' as never })],
    }))
    expect(loadBlunderPuzzles().map((p) => p.id)).toEqual(['ok'])
    localStorage.setItem(BLUNDERS, '{broken')
    expect(loadBlunderPuzzles()).toEqual([])
    addBlunderPuzzles([blunder('b:1')])
    expect(loadBlunderPuzzles()).toHaveLength(1)
    const future = JSON.stringify({ v: 2, puzzles: [] })
    localStorage.setItem(BLUNDERS, future)
    addBlunderPuzzles([blunder('b:9')])
    expect(localStorage.getItem(BLUNDERS)).toBe(future)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/puzzles/store.test.ts src/storage/storage.test.ts`
Expected: FAIL — `./store` unresolved; `STORAGE_KEYS` is not exported.

- [ ] **Step 3: Export the storage helpers and add the keys**

In `src/storage/storage.ts`, replace lines 32–59 (the `KEYS` block through `isRecord`) with:

```ts
const KEYS = {
  settings: 'chess-game:settings',
  score: 'chess-game:score',
  inProgress: 'chess-game:in-progress',
  history: 'chess-game:history',
  puzzles: 'chess-game:puzzles',
  blunderPuzzles: 'chess-game:blunder-puzzles',
} as const

/** Every localStorage key the app uses. Other modules (src/puzzles/store.ts) read their keys from here. */
export const STORAGE_KEYS = KEYS

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is acceptable;
    // crashing the game is not.
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
```

- [ ] **Step 4: Implement the puzzle store**

`src/puzzles/store.ts`:

```ts
import { STORAGE_KEYS, isRecord, readJson, writeJson } from '../storage/storage'
import { RATING_CEIL, RATING_FLOOR, START_RATING, nextRating } from './rating'
import type { PuzzleOutcome } from './session'
import { isUci, specOfBlunder, validateSpec } from './spec'
import type { BlunderPuzzle } from './types'

const VERSION = 1
export const SEEN_LIMIT = 5000
export const BLUNDER_PUZZLE_LIMIT = 200

/**
 * Absent, unparseable or malformed data may be replaced (a graceful reset).
 * A record written by a NEWER build may not: it reads as defaults here but
 * is left untouched (see storage.ts historyWritable, commit 57057d2).
 */
function writable(key: string): boolean {
  const raw = readJson(key)
  return !(isRecord(raw) && typeof raw['v'] === 'number' && raw['v'] > VERSION)
}

// ---- rating + seen ---------------------------------------------------------

export interface PuzzleStats {
  rating: number
  /** Rated results so far (decides the K-factor). */
  games: number
  wins: number
  losses: number
  /** Ids of rated puzzles already shown, oldest first. */
  seen: string[]
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

export function loadPuzzleStats(): PuzzleStats {
  const raw = readJson(STORAGE_KEYS.puzzles)
  if (!isRecord(raw) || raw['v'] !== VERSION) return { rating: START_RATING, games: 0, wins: 0, losses: 0, seen: [] }
  const rating = raw['rating']
  const seen = raw['seen']
  return {
    rating:
      typeof rating === 'number' && Number.isFinite(rating) && rating >= RATING_FLOOR && rating <= RATING_CEIL
        ? Math.round(rating)
        : START_RATING,
    games: count(raw['games']),
    wins: count(raw['wins']),
    losses: count(raw['losses']),
    seen: Array.isArray(seen) ? seen.filter((x): x is string => typeof x === 'string').slice(-SEEN_LIMIT) : [],
  }
}

function saveStats(s: PuzzleStats): PuzzleStats {
  if (writable(STORAGE_KEYS.puzzles)) writeJson(STORAGE_KEYS.puzzles, { v: VERSION, ...s })
  return s
}

export function markPuzzleSeen(id: string): PuzzleStats {
  const s = loadPuzzleStats()
  if (s.seen.includes(id)) return s
  return saveStats({ ...s, seen: [...s.seen, id].slice(-SEEN_LIMIT) })
}

export function recordPuzzleResult(puzzleRating: number, outcome: PuzzleOutcome): PuzzleStats {
  const s = loadPuzzleStats()
  return saveStats({
    ...s,
    rating: nextRating(s.rating, puzzleRating, outcome, s.games),
    games: s.games + 1,
    wins: s.wins + (outcome === 'win' ? 1 : 0),
    losses: s.losses + (outcome === 'loss' ? 1 : 0),
  })
}

// ---- "My mistakes" ---------------------------------------------------------

function parseBlunder(v: unknown): BlunderPuzzle | null {
  if (!isRecord(v)) return null
  const str = (k: string): string | null => (typeof v[k] === 'string' ? (v[k] as string) : null)
  const id = str('id')
  const fen = str('fen')
  const solution = str('solution')
  const bestSan = str('bestSan')
  const blunderLabel = str('blunderLabel')
  const gameId = str('gameId')
  const gameDate = str('gameDate')
  const createdAt = str('createdAt')
  const { opening, solver, solved } = v
  if (!id || !fen || !solution || !bestSan || !blunderLabel || !gameId || !gameDate || !createdAt) return null
  if (!isUci(solution) || (solver !== 'w' && solver !== 'b') || typeof solved !== 'boolean') return null
  if (opening !== null && typeof opening !== 'string') return null
  const p: BlunderPuzzle = { id, fen, solution, bestSan, blunderLabel, solver, gameId, gameDate, opening, createdAt, solved }
  // Never let a tampered entry reach the board.
  return validateSpec(specOfBlunder(p)) === null ? p : null
}

/** Newest first. Malformed or unplayable entries read as absent. */
export function loadBlunderPuzzles(): BlunderPuzzle[] {
  const raw = readJson(STORAGE_KEYS.blunderPuzzles)
  if (!isRecord(raw) || raw['v'] !== VERSION || !Array.isArray(raw['puzzles'])) return []
  return (raw['puzzles'] as unknown[]).map(parseBlunder).filter((p): p is BlunderPuzzle => p !== null)
}

function saveBlunders(list: BlunderPuzzle[]): BlunderPuzzle[] {
  if (!writable(STORAGE_KEYS.blunderPuzzles)) return loadBlunderPuzzles()
  const capped = list.slice(0, BLUNDER_PUZZLE_LIMIT)
  writeJson(STORAGE_KEYS.blunderPuzzles, { v: VERSION, puzzles: capped })
  return capped
}

/** New positions go first, in the given order; a position already stored is kept as it is. */
export function addBlunderPuzzles(list: readonly BlunderPuzzle[]): BlunderPuzzle[] {
  const existing = loadBlunderPuzzles()
  const have = new Set(existing.map((p) => p.id))
  const fresh: BlunderPuzzle[] = []
  for (const p of list) {
    if (have.has(p.id)) continue
    have.add(p.id)
    fresh.push(p)
  }
  if (fresh.length === 0) return existing
  return saveBlunders([...fresh, ...existing])
}

export function markBlunderPuzzleSolved(id: string): BlunderPuzzle[] {
  return saveBlunders(loadBlunderPuzzles().map((p) => (p.id === id ? { ...p, solved: true } : p)))
}
```

- [ ] **Step 5: Run the tests, the typecheck and the whole suite**

Run: `npx vitest run src/puzzles src/storage && npm run typecheck && npm test`
Expected: PASS; clean; everything else still green (the storage helpers' behaviour is unchanged — only exported).

- [ ] **Step 6: Commit**

```bash
git add src/storage/storage.ts src/storage/storage.test.ts src/puzzles/store.ts src/puzzles/store.test.ts
git commit -m "feat(puzzles): persist puzzle rating, seen ids and blunder puzzles defensively

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Blunder puzzles from reviewed games

**Model tier:** most capable (touches `App.tsx`'s review/history guards, which went through several review rounds in Phase 2).

**Files:**
- Create: `src/puzzles/blunders.ts`
- Test: `src/puzzles/blunders.test.ts`
- Modify: `src/ui/history/record.ts`, `src/ui/history/record.test.ts` (`humanSidesOf`)
- Modify: `src/ui/App.tsx` (imports at lines 3 and 56; after `historyRef` at line 338; `onComplete` at lines 723–726; `handleReview` at lines 742–746)
- Create: `tests/e2e/blunder-puzzles.spec.ts`

**Interfaces:**
- Consumes: `GameReview`, `ReviewedMove` (`src/review/run.ts`), `moveLabel(ply, san, firstMover)` (`src/review/moveNumber.ts`), `Position`, `uciToIntent`, `BlunderPuzzle` (T1), `addBlunderPuzzles` (T6), `HistoryEntry`, `seatLabel` (`src/ui/history/record.ts`), `historyRef`/`reviewKey`/`updateHistoryAccuracy` (existing App wiring).
- Produces:
  - `blunderIdOf(fen: string): string` → `'b:' + EPD` (string ops; no chess.js).
  - `blunderPuzzlesFrom({ review, startFen, moves, humanSides, source: { gameId, gameDate, opening }, now }): BlunderPuzzle[]`
  - `humanSidesOf(entry: Pick<HistoryEntry, 'white' | 'black'>): Color[]`
  - App behaviour: when a review completes for a game that has a history entry (a live finish or a replay from History), each move by a HUMAN side (per that entry's `White`/`Black` labels) classified `'blunder'` becomes a stored puzzle: the position before it, solution = the review's `bestUci`.

**Rulings:**
- **Engine-verified solution without a new engine call:** the review already holds `bestUci` for every move — the engine's best move from the position before it, searched through `controller.analyze` at `REVIEW_BUDGET` (depth 12). That is the solution. It is replayed through game-core before saving (an illegal or missing best move, or best = played, skips the puzzle). The puzzle is one move long; any mating move also solves (the session's rule).
- **Only games in history produce puzzles.** An imported PGN (not in history) has no "which game" to point back to and may not be the user's own play; reviewing it adds nothing. A replayed one-player game counts only the side whose history label is `Human` (the replay itself runs as two-player, so the config cannot be used).

- [ ] **Step 1: Write the failing tests**

`src/puzzles/blunders.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { blunderIdOf, blunderPuzzlesFrom } from './blunders'
import { gameFromSan } from '../game-core/io'
import { uciOf } from '../game-core/notation'
import { STARTING_FEN, type PlayedMove } from '../game-core/types'
import type { GameReview, ReviewedMove } from '../review/run'
import type { MoveClass } from '../review/analysis'

const BEFORE_NF6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'
const SOURCE = { gameId: 'g-1', gameDate: '2026-09-21T10:00:00.000Z', opening: "C23 Bishop's Opening" }
const NOW = new Date('2026-09-21T11:00:00.000Z')

/** Scholar's mate; ply `flag` (1-based) is a blunder whose best move is `best`. */
function scholar(flag = 6, best: string | null = 'g7g6', cls: MoveClass = 'blunder') {
  const r = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  if (!r.ok) throw new Error(r.error)
  const moves: PlayedMove[] = [...r.game.moves]
  const reviewed: ReviewedMove[] = moves.map((m, i) => {
    const hit = i + 1 === flag
    return {
      ply: i + 1, san: m.san, uci: uciOf(m), mover: m.color,
      classification: hit ? cls : 'ok', loss: hit ? 60 : 1,
      bestUci: hit ? best : uciOf(m), bestSan: null,
    }
  })
  const review: GameReview = { firstMover: 'w', evals: [], moves: reviewed, accuracy: { w: null, b: null } }
  return { review, moves, startFen: r.game.startFen }
}

describe('blunderPuzzlesFrom', () => {
  test("Black's 3...Nf6?? becomes a one-move puzzle from the position before it", () => {
    const { review, moves, startFen } = scholar()
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([
      {
        id: 'b:r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq -',
        fen: BEFORE_NF6,
        solution: 'g7g6',
        bestSan: 'g6',
        blunderLabel: '3... Nf6',
        solver: 'b',
        gameId: 'g-1',
        gameDate: '2026-09-21T10:00:00.000Z',
        opening: "C23 Bishop's Opening",
        createdAt: '2026-09-21T11:00:00.000Z',
        solved: false,
      },
    ])
  })

  // Breaks if the engine's (or another human's) blunders become "my" mistakes.
  test('only human sides count', () => {
    const { review, moves, startFen } = scholar()
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['w'], source: SOURCE, now: NOW })).toEqual([])
  })

  test('mistakes and inaccuracies are not blunders', () => {
    const { review, moves, startFen } = scholar(6, 'g7g6', 'mistake')
    expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([])
  })

  // Breaks if an unverified or unplayable "solution" is stored.
  test('no best move, an illegal best move, or best = played: skipped', () => {
    for (const best of [null, 'a1a8', 'g8f6']) {
      const { review, moves, startFen } = scholar(6, best)
      expect(blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['b'], source: SOURCE, now: NOW })).toEqual([])
    }
  })

  test('a blunder on the first move uses the start position', () => {
    const { review, moves, startFen } = scholar(1, 'd2d4')
    const [p] = blunderPuzzlesFrom({ review, moves, startFen, humanSides: ['w'], source: SOURCE, now: NOW })
    expect(p).toMatchObject({ fen: STARTING_FEN, solution: 'd2d4', bestSan: 'd4', blunderLabel: '1. e4', solver: 'w' })
  })
})

test('blunderIdOf keys a position by its EPD (move counters ignored)', () => {
  expect(blunderIdOf(BEFORE_NF6)).toBe('b:r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq -')
  expect(blunderIdOf(BEFORE_NF6.replace(' 3 3', ' 0 9'))).toBe(blunderIdOf(BEFORE_NF6))
})
```

Append to `src/ui/history/record.test.ts` (extend its import with `humanSidesOf`):

```ts
test('humanSidesOf reads the stored seat labels', () => {
  expect(humanSidesOf({ white: 'Human', black: 'Stockfish (level 3)' })).toEqual(['w'])
  expect(humanSidesOf({ white: 'Stockfish (level 3)', black: 'Human' })).toEqual(['b'])
  expect(humanSidesOf({ white: 'Human', black: 'Human' })).toEqual(['w', 'b'])
  expect(humanSidesOf({ white: 'Stockfish (level 1)', black: 'Stockfish (level 1)' })).toEqual([])
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/puzzles/blunders.test.ts src/ui/history/record.test.ts`
Expected: FAIL — `./blunders` unresolved; `humanSidesOf` is not exported.

- [ ] **Step 3: Implement**

`src/puzzles/blunders.ts`:

```ts
import { Position } from '../game-core/position'
import type { Color, PlayedMove } from '../game-core/types'
import { uciToIntent } from '../engine/uci'
import { moveLabel } from '../review/moveNumber'
import type { GameReview } from '../review/run'
import type { BlunderPuzzle } from './types'

/** One puzzle per position: placement, side, castling, en passant — no move counters. */
export function blunderIdOf(fen: string): string {
  return `b:${fen.split(' ').slice(0, 4).join(' ')}`
}

export interface BlunderSource {
  gameId: string
  gameDate: string
  opening: string | null
}

/**
 * Every move by a human side that the review classified as a blunder,
 * turned into a one-move puzzle: the position before it, solved by the
 * engine's best move from the review. The best move is replayed through
 * game-core first; anything unusable is skipped.
 */
export function blunderPuzzlesFrom(opts: {
  review: GameReview
  startFen: string
  moves: readonly PlayedMove[]
  humanSides: readonly Color[]
  source: BlunderSource
  now: Date
}): BlunderPuzzle[] {
  const out: BlunderPuzzle[] = []
  for (const m of opts.review.moves) {
    if (m.classification !== 'blunder' || !opts.humanSides.includes(m.mover)) continue
    if (m.bestUci === null || m.bestUci === m.uci) continue
    const fen = m.ply === 1 ? opts.startFen : opts.moves[m.ply - 2]?.fenAfter
    if (!fen) continue
    const loaded = Position.fromFen(fen)
    const intent = uciToIntent(m.bestUci)
    if (!loaded.ok || !intent || loaded.position.turn() !== m.mover) continue
    const best = loaded.position.tryMove(intent)
    if (!best.ok) continue
    out.push({
      id: blunderIdOf(fen),
      fen,
      solution: m.bestUci,
      bestSan: best.move.san,
      blunderLabel: moveLabel(m.ply, m.san, opts.review.firstMover),
      solver: m.mover,
      gameId: opts.source.gameId,
      gameDate: opts.source.gameDate,
      opening: opts.source.opening,
      createdAt: opts.now.toISOString(),
      solved: false,
    })
  }
  return out
}
```

In `src/ui/history/record.ts`, add `import type { Color } from '../../game-core/types'` to the imports and append:

```ts
/** Which sides a human played, from the entry's own labels (a replay runs as two-player, so its config cannot tell). */
export function humanSidesOf(entry: Pick<HistoryEntry, 'white' | 'black'>): Color[] {
  const human = seatLabel({ kind: 'human' })
  return (['w', 'b'] as const).filter((c) => (c === 'w' ? entry.white : entry.black) === human)
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/puzzles/blunders.test.ts src/ui/history/record.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into App.tsx**

1. Line 3: add `PlayedMove` to the type import:
   `import type { Color, DrawReason, GameStatus, PieceSymbol, PlayedMove, Square } from '../game-core/types'`
2. Line 56: `import { historyEntryFor, humanSidesOf, newHistoryId } from './history/record'`, and below it add:

```ts
import { blunderPuzzlesFrom } from '../puzzles/blunders'
import { addBlunderPuzzles } from '../puzzles/store'
```

3. Directly after the `historyRef` declaration (line 338) add:

```ts
  /**
   * The exact input of the review that is running or done, keyed like
   * historyRef. Phase 3: its blunders become puzzles, and the positions
   * must come from the moves that were REVIEWED, never from whatever the
   * live Game holds by the time the review completes.
   */
  const reviewInputRef = useRef<{ key: string; startFen: string; moves: PlayedMove[] } | null>(null)
```

4. Replace the `onComplete` property (lines 723–726) with:

```ts
    onComplete: (r) => {
      const rec = historyRef.current
      if (!rec || rec.key !== reviewKey) return
      const games = updateHistoryAccuracy(rec.id, r.accuracy)
      setHistory(games)
      // Phase 3: the human side's blunders become "My mistakes" puzzles —
      // only for a game in history, whose entry says which sides were human
      // (a replay runs as two-player, so snapshot.config cannot tell).
      const input = reviewInputRef.current
      const entry = games.find((e) => e.id === rec.id)
      if (!input || input.key !== rec.key || !entry) return
      addBlunderPuzzles(
        blunderPuzzlesFrom({
          review: r,
          startFen: input.startFen,
          moves: input.moves,
          humanSides: humanSidesOf(entry),
          source: { gameId: entry.id, gameDate: entry.date, opening: entry.opening },
          now: new Date(),
        }),
      )
    },
```

5. Replace `handleReview` (lines 742–746) with:

```ts
  const handleReview = () => {
    const moves = [...game.moves]
    const finalStatus = game.status()
    reviewInputRef.current = { key: reviewKey, startFen: game.startFen, moves }
    review.start({ startFen: game.startFen, moves, finalStatus })
  }
```

Keep the long comment block above `handleReview` unchanged.

- [ ] **Step 6: Write the e2e spec**

`tests/e2e/blunder-puzzles.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline } from './helpers'

const KEY = 'chess-game:blunder-puzzles'
const BEFORE_NF6 = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3'

async function play(page: Page, moves: Array<[string, string]>) {
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }
}

/**
 * A real two-player Scholar's mate (both sides Human in history), then a
 * real review. Driven, not seeded: 3...Nf6?? allows mate in one, so it is a
 * blunder at any search depth (review.spec relies on the same fact), which
 * keeps this deterministic while exercising the real review -> store path.
 */
async function playScholarsMateAndReview(page: Page) {
  await play(page, [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']])
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
}

const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as unknown, KEY)

test.beforeEach(async ({ page }) => {
  await coachOffline(page)
  await page.goto('/')
})

// Breaks if App stops handing completed reviews to blunderPuzzlesFrom/addBlunderPuzzles.
test('reviewing a finished game saves the human blunder as a puzzle with an engine best move', async ({ page }) => {
  await playScholarsMateAndReview(page)
  await expect
    .poll(() => stored(page))
    .toMatchObject({
      v: 1,
      puzzles: expect.arrayContaining([
        expect.objectContaining({ fen: BEFORE_NF6, blunderLabel: '3... Nf6', solver: 'b', solved: false }),
      ]),
    })
  const data = (await stored(page)) as { puzzles: Array<{ fen: string; solution: string }> }
  const p = data.puzzles.find((x) => x.fen === BEFORE_NF6)
  expect(p?.solution).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/)
  expect(p?.solution).not.toBe('g8f6')
})

// Breaks if imported (non-history) games start producing "my" mistakes.
test('an imported game that is not in history adds no puzzles', async ({ page }) => {
  await page.getByTestId('import-text').fill('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0')
  await page.getByTestId('import-submit').click()
  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await page.getByTestId('tab-review').click()
  await page.getByTestId('review-start').click()
  await expect(page.getByTestId('accuracy-w')).toBeVisible({ timeout: 60_000 })
  expect(await stored(page)).toBeNull()
})
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npx playwright test tests/e2e/blunder-puzzles.spec.ts tests/e2e/review.spec.ts tests/e2e/history.spec.ts`
Expected: clean; all unit tests pass; the new spec and the existing review/history specs pass.

Then: `npm run e2e`
Expected: 37/37.

- [ ] **Step 8: Commit**

```bash
git add src/puzzles/blunders.ts src/puzzles/blunders.test.ts src/ui/history/record.ts src/ui/history/record.test.ts src/ui/App.tsx tests/e2e/blunder-puzzles.spec.ts
git commit -m "feat(puzzles): save the human side's reviewed blunders as puzzles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `usePuzzleSession` hook + pure puzzle view helpers

**Model tier:** standard.

**Files:**
- Create: `src/ui/puzzles/puzzleView.ts`, `src/ui/puzzles/usePuzzleSession.ts`
- Test: `src/ui/puzzles/puzzleView.test.ts`, `src/ui/puzzles/usePuzzleSession.test.tsx`

**Interfaces:**
- Consumes: the whole session API (T4), `PuzzleSpec` (T1), `hintAnnotations(stage, suggestion)` and `hintText(stage, suggestion, reasoning)` (`src/ui/hints/hintView.ts`), `HintSuggestion` (`src/coach/hints.ts`), `Annotation` (`src/ui/Board/annotations.ts`), `uciToIntent`.
- Produces:
  - `type PuzzleHintStage = 0 | 1 | 2` — 1 highlights the piece to move, 2 adds the arrow. There is no reasoning stage in puzzles.
  - `sideName(c: Color): 'White' | 'Black'`, `puzzleStatusText(s, solver): string`, `hintSuggestionOf(s): HintSuggestion | null` (from the stored solution — never the engine), `puzzleAnnotations(s, stage): Annotation[]`, `puzzleHintText(s, stage): string`, `puzzleHintButtonLabel(stage): string`, `ratingDeltaText(delta): string`.
  - `PUZZLE_DELAYS = { setup: 600, reply: 400, solutionStep: 700 }` (ms), `usePuzzleSession(spec: PuzzleSpec | null, key: string | null, delays?) -> { session: PuzzleSession | null; hintStage: PuzzleHintStage; submit(intent: MoveIntent): void; retry(): void; hint(): void; showSolution(): void }`. A new `key` restarts on the new spec immediately (during render — no frame of the old puzzle). Setup, replies and solution playback advance on timers; a timer only ever advances the exact session it was scheduled for.

**Status texts (exact; the e2e specs assert them):** `setup` → `Watch your opponent's move…`; `solver` at step 0 → `Find the best move for White.` / `…for Black.`; `solver` later → `Correct! Keep going.`; `reply` → `Correct!`; `showing` → `Showing the solution…`; `solved` → `Solved!`; `failed` → `That's not it. Retry, or show the solution.`; `revealed` → `Solution shown.` (ASCII apostrophes; `…` is U+2026.)

- [ ] **Step 1: Write the failing tests**

`src/ui/puzzles/puzzleView.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  hintSuggestionOf,
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
} from './puzzleView'
import { playReply, playSetup, playSolutionStep, revealSolution, startSession, submitMove } from '../../puzzles/session'
import { specOfRated } from '../../puzzles/spec'
import { DEFENCE } from '../../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const ready = playSetup(startSession(DEF))
const reply = submitMove(ready, { from: 'f8', to: 'd8' }).session
const failed = submitMove(ready, { from: 'b6', to: 'c7' }).session
const solved = submitMove(playReply(reply), { from: 'f6', to: 'd8' }).session

test('status text for every phase', () => {
  expect(puzzleStatusText(startSession(DEF), 'b')).toBe("Watch your opponent's move…")
  expect(puzzleStatusText(ready, 'b')).toBe('Find the best move for Black.')
  expect(puzzleStatusText(reply, 'b')).toBe('Correct!')
  expect(puzzleStatusText(playReply(reply), 'b')).toBe('Correct! Keep going.')
  expect(puzzleStatusText(failed, 'b')).toBe("That's not it. Retry, or show the solution.")
  expect(puzzleStatusText(solved, 'b')).toBe('Solved!')
  const showing = revealSolution(ready)
  expect(puzzleStatusText(showing, 'b')).toBe('Showing the solution…')
  expect(puzzleStatusText(playSolutionStep(playSolutionStep(playSolutionStep(showing))), 'b')).toBe('Solution shown.')
  expect(sideName('w')).toBe('White')
})

// Breaks if the hint is taken from anywhere but the stored solution.
test('the hint suggestion is the listed solution move, only on the solver turn', () => {
  expect(hintSuggestionOf(ready)).toMatchObject({ from: 'f8', to: 'd8', san: 'Rd8', piece: 'r', lines: [] })
  expect(hintSuggestionOf(reply)).toBeNull()
  expect(hintSuggestionOf(startSession(DEF))).toBeNull()
})

describe('annotations (reusing the hint overlay)', () => {
  test('stage 0 nothing; stage 1 the piece; stage 2 the piece and the move', () => {
    expect(puzzleAnnotations(ready, 0)).toEqual([])
    expect(puzzleAnnotations(ready, 1)).toEqual([{ kind: 'square', square: 'f8', tone: 'hint' }])
    expect(puzzleAnnotations(ready, 2)).toEqual([
      { kind: 'square', square: 'f8', tone: 'hint' },
      { kind: 'arrow', from: 'f8', to: 'd8', tone: 'hint' },
    ])
  })

  test('a wrong move is marked as a blunder; the solving move as best', () => {
    expect(puzzleAnnotations(failed, 0)).toEqual([{ kind: 'square', square: 'c7', tone: 'blunder' }])
    expect(puzzleAnnotations(solved, 0)).toEqual([{ kind: 'square', square: 'd8', tone: 'best' }])
  })
})

test('hint text and button label', () => {
  expect(puzzleHintText(ready, 0)).toBe('')
  expect(puzzleHintText(ready, 1)).toBe('Look at your rook.')
  expect(puzzleHintText(ready, 2)).toBe('Look at your rook. Try Rd8.')
  expect(puzzleHintButtonLabel(0)).toBe('Hint')
  expect(puzzleHintButtonLabel(1)).toBe('Show move')
  expect(puzzleHintButtonLabel(2)).toBe('Hint')
})

test('rating change text', () => {
  expect(ratingDeltaText(33)).toBe('+33')
  expect(ratingDeltaText(-7)).toBe('-7')
  expect(ratingDeltaText(0)).toBe('+0')
})
```

`src/ui/puzzles/usePuzzleSession.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { usePuzzleSession } from './usePuzzleSession'
import { specOfRated } from '../../puzzles/spec'
import type { PuzzleSpec } from '../../puzzles/types'
import { BACK_RANK, DEFENCE } from '../../../tests/fixtures/puzzles'

const DEF = specOfRated(DEFENCE)
const BACK = specOfRated(BACK_RANK)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

function mount(spec: PuzzleSpec | null = DEF, key: string | null = 'k1') {
  return renderHook(({ s, k }) => usePuzzleSession(s, k), {
    initialProps: { s: spec as PuzzleSpec | null, k: key as string | null },
  })
}

describe('usePuzzleSession', () => {
  // Breaks if the setup or the opponent's reply is not played automatically after its delay.
  test('plays the setup after 600 ms, waits for the solver, replies after 400 ms, solves', () => {
    const { result } = mount()
    expect(result.current.session?.phase).toBe('setup')
    advance(599)
    expect(result.current.session?.phase).toBe('setup')
    advance(1)
    expect(result.current.session?.phase).toBe('solver')
    act(() => result.current.submit({ from: 'f8', to: 'd8' }))
    expect(result.current.session?.phase).toBe('reply')
    advance(400)
    expect(result.current.session?.played).toEqual(['d3d6', 'f8d8', 'd6d8'])
    act(() => result.current.submit({ from: 'f6', to: 'd8' }))
    expect(result.current.session).toMatchObject({ phase: 'solved', outcome: 'win' })
  })

  // Breaks if a hint is free on a rated puzzle, or its stage survives a move.
  test('hint: two stages then no more; it decides a loss; a move resets the stage', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(1)
    expect(result.current.session?.outcome).toBe('loss')
    act(() => result.current.hint())
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(2)
    act(() => result.current.submit({ from: 'f8', to: 'd8' }))
    expect(result.current.hintStage).toBe(0)
  })

  test('an illegal move changes nothing', () => {
    const { result } = mount()
    advance(600)
    const before = result.current.session
    act(() => result.current.submit({ from: 'a6', to: 'a4' }))
    expect(result.current.session).toBe(before)
  })

  test('show solution plays the whole line back, one move every 700 ms', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.showSolution())
    expect(result.current.session).toMatchObject({ phase: 'showing', played: ['d3d6'] })
    // One act() per step: the next timer is only scheduled once React has committed the previous one.
    advance(700)
    expect(result.current.session?.played).toHaveLength(2)
    advance(700)
    expect(result.current.session?.played).toHaveLength(3)
    advance(700)
    expect(result.current.session).toMatchObject({ phase: 'revealed', outcome: 'loss' })
    expect(result.current.session?.played).toHaveLength(4)
  })

  test('retry goes back to after the setup', () => {
    const { result } = mount()
    advance(600)
    act(() => result.current.submit({ from: 'b6', to: 'c7' }))
    expect(result.current.session?.phase).toBe('failed')
    act(() => result.current.retry())
    expect(result.current.session).toMatchObject({ phase: 'solver', played: ['d3d6'], outcome: 'loss' })
  })

  // Breaks if a timer scheduled for the old puzzle advances the new one.
  test('a new key restarts on the new puzzle at once; the old timer is dropped', () => {
    const { result, rerender } = mount()
    advance(300)
    rerender({ s: BACK, k: 'k2' })
    expect(result.current.session).toMatchObject({ phase: 'setup', played: [] })
    expect(result.current.session?.spec).toBe(BACK)
    advance(300)
    expect(result.current.session?.phase).toBe('setup')
    advance(300)
    expect(result.current.session).toMatchObject({ phase: 'solver', played: ['b7b6'] })
  })

  test('no spec, no session', () => {
    const { result } = mount(null, null)
    expect(result.current.session).toBeNull()
    act(() => result.current.hint())
    expect(result.current.hintStage).toBe(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/puzzles`
Expected: FAIL — unresolved `./puzzleView` and `./usePuzzleSession`.

- [ ] **Step 3: Implement**

`src/ui/puzzles/puzzleView.ts`:

```ts
import type { HintSuggestion } from '../../coach/hints'
import { uciToIntent } from '../../engine/uci'
import type { Color } from '../../game-core/types'
import { expectedMove, lastMoveOf, positionOf, type PuzzleSession } from '../../puzzles/session'
import type { Annotation } from '../Board/annotations'
import { hintAnnotations, hintText } from '../hints/hintView'

/** 1 = highlight the piece to move, 2 = also draw the move. Puzzles have no reasoning stage. */
export type PuzzleHintStage = 0 | 1 | 2

export function sideName(c: Color): 'White' | 'Black' {
  return c === 'w' ? 'White' : 'Black'
}

export function puzzleStatusText(s: PuzzleSession, solver: Color): string {
  switch (s.phase) {
    case 'setup':
      return "Watch your opponent's move…"
    case 'solver':
      return s.step === 0 ? `Find the best move for ${sideName(solver)}.` : 'Correct! Keep going.'
    case 'reply':
      return 'Correct!'
    case 'showing':
      return 'Showing the solution…'
    case 'solved':
      return 'Solved!'
    case 'failed':
      return "That's not it. Retry, or show the solution."
    case 'revealed':
      return 'Solution shown.'
  }
}

/** The listed solution move as a hint — puzzles never ask the engine. */
export function hintSuggestionOf(s: PuzzleSession): HintSuggestion | null {
  const intent = expectedMove(s)
  if (!intent) return null
  const position = positionOf(s)
  const played = position.clone().tryMove(intent)
  if (!played.ok) return null
  return {
    fen: position.fen(),
    from: played.move.from,
    to: played.move.to,
    san: played.move.san,
    piece: played.move.piece,
    lines: [],
  }
}

export function puzzleAnnotations(s: PuzzleSession, stage: PuzzleHintStage): Annotation[] {
  if (s.phase === 'failed' && s.wrongMove) {
    const wrong = uciToIntent(s.wrongMove)
    return wrong ? [{ kind: 'square', square: wrong.to, tone: 'blunder' }] : []
  }
  if (s.phase === 'solved') {
    const last = lastMoveOf(s)
    return last ? [{ kind: 'square', square: last.to, tone: 'best' }] : []
  }
  return hintAnnotations(stage, hintSuggestionOf(s))
}

export function puzzleHintText(s: PuzzleSession, stage: PuzzleHintStage): string {
  return hintText(stage, hintSuggestionOf(s), null)
}

export function puzzleHintButtonLabel(stage: PuzzleHintStage): string {
  return stage === 1 ? 'Show move' : 'Hint'
}

export function ratingDeltaText(delta: number): string {
  return `${delta >= 0 ? '+' : '-'}${Math.abs(delta)}`
}
```

`src/ui/puzzles/usePuzzleSession.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import type { MoveIntent } from '../../game-core/types'
import {
  noteHint,
  playReply,
  playSetup,
  playSolutionStep,
  retrySession,
  revealSolution,
  startSession,
  submitMove,
  type PuzzleSession,
} from '../../puzzles/session'
import type { PuzzleSpec } from '../../puzzles/types'
import type { PuzzleHintStage } from './puzzleView'

export interface PuzzleDelays {
  setup: number
  reply: number
  solutionStep: number
}

export const PUZZLE_DELAYS: PuzzleDelays = { setup: 600, reply: 400, solutionStep: 700 }

interface State {
  key: string | null
  session: PuzzleSession | null
  hint: PuzzleHintStage
}

const fresh = (spec: PuzzleSpec | null, key: string | null): State => ({
  key,
  session: spec ? startSession(spec) : null,
  hint: 0,
})

/**
 * One puzzle attempt. `key` identifies the puzzle being shown (a new key =
 * a new attempt, even of the same puzzle); `spec` is only read when the key
 * changes. All transitions are the pure functions of src/puzzles/session.ts.
 */
export function usePuzzleSession(spec: PuzzleSpec | null, key: string | null, delays: PuzzleDelays = PUZZLE_DELAYS) {
  const [state, setState] = useState<State>(() => fresh(spec, key))

  // A new puzzle restarts during render (React's "adjust state on prop
  // change" pattern): no frame, and no effect, ever sees the old session.
  let current = state
  if (state.key !== key) {
    current = fresh(spec, key)
    setState(current)
  }
  const { session } = current

  useEffect(() => {
    if (!session) return
    const next =
      session.phase === 'setup'
        ? { run: playSetup, ms: delays.setup }
        : session.phase === 'reply'
          ? { run: playReply, ms: delays.reply }
          : session.phase === 'showing'
            ? { run: playSolutionStep, ms: delays.solutionStep }
            : null
    if (!next) return
    // Only ever advance the exact session this timer was scheduled for.
    const timer = setTimeout(
      () => setState((s) => (s.session === session ? { ...s, session: next.run(session) } : s)),
      next.ms,
    )
    return () => clearTimeout(timer)
  }, [session, delays])

  const submit = useCallback((intent: MoveIntent) => {
    setState((s) => {
      if (!s.session) return s
      const out = submitMove(s.session, intent)
      return out.session === s.session ? s : { ...s, session: out.session, hint: 0 }
    })
  }, [])

  const retry = useCallback(() => {
    setState((s) => (s.session ? { ...s, session: retrySession(s.session), hint: 0 } : s))
  }, [])

  const hint = useCallback(() => {
    setState((s) => {
      if (!s.session || s.session.phase !== 'solver' || s.hint >= 2) return s
      return { ...s, session: noteHint(s.session), hint: (s.hint + 1) as PuzzleHintStage }
    })
  }, [])

  const showSolution = useCallback(() => {
    setState((s) => (s.session ? { ...s, session: revealSolution(s.session), hint: 0 } : s))
  }, [])

  return { session, hintStage: current.hint, submit, retry, hint, showSolution }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/puzzles && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS. (No UI is reachable yet, so no Playwright spec in this task; Task 9's specs cover this hook in the browser.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/puzzles/puzzleView.ts src/ui/puzzles/puzzleView.test.ts src/ui/puzzles/usePuzzleSession.ts src/ui/puzzles/usePuzzleSession.test.tsx
git commit -m "feat(puzzles): session hook with timed setup/replies and graded hint view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Puzzle screen (rated) + App switch that pauses the game

**Model tier:** most capable (the switch must leave every Phase 1/2 game invariant intact).

**Files:**
- Create: `src/ui/puzzles/usePuzzleMode.ts`, `src/ui/puzzles/usePuzzleMode.test.tsx`
- Create: `src/ui/puzzles/PuzzleScreen.tsx`, `src/ui/puzzles/PuzzleScreen.test.tsx`, `src/ui/puzzles/puzzles.css`
- Modify: `src/ui/panels/NewGame.tsx` (props and the `new-game` button)
- Modify: `src/ui/App.tsx` (imports; after `const snapshot = useMatch(controller)`; before `// ---- render`; the `<NewGame … />` element)
- Modify: `src/ui/App.test.tsx`
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/puzzles.spec.ts`

**Interfaces:**
- Consumes: `MatchController.snapshot()/pause()/resume()` (`src/match/controller.ts`; `pause()` is a no-op when idle/finished, bumps `requestId` so an in-flight engine reply is dropped, and pauses the clock; `resume()` re-asks the engine when it is its turn and restarts the clock), `MatchPhase` (`src/match/types.ts`), `Board`, `Highlights` (`src/ui/Board/Board.tsx`), `Promotion`, `reduceSelection`/`SelectionState`, T1–T8.
- Produces:
  - `interface PausableMatch { snapshot(): { phase: MatchPhase }; pause(): void; resume(): void }`, `shouldPauseForPuzzles(phase): boolean`, `usePuzzleMode(match) -> { screen: 'game' | 'puzzles'; enter(): void; exit(): void }`.
  - `<PuzzleScreen onExit themeId pieceSetId loadPuzzles? random? />`. Test ids: `puzzle-screen`, `puzzle-exit`, `puzzle-theme`, `puzzle-loading`, `puzzle-load-error`, `puzzle-empty`, `user-puzzle-rating`, `puzzle-rating-delta`, `puzzle-rating`, `puzzle-themes`, `puzzle-id`, `puzzle-side-to-move`, `puzzle-status`, `puzzle-retry`, `puzzle-hint`, `puzzle-solution`, `puzzle-next`, `puzzle-hint-text`.
  - `NewGame` prop `onPuzzles?: () => void` → button `open-puzzles` ("Puzzles").
  - e2e helpers `servePuzzles(page, data = PUZZLE_FIXTURE)`, `openPuzzles(page)`.

**Behaviour:**
- `Puzzles` → `enter()`: if the match is live (`awaiting-human` or `engine-thinking`) it is paused and remembered; a finished/idle game, or one the user had already paused, is left exactly as it is. `Back to game` → `exit()`: resumes only what `enter()` paused. `App` renders `PuzzleScreen` INSTEAD of the game UI (after all its hooks, so hook order never changes); the in-progress save keeps working (a paused game is still saved to `chess-game:in-progress`).
- The puzzle set is fetched on the first open (cached after). On failure: `The puzzles could not be loaded. Your game is unaffected — go back to it and try again later.`
- The first puzzle is drawn when the set arrives; a theme change draws a new one; Next draws another, never the current. Drawing marks the puzzle seen. The rating changes once per puzzle, on its first decisive event (T4); the change shows as `(+33)` next to the rating.

- [ ] **Step 1: Write the failing unit tests**

`src/ui/puzzles/usePuzzleMode.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MatchController, type EngineLike } from '../../match/controller'
import type { MatchConfig } from '../../match/types'
import { usePuzzleMode } from './usePuzzleMode'

/** A real controller over an engine whose searches we answer by hand. */
function pendingEngine() {
  const replies: Array<(best: string) => void> = []
  const engine: EngineLike = {
    waitReady: () => Promise.resolve(),
    configure: () => {},
    newGame: () => {},
    setPosition: () => {},
    search: () =>
      new Promise((resolve) => {
        replies.push((best) => resolve({ best, lines: [] }))
      }),
    stop: () => {},
    dispose: () => {},
  }
  return { engine, replies }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const HUMANS: MatchConfig = { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }
const ENGINE_WHITE: MatchConfig = {
  white: { kind: 'engine', level: 8 },
  black: { kind: 'human' },
  timeControl: { kind: 'timed', initialMs: 60_000, incrementMs: 0 },
  engineDelayMs: 0,
}

describe('usePuzzleMode', () => {
  // Breaks if puzzle mode lets the engine move or the clock run for the paused game.
  test('entering pauses a live game (engine reply dropped, clock stopped); exit resumes it', async () => {
    const { engine, replies } = pendingEngine()
    const c = new MatchController({ engine })
    c.start(ENGINE_WHITE)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    const { result } = renderHook(() => usePuzzleMode(c))

    act(() => result.current.enter())
    expect(result.current.screen).toBe('puzzles')
    expect(c.snapshot().phase.kind).toBe('paused')
    expect(c.clockState().running).toBeNull()
    await tick()
    for (const reply of replies) reply('e2e4')
    await tick()
    expect(c.snapshot().game.moves).toHaveLength(0)

    const asked = replies.length
    act(() => result.current.exit())
    expect(result.current.screen).toBe('game')
    expect(c.snapshot().phase.kind).toBe('engine-thinking')
    expect(c.clockState().running).toBe('w')
    await vi.waitFor(() => expect(replies.length).toBeGreaterThan(asked))
    replies.at(-1)?.('e2e4')
    await vi.waitFor(() => expect(c.snapshot().game.moves).toHaveLength(1))
    c.dispose()
  })

  test('a finished game is left alone on the way in and out', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start(HUMANS)
    c.resign('w')
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('finished')
    c.dispose()
  })

  // Breaks if exit resumes a game the USER had paused (zero-player pause button).
  test('a game the user paused stays paused after the round trip', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start({ ...ENGINE_WHITE, black: { kind: 'engine', level: 8 } })
    c.pause()
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('paused')
    c.dispose()
  })

  test('entering twice still resumes on exit', () => {
    const c = new MatchController({ engine: pendingEngine().engine })
    c.start(HUMANS)
    const { result } = renderHook(() => usePuzzleMode(c))
    act(() => result.current.enter())
    act(() => result.current.enter())
    expect(c.snapshot().phase.kind).toBe('paused')
    act(() => result.current.exit())
    expect(c.snapshot().phase.kind).toBe('awaiting-human')
    c.dispose()
  })
})
```

`src/ui/puzzles/PuzzleScreen.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PuzzleScreen } from './PuzzleScreen'
import { loadPuzzleStats } from '../../puzzles/store'
import type { RatedPuzzle } from '../../puzzles/types'
import { BACK_RANK, DEFENCE } from '../../../tests/fixtures/puzzles'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

const click = (sq: string) => fireEvent.click(document.querySelector(`[data-square="${sq}"]`) as HTMLElement)
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

async function mount(load: () => Promise<RatedPuzzle[] | null> = async () => [DEFENCE, BACK_RANK]) {
  const onExit = vi.fn()
  render(<PuzzleScreen onExit={onExit} themeId="classic" pieceSetId="rhosgfx" loadPuzzles={load} random={() => 0} />)
  await flush()
  return onExit
}

async function solveDefence() {
  advance(600) // setup Qd6
  click('f8')
  click('d8')
  advance(400) // reply Qxd8+
  click('f6')
  click('d8')
}

describe('PuzzleScreen (rated)', () => {
  // Breaks if a failed fetch crashes the screen or strands the user in it.
  test('a set that fails to load shows a clear message; Back to game works', async () => {
    const onExit = await mount(async () => null)
    expect(screen.getByTestId('puzzle-load-error')).toHaveTextContent('could not be loaded')
    fireEvent.click(screen.getByTestId('puzzle-exit'))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  test('shows side to move, themes, both ratings; solving raises the rating once', async () => {
    await mount()
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('0000D')
    expect(screen.getByTestId('puzzle-side-to-move')).toHaveTextContent('Black to move')
    expect(screen.getByTestId('puzzle-themes')).toHaveTextContent('Advantage, Endgame, Short')
    expect(screen.getByTestId('puzzle-rating')).toHaveTextContent('1468')
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1200')
    // Solver's side at the bottom: the first square in the grid is h1 when Black plays.
    expect(document.querySelector('[data-square]')?.getAttribute('data-square')).toBe('h1')
    await solveDefence()
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1233')
    expect(screen.getByTestId('puzzle-rating-delta')).toHaveTextContent('(+33)')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1233, games: 1, seen: ['0000D'] })
  })

  // Breaks if retrying after a wrong move can win the rating back.
  test('a wrong move costs rating at once; retry and solve does not refund it', async () => {
    await mount()
    advance(600)
    click('b6')
    click('c7')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent("That's not it.")
    expect(screen.getByTestId('user-puzzle-rating')).toHaveTextContent('1193')
    fireEvent.click(screen.getByTestId('puzzle-retry'))
    click('f8')
    click('d8')
    advance(400)
    click('f6')
    click('d8')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1193, games: 1 })
  })

  test('Next skips without a rating change and never repeats; the theme filter narrows the draw', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('puzzle-next'))
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('T0001')
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
    fireEvent.change(screen.getByTestId('puzzle-theme'), { target: { value: 'fork' } })
    expect(screen.getByTestId('puzzle-empty')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('puzzle-theme'), { target: { value: 'mateIn1' } })
    expect(screen.getByTestId('puzzle-id')).toHaveTextContent('T0001')
  })
})
```

Append to `src/ui/App.test.tsx`:

```tsx
describe('puzzle mode (Phase 3)', () => {
  beforeEach(() => localStorage.clear())

  // Breaks if the switch loses the game or crashes when the set cannot load (jsdom cannot fetch it).
  test('Puzzles swaps in the puzzle screen; Back to game returns to the same position', async () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    fireEvent.click(screen.getByTestId('open-puzzles'))
    expect(screen.getByTestId('puzzle-screen')).toBeInTheDocument()
    expect(await screen.findByTestId('puzzle-load-error')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('puzzle-exit'))
    expect(screen.queryByTestId('puzzle-screen')).toBeNull()
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull()
    expect(screen.getByTestId('turn')).toHaveTextContent(/black/i)
    expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/puzzles src/ui/App.test.tsx`
Expected: FAIL — `./usePuzzleMode` and `./PuzzleScreen` unresolved; `open-puzzles` not found.

- [ ] **Step 3: Implement `usePuzzleMode`**

`src/ui/puzzles/usePuzzleMode.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import type { MatchPhase } from '../../match/types'

/** The part of MatchController puzzle mode is allowed to touch. */
export interface PausableMatch {
  snapshot(): { phase: MatchPhase }
  pause(): void
  resume(): void
}

export type Screen = 'game' | 'puzzles'

/** Only a live game is paused; finished, idle or user-paused games are left exactly as they are. */
export function shouldPauseForPuzzles(phase: MatchPhase): boolean {
  return phase.kind === 'awaiting-human' || phase.kind === 'engine-thinking'
}

/**
 * Game <-> puzzles. While puzzles are open the match is paused through the
 * controller (no engine moves, no clocks); on the way back it is resumed —
 * but only if entering paused it.
 */
export function usePuzzleMode(match: PausableMatch) {
  const [screen, setScreen] = useState<Screen>('game')
  const activeRef = useRef(false)
  const pausedRef = useRef(false)

  const enter = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    pausedRef.current = shouldPauseForPuzzles(match.snapshot().phase)
    if (pausedRef.current) match.pause()
    setScreen('puzzles')
  }, [match])

  const exit = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    if (pausedRef.current) {
      pausedRef.current = false
      match.resume()
    }
    setScreen('game')
  }, [match])

  return { screen, enter, exit }
}
```

- [ ] **Step 4: Implement the screen**

`src/ui/puzzles/puzzles.css`:

```css
.puzzle-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}

.puzzle-info p {
  margin: 0;
}

.puzzle-status {
  font-weight: 600;
}

.puzzle-error {
  color: #eb5757;
}

.puzzle-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.rating-up {
  color: #27ae60;
}

.rating-down {
  color: #eb5757;
}
```

`src/ui/puzzles/PuzzleScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type Highlights } from '../Board/Board'
import { Promotion } from '../Board/Promotion'
import { reduceSelection, type SelectionState } from '../Board/selection'
import type { Square } from '../../game-core/types'
import { loadPuzzleSet } from '../../puzzles/data'
import { selectPuzzle } from '../../puzzles/select'
import { lastMoveOf, positionOf, solverColorOf } from '../../puzzles/session'
import { specOfRated } from '../../puzzles/spec'
import { loadPuzzleStats, markPuzzleSeen, recordPuzzleResult, type PuzzleStats } from '../../puzzles/store'
import { PUZZLE_THEMES, themeLabel } from '../../puzzles/themes'
import type { RatedPuzzle } from '../../puzzles/types'
import { usePuzzleSession } from './usePuzzleSession'
import {
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
} from './puzzleView'
import './puzzles.css'

type PuzzleSet = { kind: 'loading' } | { kind: 'ready'; puzzles: RatedPuzzle[] } | { kind: 'failed' }

interface Current {
  /** A fresh key per showing, so showing the same puzzle again restarts it. */
  key: string
  puzzle: RatedPuzzle
}

export interface PuzzleScreenProps {
  onExit: () => void
  themeId: string
  pieceSetId: string
  /** Injectable for tests; defaults to the lazily fetched bundled set. */
  loadPuzzles?: () => Promise<RatedPuzzle[] | null>
  /** Selection RNG; e2e pins Math.random. */
  random?: () => number
}

export function PuzzleScreen({
  onExit,
  themeId,
  pieceSetId,
  loadPuzzles = loadPuzzleSet,
  random = Math.random,
}: PuzzleScreenProps) {
  const [set, setSet] = useState<PuzzleSet>({ kind: 'loading' })
  const [stats, setStats] = useState<PuzzleStats>(() => loadPuzzleStats())
  const [theme, setTheme] = useState('')
  const [current, setCurrent] = useState<Current | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const seqRef = useRef(0)
  /** The key of the puzzle whose rating result has been recorded. */
  const recordedRef = useRef<string | null>(null)
  const loadRef = useRef(loadPuzzles)
  const randomRef = useRef(random)
  randomRef.current = random

  // Fetched once per open (the loader caches; a failure is retried next time).
  useEffect(() => {
    let live = true
    void loadRef.current().then((puzzles) => {
      if (live) setSet(puzzles ? { kind: 'ready', puzzles } : { kind: 'failed' })
    })
    return () => {
      live = false
    }
  }, [])

  const showRated = useCallback((puzzles: readonly RatedPuzzle[], filter: string, excludeId: string | null) => {
    const s = loadPuzzleStats()
    const pick = selectPuzzle(puzzles, {
      rating: s.rating,
      seen: new Set(s.seen),
      theme: filter || null,
      excludeId,
      random: randomRef.current,
    })
    setDelta(null)
    setSelection({ kind: 'idle' })
    if (!pick) {
      setStats(s)
      setCurrent(null)
      return
    }
    setStats(markPuzzleSeen(pick.id))
    seqRef.current += 1
    setCurrent({ key: `p${seqRef.current}`, puzzle: pick })
  }, [])

  // The first puzzle, once the set arrives. Theme changes and Next draw explicitly.
  useEffect(() => {
    if (set.kind === 'ready') showRated(set.puzzles, theme, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])

  const spec = useMemo(() => (current ? specOfRated(current.puzzle) : null), [current])
  const puzzle = usePuzzleSession(spec, current?.key ?? null)
  const session = puzzle.session
  const outcome = session?.outcome ?? null

  // Rated: the first decisive event of each showing changes the rating, once.
  useEffect(() => {
    if (!current || outcome === null || recordedRef.current === current.key) return
    recordedRef.current = current.key
    const before = loadPuzzleStats().rating
    const after = recordPuzzleResult(current.puzzle.rating, outcome)
    setStats(after)
    setDelta(after.rating - before)
  }, [current, outcome])

  const position = useMemo(() => (session ? positionOf(session) : null), [session])
  const solver = spec ? solverColorOf(spec) : 'w'
  const phase = session?.phase ?? null
  const last = session ? lastMoveOf(session) : null
  const status = position?.status()

  const onSquareClick = (square: Square) => {
    if (!position || phase !== 'solver') {
      setSelection({ kind: 'idle' })
      return
    }
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    setSelection(out.state)
    if (out.move) puzzle.submit(out.move)
  }

  const handleNext = () => {
    if (set.kind === 'ready') showRated(set.puzzles, theme, current?.puzzle.id ?? null)
  }

  const handleTheme = (next: string) => {
    setTheme(next)
    if (set.kind === 'ready') showRated(set.puzzles, next, null)
  }

  const highlights: Highlights = position
    ? {
        ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
        legal: selection.kind === 'selected' ? position.legalMovesFrom(selection.square).map((m) => m.to) : [],
        ...(last ? { lastMove: [last.from, last.to] as [Square, Square] } : {}),
        ...(status?.kind === 'in-progress' && status.inCheck
          ? { check: position.kingSquare(position.turn()) ?? undefined }
          : {}),
      }
    : {}

  return (
    <main className="app puzzle-screen" data-testid="puzzle-screen">
      <h1>Puzzles</h1>

      <div className="puzzle-toolbar">
        <button type="button" data-testid="puzzle-exit" onClick={onExit}>
          Back to game
        </button>
        <label>
          Theme{' '}
          <select data-testid="puzzle-theme" value={theme} onChange={(e) => handleTheme(e.target.value)}>
            <option value="">All themes</option>
            {PUZZLE_THEMES.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="layout">
        <div className="left-column puzzle-info">
          <p>
            Your puzzle rating: <span data-testid="user-puzzle-rating">{stats.rating}</span>
            {delta !== null ? (
              <span data-testid="puzzle-rating-delta" className={delta >= 0 ? 'rating-up' : 'rating-down'}>
                {' '}
                ({ratingDeltaText(delta)})
              </span>
            ) : null}
          </p>
          {current && session ? (
            <>
              <p className="puzzle-side" data-testid="puzzle-side-to-move">
                {sideName(solver)} to move
              </p>
              <p className="puzzle-status" data-testid="puzzle-status" aria-live="polite">
                {puzzleStatusText(session, solver)}
              </p>
              <p>
                Puzzle rating: <span data-testid="puzzle-rating">{current.puzzle.rating}</span>
              </p>
              <p data-testid="puzzle-themes">{current.puzzle.themes.map(themeLabel).join(', ')}</p>
              <span className="sr-only" data-testid="puzzle-id">
                {current.puzzle.id}
              </span>
            </>
          ) : null}
        </div>

        <div className="board-column">
          {set.kind === 'loading' ? <p data-testid="puzzle-loading">Loading puzzles…</p> : null}
          {set.kind === 'failed' ? (
            <p className="puzzle-error" role="alert" data-testid="puzzle-load-error">
              The puzzles could not be loaded. Your game is unaffected — go back to it and try again later.
            </p>
          ) : null}
          {set.kind === 'ready' && !current ? <p data-testid="puzzle-empty">No puzzles match this theme.</p> : null}
          {position && session ? (
            <Board
              position={position}
              orientation={solver === 'w' ? 'white' : 'black'}
              highlights={highlights}
              onSquareClick={onSquareClick}
              annotations={puzzleAnnotations(session, puzzle.hintStage)}
              theme={themeId}
              pieceSet={pieceSetId}
            />
          ) : null}
          {selection.kind === 'awaiting-promotion' && position ? (
            <Promotion
              color={position.turn()}
              pieceSet={pieceSetId}
              onChoose={(piece) => {
                const out = reduceSelection(selection, { kind: 'promotion-chosen', piece }, position)
                setSelection(out.state)
                if (out.move) puzzle.submit(out.move)
              }}
              onCancel={() => setSelection({ kind: 'idle' })}
            />
          ) : null}
          {current && session ? (
            <div className="puzzle-controls">
              <button
                type="button"
                data-testid="puzzle-retry"
                onClick={puzzle.retry}
                disabled={phase !== 'failed' && phase !== 'solved' && phase !== 'revealed'}
              >
                Retry
              </button>
              <button
                type="button"
                data-testid="puzzle-hint"
                onClick={puzzle.hint}
                disabled={phase !== 'solver' || puzzle.hintStage >= 2}
              >
                {puzzleHintButtonLabel(puzzle.hintStage)}
              </button>
              <button
                type="button"
                data-testid="puzzle-solution"
                onClick={puzzle.showSolution}
                disabled={phase !== 'solver' && phase !== 'failed'}
              >
                Show solution
              </button>
              <button type="button" data-testid="puzzle-next" onClick={handleNext}>
                Next
              </button>
            </div>
          ) : null}
          <p className="hint-text" data-testid="puzzle-hint-text" aria-live="polite">
            {session ? puzzleHintText(session, puzzle.hintStage) : ''}
          </p>
        </div>

        <div className="right-column" />
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Add the Puzzles button and the App switch**

`src/ui/panels/NewGame.tsx`: add `onPuzzles,` to the destructured props (after `onStart,`), `onPuzzles?: () => void` to the props type (after `onStart: () => void`), and right after the `new-game` button:

```tsx
      {onPuzzles ? (
        <button data-testid="open-puzzles" onClick={onPuzzles}>
          Puzzles
        </button>
      ) : null}
```

`src/ui/App.tsx`:

1. After `import { historyEntryFor, humanSidesOf, newHistoryId } from './history/record'` add:

```ts
import { PuzzleScreen } from './puzzles/PuzzleScreen'
import { usePuzzleMode } from './puzzles/usePuzzleMode'
```

2. Directly after `const snapshot = useMatch(controller)` add:

```ts
  // Phase 3: game <-> puzzles. Entering pauses a live match through the
  // controller (no engine moves, no clocks); leaving resumes it.
  const puzzleMode = usePuzzleMode(controller)
```

3. Directly before the `// ---- render ----` comment (i.e. after `handleReview`, below every hook) add:

```tsx
  // Rendered INSTEAD of the game UI, after every hook above, so hook order
  // never changes. The match stays in the controller (paused) meanwhile.
  if (puzzleMode.screen === 'puzzles') {
    return <PuzzleScreen onExit={puzzleMode.exit} themeId={settings.themeId} pieceSetId={settings.pieceSetId} />
  }
```

4. On the `<NewGame … />` element add the prop `onPuzzles={puzzleMode.enter}` (after `onStart={handleNewGame}`).

- [ ] **Step 6: Run the unit tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 7: Add the e2e helpers and spec**

In `tests/e2e/helpers.ts`, change the first line to `import { expect, type Page, type Route } from '@playwright/test'`, add `import { PUZZLE_FIXTURE } from '../fixtures/puzzles'`, and append:

```ts
/** Serve a known puzzle set instead of the bundled 3,000 (deterministic puzzle specs). */
export async function servePuzzles(page: Page, data: unknown = PUZZLE_FIXTURE): Promise<void> {
  await page.route('**/puzzles/puzzles.json', (r) => r.fulfill({ json: data }))
}

export async function openPuzzles(page: Page): Promise<void> {
  await page.getByTestId('open-puzzles').click()
  await expect(page.getByTestId('puzzle-screen')).toBeVisible()
}
```

`tests/e2e/puzzles.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { coachOffline, openPuzzles, pinRandom, servePuzzles } from './helpers'

/**
 * Fixture (tests/fixtures/puzzles.ts): 0000D (1468, solver Black) then
 * T0001 (1500, solver White, Qd8# or Ra8#). With Math.random pinned to 0 and
 * a fresh 1200 rating, both fall in the ±400 window and the first in data
 * order — 0000D — is drawn first; Next then gives T0001.
 * Expected ratings (K = 40): 1200 vs 1468 win -> 1233, loss -> 1193;
 * 1200 vs 1500 loss -> 1194.
 */
async function move(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click()
  await page.locator(`[data-square="${to}"]`).click()
}
const piece = (page: Page, sq: string) => page.locator(`[data-square="${sq}"] [data-piece]`)
const seconds = (t: string | null) => {
  const [m, s] = (t ?? '0:0').split(':').map(Number)
  return (m ?? 0) * 60 + (s ?? 0)
}

test.beforeEach(async ({ page }) => {
  await pinRandom(page, 0)
  await coachOffline(page)
  await servePuzzles(page)
  await page.goto('/')
})

// Breaks if the setup move, the opponent's reply or the rating update stops happening.
test('solve a rated puzzle: setup plays itself, the opponent replies, the rating rises and persists', async ({ page }) => {
  await openPuzzles(page)
  await expect(page.getByTestId('puzzle-id')).toHaveText('0000D')
  await expect(page.getByTestId('puzzle-rating')).toHaveText('1468')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1200')
  await expect(page.getByTestId('puzzle-themes')).toHaveText('Advantage, Endgame, Short')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('Black to move')
  await expect(page.locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')

  await expect(piece(page, 'd6')).toHaveAttribute('data-piece', 'wQ')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for Black.')
  await move(page, 'f8', 'd8')
  await expect(piece(page, 'd8')).toHaveAttribute('data-piece', 'wQ')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Correct! Keep going.')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1233')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(+33)')

  await page.reload()
  await openPuzzles(page)
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1233')
  await expect(page.getByTestId('puzzle-id')).toHaveText('T0001') // 0000D was seen
})

// Breaks if a wrong move is free, hidden, or refunded by a retry.
test('a wrong move fails the puzzle and drops the rating; retry does not refund it', async ({ page }) => {
  await openPuzzles(page)
  await expect(piece(page, 'd6')).toHaveAttribute('data-piece', 'wQ')
  await move(page, 'b6', 'c7')
  await expect(page.getByTestId('puzzle-status')).toHaveText("That's not it. Retry, or show the solution.")
  await expect(page.locator('[data-annotation="square"][data-tone="blunder"]')).toHaveAttribute('data-annotation-square', 'c7')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1193')
  await expect(page.getByTestId('puzzle-rating-delta')).toHaveText('(-7)')

  await page.getByTestId('puzzle-retry').click()
  await expect(piece(page, 'b6')).toHaveAttribute('data-piece', 'bQ')
  await move(page, 'f8', 'd8')
  await expect(piece(page, 'd8')).toHaveAttribute('data-piece', 'wQ')
  await move(page, 'f6', 'd8')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1193')
})

// Breaks if the hint overlay is not reused, the hint is free, or an alternative mate is rejected.
test('hint highlights the piece, then the move, and costs the rated result; any mate solves', async ({ page }) => {
  await openPuzzles(page)
  await page.getByTestId('puzzle-next').click()
  await expect(page.getByTestId('puzzle-id')).toHaveText('T0001')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1200') // skipping is free
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('White to move')
  await expect(page.getByTestId('puzzle-status')).toHaveText('Find the best move for White.')

  await page.getByTestId('puzzle-hint').click()
  await expect(page.locator('[data-annotation="square"][data-tone="hint"]')).toHaveAttribute('data-annotation-square', 'd1')
  await expect(page.getByTestId('puzzle-hint-text')).toHaveText('Look at your queen.')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1194')
  await expect(page.getByTestId('puzzle-hint')).toHaveText('Show move')
  await page.getByTestId('puzzle-hint').click()
  await expect(page.locator('[data-annotation="arrow"][data-tone="hint"]')).toHaveCount(1)
  await expect(page.getByTestId('puzzle-hint')).toBeDisabled()

  await move(page, 'a1', 'a8') // Ra8# — not the listed Qd8#
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('user-puzzle-rating')).toHaveText('1194')
})

// Breaks if puzzle mode loses the game or lets its clock run.
test('exit returns to the preserved game; its clock did not run meanwhile, and play continues', async ({ page }) => {
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('time-control').selectOption('blitz-3-2')
  await page.getByTestId('new-game').click()
  await move(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('1')
  const black = page.getByTestId('clock-b')
  await expect(black).toHaveText(/^(3:00|2:5\d)$/)
  const before = seconds(await black.textContent())

  await openPuzzles(page)
  await page.waitForTimeout(3_000)
  await page.getByTestId('puzzle-exit').click()

  await expect(page.getByTestId('ply-count')).toHaveText('1')
  await expect(piece(page, 'e4')).toHaveAttribute('data-piece', 'wP')
  await expect(page.getByTestId('turn')).toHaveText('Black to move')
  const resumedAt = await black.textContent()
  expect(before - seconds(resumedAt)).toBeLessThanOrEqual(1)
  await expect(black).not.toHaveText(resumedAt ?? '', { timeout: 5_000 }) // running again
  await move(page, 'e7', 'e5')
  await expect(page.getByTestId('ply-count')).toHaveText('2')
})

// Breaks if a failed puzzles.json takes anything down with it.
test('a puzzle set that fails to load shows a clear message and leaves the game alone', async ({ page }) => {
  await page.unroute('**/puzzles/puzzles.json')
  await page.route('**/puzzles/puzzles.json', (r) => r.fulfill({ status: 404, body: 'missing' }))
  await openPuzzles(page)
  await expect(page.getByTestId('puzzle-load-error')).toContainText('could not be loaded')
  await page.getByTestId('puzzle-exit').click()
  await move(page, 'e2', 'e4')
  await expect(page.getByTestId('ply-count')).toHaveText('1')
})
```

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test && npx playwright test tests/e2e/puzzles.spec.ts`
Expected: clean; all unit tests pass; 5/5 puzzle specs pass.

Then: `npm run e2e`
Expected: 42/42 (35 baseline + 2 from Task 7 + 5).

- [ ] **Step 9: Commit**

```bash
git add src/ui/puzzles src/ui/panels/NewGame.tsx src/ui/App.tsx src/ui/App.test.tsx tests/e2e/helpers.ts tests/e2e/puzzles.spec.ts
git commit -m "feat(puzzles): rated puzzle screen; the game pauses while puzzling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: "My mistakes" source

**Model tier:** standard.

**Files:**
- Modify: `src/ui/puzzles/puzzleView.ts`, `src/ui/puzzles/puzzleView.test.ts` (`mistakeOriginText`, `nextMistake`)
- Create: `src/ui/puzzles/MistakesList.tsx`
- Modify (full replacement below): `src/ui/puzzles/PuzzleScreen.tsx`; modify `src/ui/puzzles/PuzzleScreen.test.tsx`, `src/ui/puzzles/puzzles.css`
- Modify: `tests/e2e/blunder-puzzles.spec.ts`

**Interfaces:**
- Consumes: `loadBlunderPuzzles`, `markBlunderPuzzleSolved` (T6), `specOfBlunder` (T1), `BlunderPuzzle` (T1), everything from T9.
- Produces:
  - `mistakeOriginText(p: BlunderPuzzle): string` → `From your game on 2026-09-20 (C50 Italian Game): you played 25. h3?? — find the better move.` (the opening part is omitted when null; the date is the ISO date part, locale-independent).
  - `nextMistake(list, currentId): BlunderPuzzle | null` → the first unsolved puzzle after the current one (wrapping), else the next one; null for an empty list.
  - `<MistakesList puzzles currentId onPick />` — test ids `mistake-list`, `mistake-item`, `mistake-solved`, `mistakes-empty`.
  - `PuzzleScreen` additions: source select `puzzle-source` (`rated` = "Rated (Lichess)", `mistakes` = "My mistakes"), `puzzle-origin`, `puzzle-unrated`. On "My mistakes": the theme filter is disabled, the rating is shown but never changed, the puzzle's origin is shown, and reaching `'solved'` marks it solved (persisted).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/puzzles/puzzleView.test.ts` (extend the import from `./puzzleView` with `mistakeOriginText, nextMistake`, and add `import type { BlunderPuzzle } from '../../puzzles/types'`):

```ts
const mistake = (id: string, over: Partial<BlunderPuzzle> = {}): BlunderPuzzle => ({
  id,
  fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
  solution: 'd1d8',
  bestSan: 'Qd8#',
  blunderLabel: '25. h3',
  solver: 'w',
  gameId: 'g1',
  gameDate: '2026-09-20T10:00:00.000Z',
  opening: 'C50 Italian Game',
  createdAt: '2026-09-20T10:05:00.000Z',
  solved: false,
  ...over,
})

test('mistakeOriginText says which game and which move', () => {
  expect(mistakeOriginText(mistake('a'))).toBe(
    'From your game on 2026-09-20 (C50 Italian Game): you played 25. h3?? — find the better move.',
  )
  expect(mistakeOriginText(mistake('a', { opening: null }))).toBe(
    'From your game on 2026-09-20: you played 25. h3?? — find the better move.',
  )
})

describe('nextMistake', () => {
  const list = [mistake('a'), mistake('b', { solved: true }), mistake('c'), mistake('d', { solved: true })]
  test('first unsolved, then the next unsolved after the current one, wrapping', () => {
    expect(nextMistake(list, null)?.id).toBe('a')
    expect(nextMistake(list, 'a')?.id).toBe('c')
    expect(nextMistake(list, 'c')?.id).toBe('a')
  })
  test('when all are solved, simply the next one; empty list gives null', () => {
    const solved = list.map((p) => ({ ...p, solved: true }))
    expect(nextMistake(solved, 'b')?.id).toBe('c')
    expect(nextMistake(solved, 'd')?.id).toBe('a')
    expect(nextMistake([], null)).toBeNull()
  })
})
```

Append to `src/ui/puzzles/PuzzleScreen.test.tsx` (add `import { loadBlunderPuzzles } from '../../puzzles/store'`):

```tsx
describe('PuzzleScreen (My mistakes)', () => {
  const SEEDED = {
    v: 1,
    puzzles: [
      {
        id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
        fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
        solution: 'd1d8',
        bestSan: 'Qd8#',
        blunderLabel: '25. h3',
        solver: 'w',
        gameId: 'g1',
        gameDate: '2026-09-20T10:00:00.000Z',
        opening: 'C50 Italian Game',
        createdAt: '2026-09-20T10:05:00.000Z',
        solved: false,
      },
    ],
  }

  // Breaks if mistakes change the rating or are not marked solved.
  test('lists saved mistakes with their origin; solving one marks it solved and leaves the rating alone', async () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED))
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    expect(screen.getAllByTestId('mistake-item')).toHaveLength(1)
    expect(screen.getByTestId('puzzle-origin')).toHaveTextContent(
      'From your game on 2026-09-20 (C50 Italian Game): you played 25. h3??',
    )
    expect(screen.getByTestId('puzzle-side-to-move')).toHaveTextContent('White to move')
    expect(screen.getByTestId('puzzle-unrated')).toHaveTextContent('1200')
    expect(screen.getByTestId('puzzle-theme')).toBeDisabled()
    click('d1')
    click('d8')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent('Solved!')
    expect(screen.getByTestId('mistake-solved')).toBeInTheDocument()
    expect(loadBlunderPuzzles()[0]?.solved).toBe(true)
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
  })

  test('a wrong move on a mistake is not rated either', async () => {
    localStorage.setItem('chess-game:blunder-puzzles', JSON.stringify(SEEDED))
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    click('d1')
    click('d7')
    expect(screen.getByTestId('puzzle-status')).toHaveTextContent("That's not it.")
    expect(loadPuzzleStats()).toMatchObject({ rating: 1200, games: 0 })
  })

  test('with no mistakes saved it says where they come from; switching back draws a rated puzzle', async () => {
    await mount()
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'mistakes' } })
    expect(screen.getByTestId('mistakes-empty')).toHaveTextContent('Review a finished game')
    fireEvent.change(screen.getByTestId('puzzle-source'), { target: { value: 'rated' } })
    expect(screen.getByTestId('puzzle-rating')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/puzzles`
Expected: FAIL — `mistakeOriginText`/`nextMistake` not exported; `puzzle-source` not found.

- [ ] **Step 3: Implement the view helpers and the list**

Append to `src/ui/puzzles/puzzleView.ts` (and add `import type { BlunderPuzzle } from '../../puzzles/types'` to its imports):

```ts
export function mistakeOriginText(p: BlunderPuzzle): string {
  const opening = p.opening ? ` (${p.opening})` : ''
  return `From your game on ${p.gameDate.slice(0, 10)}${opening}: you played ${p.blunderLabel}?? — find the better move.`
}

/** The first unsolved mistake after `currentId` (wrapping); if all are solved, simply the next one. */
export function nextMistake(list: readonly BlunderPuzzle[], currentId: string | null): BlunderPuzzle | null {
  if (list.length === 0) return null
  const at = currentId === null ? -1 : list.findIndex((p) => p.id === currentId)
  const ordered = [...list.slice(at + 1), ...list.slice(0, at + 1)]
  return ordered.find((p) => !p.solved && p.id !== currentId) ?? ordered[0] ?? null
}
```

`src/ui/puzzles/MistakesList.tsx`:

```tsx
import type { BlunderPuzzle } from '../../puzzles/types'

export function MistakesList({
  puzzles,
  currentId,
  onPick,
}: {
  puzzles: readonly BlunderPuzzle[]
  currentId: string | null
  onPick: (p: BlunderPuzzle) => void
}) {
  if (puzzles.length === 0) {
    return (
      <p className="mistakes-empty" data-testid="mistakes-empty">
        No mistakes saved yet. Review a finished game and the blunders you made in it will appear here.
      </p>
    )
  }
  return (
    <ol className="mistake-list" data-testid="mistake-list">
      {puzzles.map((p) => (
        <li
          key={p.id}
          data-testid="mistake-item"
          className={p.id === currentId ? 'mistake-item current' : 'mistake-item'}
          aria-current={p.id === currentId ? 'true' : undefined}
        >
          <button type="button" onClick={() => onPick(p)}>
            {p.blunderLabel}??
          </button>
          <span className="mistake-meta">
            {p.gameDate.slice(0, 10)}
            {p.opening ? ` · ${p.opening}` : ''}
          </span>
          {p.solved ? (
            <span className="mistake-solved" data-testid="mistake-solved">
              Solved
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
```

Append to `src/ui/puzzles/puzzles.css`:

```css
.mistake-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mistake-item {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}

.mistake-item.current button {
  font-weight: 700;
}

.mistake-meta {
  font-size: 0.85em;
  opacity: 0.8;
}

.mistake-solved {
  font-size: 0.8em;
  color: #27ae60;
}
```

- [ ] **Step 4: Replace `PuzzleScreen.tsx` with the two-source version**

`src/ui/puzzles/PuzzleScreen.tsx` (full file):

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board, type Highlights } from '../Board/Board'
import { Promotion } from '../Board/Promotion'
import { reduceSelection, type SelectionState } from '../Board/selection'
import type { Square } from '../../game-core/types'
import { loadPuzzleSet } from '../../puzzles/data'
import { selectPuzzle } from '../../puzzles/select'
import { lastMoveOf, positionOf, solverColorOf } from '../../puzzles/session'
import { specOfBlunder, specOfRated } from '../../puzzles/spec'
import {
  loadBlunderPuzzles,
  loadPuzzleStats,
  markBlunderPuzzleSolved,
  markPuzzleSeen,
  recordPuzzleResult,
  type PuzzleStats,
} from '../../puzzles/store'
import { PUZZLE_THEMES, themeLabel } from '../../puzzles/themes'
import type { BlunderPuzzle, RatedPuzzle } from '../../puzzles/types'
import { MistakesList } from './MistakesList'
import { usePuzzleSession } from './usePuzzleSession'
import {
  mistakeOriginText,
  nextMistake,
  puzzleAnnotations,
  puzzleHintButtonLabel,
  puzzleHintText,
  puzzleStatusText,
  ratingDeltaText,
  sideName,
} from './puzzleView'
import './puzzles.css'

type Source = 'rated' | 'mistakes'

type PuzzleSet = { kind: 'loading' } | { kind: 'ready'; puzzles: RatedPuzzle[] } | { kind: 'failed' }

/** A fresh key per showing, so showing the same puzzle again restarts it. */
type Current =
  | { source: 'rated'; key: string; puzzle: RatedPuzzle }
  | { source: 'mistakes'; key: string; puzzle: BlunderPuzzle }

export interface PuzzleScreenProps {
  onExit: () => void
  themeId: string
  pieceSetId: string
  /** Injectable for tests; defaults to the lazily fetched bundled set. */
  loadPuzzles?: () => Promise<RatedPuzzle[] | null>
  /** Selection RNG; e2e pins Math.random. */
  random?: () => number
}

export function PuzzleScreen({
  onExit,
  themeId,
  pieceSetId,
  loadPuzzles = loadPuzzleSet,
  random = Math.random,
}: PuzzleScreenProps) {
  const [source, setSource] = useState<Source>('rated')
  const [set, setSet] = useState<PuzzleSet>({ kind: 'loading' })
  const [stats, setStats] = useState<PuzzleStats>(() => loadPuzzleStats())
  const [mistakes, setMistakes] = useState<BlunderPuzzle[]>(() => loadBlunderPuzzles())
  const [theme, setTheme] = useState('')
  const [current, setCurrent] = useState<Current | null>(null)
  const [delta, setDelta] = useState<number | null>(null)
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const seqRef = useRef(0)
  /** The key of the rated showing whose result has been recorded. */
  const recordedRef = useRef<string | null>(null)
  const loadRef = useRef(loadPuzzles)
  const randomRef = useRef(random)
  randomRef.current = random

  // Fetched once per open (the loader caches; a failure is retried next time).
  useEffect(() => {
    let live = true
    void loadRef.current().then((puzzles) => {
      if (live) setSet(puzzles ? { kind: 'ready', puzzles } : { kind: 'failed' })
    })
    return () => {
      live = false
    }
  }, [])

  const nextKey = useCallback(() => {
    seqRef.current += 1
    return `p${seqRef.current}`
  }, [])

  const showRated = useCallback(
    (puzzles: readonly RatedPuzzle[], filter: string, excludeId: string | null) => {
      const s = loadPuzzleStats()
      const pick = selectPuzzle(puzzles, {
        rating: s.rating,
        seen: new Set(s.seen),
        theme: filter || null,
        excludeId,
        random: randomRef.current,
      })
      setDelta(null)
      setSelection({ kind: 'idle' })
      if (!pick) {
        setStats(s)
        setCurrent(null)
        return
      }
      setStats(markPuzzleSeen(pick.id))
      setCurrent({ source: 'rated', key: nextKey(), puzzle: pick })
    },
    [nextKey],
  )

  const showMistake = useCallback(
    (p: BlunderPuzzle | null) => {
      setDelta(null)
      setSelection({ kind: 'idle' })
      setCurrent(p ? { source: 'mistakes', key: nextKey(), puzzle: p } : null)
    },
    [nextKey],
  )

  // The first rated puzzle, once the set arrives (if the user is still on Rated).
  useEffect(() => {
    if (set.kind === 'ready' && source === 'rated') showRated(set.puzzles, theme, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set])

  const spec = useMemo(
    () =>
      current === null ? null : current.source === 'rated' ? specOfRated(current.puzzle) : specOfBlunder(current.puzzle),
    [current],
  )
  const puzzle = usePuzzleSession(spec, current?.key ?? null)
  const session = puzzle.session
  const outcome = session?.outcome ?? null
  const phase = session?.phase ?? null

  // Rated only: the first decisive event of each showing changes the rating, once.
  useEffect(() => {
    if (current?.source !== 'rated' || outcome === null || recordedRef.current === current.key) return
    recordedRef.current = current.key
    const before = loadPuzzleStats().rating
    const after = recordPuzzleResult(current.puzzle.rating, outcome)
    setStats(after)
    setDelta(after.rating - before)
  }, [current, outcome])

  // My mistakes: solving one marks it solved (hint or retry allowed — it is practice).
  useEffect(() => {
    if (current?.source !== 'mistakes' || phase !== 'solved') return
    setMistakes(markBlunderPuzzleSolved(current.puzzle.id))
  }, [current, phase])

  const position = useMemo(() => (session ? positionOf(session) : null), [session])
  const solver = spec ? solverColorOf(spec) : 'w'
  const last = session ? lastMoveOf(session) : null
  const status = position?.status()
  const rated = current?.source === 'rated' ? current.puzzle : null
  const mistake = current?.source === 'mistakes' ? current.puzzle : null

  const onSquareClick = (square: Square) => {
    if (!position || phase !== 'solver') {
      setSelection({ kind: 'idle' })
      return
    }
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    setSelection(out.state)
    if (out.move) puzzle.submit(out.move)
  }

  const changeSource = (next: Source) => {
    if (next === source) return
    setSource(next)
    if (next === 'mistakes') {
      const list = loadBlunderPuzzles()
      setMistakes(list)
      showMistake(nextMistake(list, null))
    } else if (set.kind === 'ready') {
      showRated(set.puzzles, theme, null)
    } else {
      showMistake(null)
    }
  }

  const handleNext = () => {
    if (source === 'mistakes') showMistake(nextMistake(mistakes, current?.puzzle.id ?? null))
    else if (set.kind === 'ready') showRated(set.puzzles, theme, current?.puzzle.id ?? null)
  }

  const handleTheme = (next: string) => {
    setTheme(next)
    if (source === 'rated' && set.kind === 'ready') showRated(set.puzzles, next, null)
  }

  const highlights: Highlights = position
    ? {
        ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
        legal: selection.kind === 'selected' ? position.legalMovesFrom(selection.square).map((m) => m.to) : [],
        ...(last ? { lastMove: [last.from, last.to] as [Square, Square] } : {}),
        ...(status?.kind === 'in-progress' && status.inCheck
          ? { check: position.kingSquare(position.turn()) ?? undefined }
          : {}),
      }
    : {}

  return (
    <main className="app puzzle-screen" data-testid="puzzle-screen">
      <h1>Puzzles</h1>

      <div className="puzzle-toolbar">
        <button type="button" data-testid="puzzle-exit" onClick={onExit}>
          Back to game
        </button>
        <label>
          Puzzles{' '}
          <select data-testid="puzzle-source" value={source} onChange={(e) => changeSource(e.target.value as Source)}>
            <option value="rated">Rated (Lichess)</option>
            <option value="mistakes">My mistakes</option>
          </select>
        </label>
        <label>
          Theme{' '}
          <select
            data-testid="puzzle-theme"
            value={theme}
            disabled={source !== 'rated'}
            onChange={(e) => handleTheme(e.target.value)}
          >
            <option value="">All themes</option>
            {PUZZLE_THEMES.map((t) => (
              <option key={t} value={t}>
                {themeLabel(t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="layout">
        <div className="left-column puzzle-info">
          {source === 'rated' ? (
            <p>
              Your puzzle rating: <span data-testid="user-puzzle-rating">{stats.rating}</span>
              {delta !== null ? (
                <span data-testid="puzzle-rating-delta" className={delta >= 0 ? 'rating-up' : 'rating-down'}>
                  {' '}
                  ({ratingDeltaText(delta)})
                </span>
              ) : null}
            </p>
          ) : (
            <p className="puzzle-unrated" data-testid="puzzle-unrated">
              Practice — your puzzle rating ({stats.rating}) is not affected.
            </p>
          )}
          {current && session ? (
            <>
              <p className="puzzle-side" data-testid="puzzle-side-to-move">
                {sideName(solver)} to move
              </p>
              <p className="puzzle-status" data-testid="puzzle-status" aria-live="polite">
                {puzzleStatusText(session, solver)}
              </p>
              {rated ? (
                <>
                  <p>
                    Puzzle rating: <span data-testid="puzzle-rating">{rated.rating}</span>
                  </p>
                  <p data-testid="puzzle-themes">{rated.themes.map(themeLabel).join(', ')}</p>
                  <span className="sr-only" data-testid="puzzle-id">
                    {rated.id}
                  </span>
                </>
              ) : null}
              {mistake ? <p data-testid="puzzle-origin">{mistakeOriginText(mistake)}</p> : null}
            </>
          ) : null}
        </div>

        <div className="board-column">
          {source === 'rated' && set.kind === 'loading' ? <p data-testid="puzzle-loading">Loading puzzles…</p> : null}
          {source === 'rated' && set.kind === 'failed' ? (
            <p className="puzzle-error" role="alert" data-testid="puzzle-load-error">
              The puzzles could not be loaded. Your game is unaffected — go back to it and try again later.
            </p>
          ) : null}
          {source === 'rated' && set.kind === 'ready' && !current ? (
            <p data-testid="puzzle-empty">No puzzles match this theme.</p>
          ) : null}
          {position && session ? (
            <Board
              position={position}
              orientation={solver === 'w' ? 'white' : 'black'}
              highlights={highlights}
              onSquareClick={onSquareClick}
              annotations={puzzleAnnotations(session, puzzle.hintStage)}
              theme={themeId}
              pieceSet={pieceSetId}
            />
          ) : null}
          {selection.kind === 'awaiting-promotion' && position ? (
            <Promotion
              color={position.turn()}
              pieceSet={pieceSetId}
              onChoose={(piece) => {
                const out = reduceSelection(selection, { kind: 'promotion-chosen', piece }, position)
                setSelection(out.state)
                if (out.move) puzzle.submit(out.move)
              }}
              onCancel={() => setSelection({ kind: 'idle' })}
            />
          ) : null}
          {current && session ? (
            <div className="puzzle-controls">
              <button
                type="button"
                data-testid="puzzle-retry"
                onClick={puzzle.retry}
                disabled={phase !== 'failed' && phase !== 'solved' && phase !== 'revealed'}
              >
                Retry
              </button>
              <button
                type="button"
                data-testid="puzzle-hint"
                onClick={puzzle.hint}
                disabled={phase !== 'solver' || puzzle.hintStage >= 2}
              >
                {puzzleHintButtonLabel(puzzle.hintStage)}
              </button>
              <button
                type="button"
                data-testid="puzzle-solution"
                onClick={puzzle.showSolution}
                disabled={phase !== 'solver' && phase !== 'failed'}
              >
                Show solution
              </button>
              <button type="button" data-testid="puzzle-next" onClick={handleNext}>
                Next
              </button>
            </div>
          ) : null}
          <p className="hint-text" data-testid="puzzle-hint-text" aria-live="polite">
            {session ? puzzleHintText(session, puzzle.hintStage) : ''}
          </p>
        </div>

        <div className="right-column">
          {source === 'mistakes' ? (
            <MistakesList puzzles={mistakes} currentId={mistake?.id ?? null} onPick={showMistake} />
          ) : null}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS (the Task 9 PuzzleScreen tests unchanged and green); clean.

- [ ] **Step 6: Extend the e2e spec**

In `tests/e2e/blunder-puzzles.spec.ts` change the helpers import to `import { coachOffline, openPuzzles, servePuzzles } from './helpers'` and append:

```ts
// Breaks if saved blunders never reach the puzzle screen, or show the wrong side/origin.
test('the saved blunder appears in My mistakes with its origin; Show solution plays it; rating untouched', async ({ page }) => {
  await servePuzzles(page)
  await playScholarsMateAndReview(page)
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  const item = page.getByTestId('mistake-item').filter({ hasText: '3... Nf6' })
  await expect(item).toHaveCount(1)
  await item.getByRole('button').click()
  await expect(page.getByTestId('puzzle-origin')).toContainText('you played 3... Nf6??')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('Black to move')
  await expect(page.locator('[data-square]').first()).toHaveAttribute('data-square', 'h1')
  await expect(page.getByTestId('puzzle-unrated')).toContainText('(1200)')
  await page.getByTestId('puzzle-solution').click()
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solution shown.')
  await expect(page.getByTestId('puzzle-unrated')).toContainText('(1200)')
})

const SEEDED = {
  v: 1,
  puzzles: [
    {
      id: 'b:6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - -',
      fen: '6k1/5ppp/1p6/8/8/8/5PPP/R2Q2K1 w - - 0 2',
      solution: 'd1d8',
      bestSan: 'Qd8#',
      blunderLabel: '25. h3',
      solver: 'w',
      gameId: 'g1',
      gameDate: '2026-09-20T10:00:00.000Z',
      opening: null,
      createdAt: '2026-09-20T10:05:00.000Z',
      solved: false,
    },
  ],
}

/**
 * Seeded rather than driven: solving needs the engine's exact best move,
 * which a real review may pick differently between Stockfish builds; the
 * driven path to the store is covered by the tests above.
 */
test('a solved mistake is marked solved, the rating is untouched, and it stays solved after a reload', async ({ page }) => {
  await page.addInitScript(
    ({ k, v }) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    },
    { k: KEY, v: JSON.stringify(SEEDED) },
  )
  await servePuzzles(page)
  await page.reload()
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  await expect(page.getByTestId('puzzle-origin')).toContainText('you played 25. h3??')
  await expect(page.getByTestId('puzzle-side-to-move')).toHaveText('White to move')
  await page.locator('[data-square="a1"]').click()
  await page.locator('[data-square="a8"]').click() // Ra8# also mates
  await expect(page.getByTestId('puzzle-status')).toHaveText('Solved!')
  await expect(page.getByTestId('mistake-solved')).toHaveCount(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('chess-game:puzzles') ?? 'null'))).toMatchObject({
    rating: 1200,
    games: 0,
  })

  await page.reload()
  await openPuzzles(page)
  await page.getByTestId('puzzle-source').selectOption('mistakes')
  await expect(page.getByTestId('mistake-solved')).toHaveCount(1)
})
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npx playwright test tests/e2e/blunder-puzzles.spec.ts tests/e2e/puzzles.spec.ts`
Expected: clean; all green (4 + 5 specs).

Then: `npm run e2e`
Expected: 44/44.

- [ ] **Step 8: Commit**

```bash
git add src/ui/puzzles tests/e2e/blunder-puzzles.spec.ts
git commit -m "feat(puzzles): My mistakes source with origin and solved marks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Phase 3 verification sweep

**Model tier:** cheap.

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

Expected: all green. Unit tests well above the 492 baseline (6 skipped unchanged); e2e 44/44 = the 35 baseline + `blunder-puzzles` (4) + `puzzles` (5).

- [ ] **Step 2: The curation is not part of any normal command**

```bash
grep -n "curate" package.json
grep -rn "zst\|curate-puzzles" vite.config.ts playwright.config.ts scripts/copy-engine.mjs || echo "not wired into build/test"
git ls-files | grep -c "\.zst$" || true
```

Expected: only the `"curate-puzzles"` script line; `not wired into build/test`; `0` committed `.zst` files.

- [ ] **Step 3: chess.js stays in game-core**

```bash
grep -rln "from 'chess.js'" src scripts server | grep -v "^src/game-core/" || echo "chess.js only in game-core"
```

Expected: `chess.js only in game-core`.

- [ ] **Step 4: Production smoke test**

```bash
npm run build
npm run server &
sleep 2
curl -sI http://127.0.0.1:8787/puzzles/puzzles.json | head -1   # HTTP/1.1 200 OK
curl -s http://127.0.0.1:8787/puzzles/puzzles.json | head -c 20; echo   # {"v":1,"puzzles":[
kill %1
```

Expected: exactly those outputs.

- [ ] **Step 5: Manual browser checklist (`npm run dev`, then http://localhost:5173)**

Tick each in a real browser, light AND dark system theme:
- [ ] Network tab: `puzzles.json` is NOT requested on page load, only when Puzzles is first clicked.
- [ ] One-player game at level 3, mid-game → Puzzles → wait 10 s → Back: no engine move was made meanwhile, the clock (if timed) did not move, and the engine replies normally afterwards.
- [ ] Rated: a puzzle near 1200 appears, oriented from the solver's side, with side to move, themes and both ratings. The setup move animates in, the opponent replies after a correct move.
- [ ] A wrong move: red square on it, rating drops immediately; Retry; Show solution plays the line through.
- [ ] Hint: first press highlights the piece, second draws the arrow; the rating drops.
- [ ] A promotion puzzle (filter theme "Promotion") opens the promotion picker and accepts the right piece.
- [ ] Theme filter changes the puzzle; Next never repeats the current one.
- [ ] Finish a game with a blunder against the engine, review it, then Puzzles → My mistakes: it is listed with date, opening and move; solving it marks it Solved; the rating does not change.
- [ ] Corrupt `chess-game:puzzles` by hand in DevTools (`localStorage.setItem('chess-game:puzzles','{')`), reload, open Puzzles: rating 1200, no crash.
- [ ] Narrow window (≤ 768 px): single column, board still square, controls wrap.

- [ ] **Step 6: Commit (only if Steps 1–5 required fixes)**

```bash
git add -A
git commit -m "fix: Phase 3 verification sweep

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Spec Coverage (self-review)

| Requirement (spec Phase 3 + user decisions + binding sections) | Task |
|---|---|
| A curated set of a few thousand Lichess puzzles (CC0), not the full DB | 2 (script), 3 (run + data + NOTICE) |
| Curation deterministic, quality-filtered, rating-balanced, theme-diverse, validated through game-core; never needed by install/build/test | 2, 3, 11 |
| Committed data + generated lazily loaded JSON; up-to-date test like openings | 1 (builder, loader), 3 (test) |
| Lichess format: setup move auto-played; any mate solves | 4, 8 (timers) |
| Separate Puzzles mode on the same Board; side to move, themes, puzzle rating, user rating; Retry / Hint / Show solution / Next / Back | 9 |
| In-progress game preserved; no engine moves and no clocks while puzzling | 9 (`usePuzzleMode` + e2e) |
| Adaptive rating: 1200 start, Elo, first-try solve = win, wrong/solution/hint = loss, K 40→20 | 4 (once-only outcome), 5, 6, 9 |
| Selection near the user's rating from unseen puzzles, theme filter, injectable RNG | 5, 9 |
| Graded graphical hint via the existing overlay (piece, then move) | 8, 9 |
| Board orientation from the solver's side | 9, 10 |
| Puzzles from the user's own blunders (spec) — auto-saved from reviews, engine-verified best move, deduped, capped, versioned | 6, 7 |
| "Rated" vs "My mistakes" switch; mistakes unrated, show their origin, marked solved | 10 |
| Error table: puzzles.json fails → clear message, game unaffected; corrupt storage → graceful reset | 1, 6, 9 |
| Persistence: localStorage only, namespaced, versioned, defensive | 6 |
| One Stockfish worker, only EngineLane, `controller.analyze` only (no new engine calls) | Global Constraints; 7 (reuses review data) |
| Testing: every UI task ships a Playwright spec; `/api` routed; puzzle specs use a fixture set | 7, 9, 10 |

Deliberately not in Phase 3: engine-assisted checking of alternative (non-mating) moves in My-mistakes puzzles (only the review's best move or a mate is accepted — see the Task 7 ruling); puzzle streaks/timers/leaderboards; a puzzle history view.
