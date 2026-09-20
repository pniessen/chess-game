# Chess Game — Design

**Date:** 2026-09-20
**Status:** Approved, ready for implementation planning

## Purpose

A browser-based chess game playable by zero, one, or two humans. It enforces
the full rules, offers a strong engine opponent at selectable difficulty,
teaches through AI-written hints and post-game review, and knows the classic
openings by name.

## Player modes

| Mode | Meaning |
|---|---|
| Zero-player | Engine vs. engine, with pause, single-step, and a speed slider |
| One-player | Human vs. engine; the human picks a colour and a difficulty level |
| Two-player | Two humans sharing one screen, hot-seat |

## Stack

TypeScript throughout. Vite builds the frontend, React renders the UI, Express
runs the hint server. Three libraries carry the load:

- **chess.js** — move generation and rules. Handles en passant, castling
  rights, promotion, check, checkmate, stalemate, threefold repetition, the
  50-move rule, insufficient material, SAN, FEN, and PGN. Hand-writing this is
  the single most reliable way to ship a subtly broken chess game.
- **stockfish.wasm** — the engine, in a Web Worker so thinking never blocks
  the UI.
- **A bundled ECO opening dataset** — roughly 3,500 named openings with their
  move sequences, used by the explorer and by the engine's book moves.

## Architecture

```
Browser (Vite/React)                    Node server (Express)
├── ui/                                 ├── serves the built app
├── game-core/   rules, history         └── POST /api/hint    ──► Claude API
├── clock/       timers                     POST /api/review      (key in .env)
├── engine/      Stockfish worker
├── openings/    ECO lookup + book
├── coach/       hint/review client
└── storage/     localStorage
```

Everything that makes the game work runs in the browser with no network. The
server exists only to hold the Claude API key and relay two request types.
The game is fully playable with the server down.

### Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `game-core` | Rules, move history, undo/redo, result detection | chess.js |
| `clock` | Two timers, increment, flag detection | nothing |
| `engine` | UCI conversation with Stockfish; strength; analysis | worker |
| `openings` | Name the current position; list openings; book moves | ECO data |
| `coach` | Hint and review requests, with templated fallback | server API |
| `storage` | Game history, settings, score | nothing |
| `ui` | Board, panels, controls | all of the above |

**Invariant:** `game-core` imports nothing from React, Stockfish, or the
network. It is pure logic, and it carries the densest test coverage in the
project.

### Data flow for a move

1. UI reports an attempted move (drag release or second click).
2. `game-core` validates it against the legal move list and either rejects it
   or applies it, producing a new position, a SAN string, and a result status.
3. `clock` switches sides and applies the increment.
4. `openings` looks up the new position and reports a name if it has one.
5. If the side to move is an engine, `engine` is asked for a move; its reply
   re-enters at step 2.

## Difficulty

Eight levels, roughly 600 Elo to full strength. Each level sets a Stockfish
Skill Level, a search depth cap, a move time cap, and a **deliberate blunder
rate** — the probability of playing a known-inferior move instead of the best
one. The blunder rate is not optional garnish: a depth-limited Stockfish is
still far stronger than a beginner and never errs in a human-looking way, so
without it the lower levels are neither beatable nor instructive.

Levels 1–3 also prefer the opening book heavily, so early play looks natural.

## Phases

Each phase ends with something usable and gets its own implementation plan.

### Phase 1 — A complete playable game

No Claude, no server. The hint button ships in this phase but gives a
templated explanation derived from Stockfish output.

- Board: drag-and-drop and click-to-move, legal-move dots, last-move
  highlight, check indicator, coordinates, board flip
- Full rules via `game-core`, including a promotion picker and every draw
  condition
- All three player modes; colour selection in one-player mode
- Eight difficulty levels
- Clocks: bullet, blitz, rapid, classical presets, each with increment, plus
  an untimed option; flag detection ends the game
- Move list in SAN, click any move to jump to that position; undo and redo
- Captured pieces and material balance
- PGN export and import; FEN load
- Session scorekeeper (W/L/D)
- Zero-player controls: pause, single-step, speed slider
- Templated hints from engine output

### Phase 2 — The coach and the explorer

- Express server with `/api/hint` and `/api/review`; API key in `.env`
- Graded hints: a nudge, then the move, then the reasoning
- Evaluation bar beside the board
- Opening naming as you play; opening explorer with "start from this opening"
- Engine book moves drawn from the same dataset
- Post-game review: blunder/mistake/good-move marking, plus a Claude-written
  summary of how the game went
- Persistent game history in localStorage: date, result, opening, accuracy
- Sounds (move, capture, check, game end) and a few board and piece themes

### Phase 3 — Puzzles

- A curated set of a few thousand tactics puzzles bundled from the Lichess
  puzzle database (CC0). Not the full four-million-row database.
- Puzzles generated from the user's own blunders, using the history from
  Phase 2.

## Interface layout

Board centred. Left column: clocks, captured pieces, score. Right column: a
tab group over move list, opening explorer, and analysis. Controls beneath the
board. On a narrow screen it collapses to a single column with the panels as
tabs below the board.

## Persistence

localStorage only. No accounts, no database, no server-side state.

- `settings` — difficulty, time control, theme, sound, board orientation
- `score` — the running W/L/D for the current match
- `history` — finished games: date, result, opening name, PGN, accuracy
- `game-in-progress` — so a reload does not lose the game

## Error handling

| Failure | Behaviour |
|---|---|
| Stockfish fails to load | AI modes disabled with a clear message; two-player still works |
| Hint server unreachable | Silent fallback to templated hints; a badge reads "coaching offline" |
| Claude API error or rate limit | Same fallback; the error is surfaced once, not per request |
| Malformed PGN or FEN on import | Specific parse error; the current game is left untouched |
| Engine returns an illegal move | Rejected by `game-core`, logged, and re-requested once. On a second failure the game is halted with an error message and the position preserved for export, rather than corrupted by an illegal move |

## Testing

Vitest for unit tests, Playwright for end-to-end.

- `game-core` carries the densest coverage: a corpus of tricky positions (en
  passant pins, castling through and out of check, all five
  insufficient-material cases, threefold repetition by position rather than by
  move sequence), plus **perft tests** — legal-move-sequence counts from known
  positions checked against published values, which catch essentially any
  rules bug.
- `clock` uses fake timers to test increment, flag detection, and the
  switchover.
- `engine` and `coach` are tested against mocked boundaries; no test depends
  on a live Claude API or on Stockfish's actual choice of move.
- `openings` is tested for correct naming on known transpositions.
- Playwright drives a handful of real games end to end, one per player mode.

## Out of scope

Deliberately excluded from all three phases: online multiplayer, user
accounts, premoves, engine "personalities", and an Elo estimate for the
player. Each is a reasonable later addition; none is needed for the game to be
good.
