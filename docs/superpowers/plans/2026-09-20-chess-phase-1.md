# Chess Game Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, playable browser chess game supporting zero, one, and two human players, with full rules enforcement, a Stockfish opponent at eight difficulty levels, clocks, move navigation, PGN/FEN import and export, and a session scorekeeper.

**Architecture:** A React front end over four framework-free TypeScript modules — `game-core` (rules, wrapping chess.js), `clock`, `engine` (Stockfish in a Web Worker), and `storage`. A single `MatchController` owns all game state and mediates between the human, the engine, and the clock; React subscribes to it through one `useSyncExternalStore` hook. Nothing in `game-core` imports React, the engine, or the network.

**Tech Stack:** TypeScript 7, Vite 8, React 19, Vitest 5, Playwright 1.63, chess.js 1.4, stockfish (WASM, in a Worker).

**Spec:** `docs/superpowers/specs/2026-09-20-chess-game-design.md`

## Global Constraints

- **Node >= 20.** Verified working on Node 26.7.0. `package.json` sets `"engines": { "node": ">=20" }`.
- **TypeScript strict mode**, with `noUncheckedIndexedAccess: true`. The board is an 8x8 array indexed constantly; this flag forces the null checks that catch real bugs.
- **chess.js is imported by exactly one directory: `src/game-core/`.** No other module may import it. This keeps the rules engine replaceable and stops chess.js's mutable, exception-throwing API leaking into the UI.
- **chess.js `.move()` THROWS on an illegal move — it does not return null.** Every call site must be inside the `game-core` facade's try/catch. Verified against chess.js 1.4.0.
- **chess.js `Move.isCapture()` returns FALSE for en passant.** Any capture check must be `m.isCapture() || m.isEnPassant()`. This is applied once, at the `game-core` boundary, when building a `PlayedMove`.
- **chess.js `Move` is a class with methods.** Never store a chess.js `Move` in React state or clone it structurally — the methods will not survive. Convert to the plain `PlayedMove` type at the boundary.
- **Import style:** `import { Chess } from 'chess.js'`. There is no default export in 1.x.
- **Every module outside `ui/` is plain TypeScript with no React import.** If a task tempts you to import React into `game-core`, `clock`, `engine`, `storage`, or `match`, the design is wrong — stop and re-read the module's interface.
- **TDD throughout:** write the failing test, run it and watch it fail, write the minimal implementation, run it and watch it pass, commit. Every task below is structured this way.
- **Piece artwork:** the Rhosgfx set, CC0 1.0. Verified against `lichess-org/lila` `COPYING.md`, which lists `public/piece/rhosgfx | RhosGFX | CC0 1.0`. No attribution is legally required; we credit it anyway in `NOTICE.md`.

---

## File Structure

```
chess-game/
├── docs/superpowers/{specs,plans}/
├── public/pieces/            # 12 CC0 SVGs: wK.svg … bP.svg
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── NOTICE.md
├── src/
│   ├── main.tsx
│   ├── test-setup.ts
│   ├── game-core/            # NO react, NO network. The only chess.js importer.
│   │   ├── types.ts          # PlayedMove, MoveIntent, MoveResult, GameStatus
│   │   ├── position.ts       # Position: legal moves, apply, status
│   │   ├── game.ts           # Game: history, undo/redo, jump-to-ply
│   │   └── io.ts             # PGN/FEN import + export
│   ├── clock/
│   │   ├── types.ts
│   │   └── clock.ts          # injectable now(), no drift
│   ├── engine/
│   │   ├── uci.ts            # pure message parsing
│   │   ├── strength.ts       # pure: Level -> StrengthProfile
│   │   └── client.ts         # Worker transport
│   ├── match/
│   │   ├── types.ts          # Seat, MatchConfig, MatchPhase, MatchSnapshot
│   │   └── controller.ts     # MatchController — owns all game state
│   ├── storage/storage.ts    # defensive localStorage
│   ├── coach/templated.ts    # phase-1 hint fallback
│   └── ui/
│       ├── App.tsx
│       ├── useMatch.ts       # the single useSyncExternalStore binding
│       ├── Board/
│       │   ├── Board.tsx
│       │   ├── Square.tsx
│       │   ├── Piece.tsx
│       │   ├── squares.ts    # pure: square ordering for an orientation
│       │   ├── selection.ts  # pure: click-to-move state machine
│       │   ├── useDragMove.ts # pointer-event drag, with pure helpers
│       │   ├── Promotion.tsx
│       │   └── board.css
│       └── panels/
│           ├── MoveList.tsx
│           ├── movePairs.ts  # pure
│           ├── Captured.tsx
│           ├── material.ts   # pure
│           ├── Clocks.tsx
│           ├── Controls.tsx
│           ├── GameIO.tsx    # PGN/FEN import + export
│           ├── NewGame.tsx
│           └── Scoreboard.tsx
└── tests/e2e/
    ├── two-player.spec.ts
    ├── one-player.spec.ts
    └── zero-player.spec.ts
```

**The pattern to notice:** every component with real logic has a sibling
pure module (`squares.ts`, `selection.ts`, `movePairs.ts`, `material.ts`)
holding that logic. The component renders; the pure module decides. This is
what makes the UI testable without the DOM, and it keeps every file small
enough to hold in your head at once.

---

## Task Order and Milestones

Tasks 1–9 (including 7b) end at the first milestone: **a fully playable
two-human game with complete rules**, no engine involved. Tasks 10–13 add
the engine and the match controller. Tasks 14–19 add the panels, I/O,
persistence, hints, and end-to-end tests.

Task 7b (drag-and-drop) is the one task that can be deferred without
blocking anything else — click-to-move is a complete input method on its
own. If you are short on time, move it after Task 17 rather than dropping
it; the spec asks for both input methods.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `NOTICE.md`
- Create: `src/main.tsx`, `src/test-setup.ts`, `src/ui/App.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `dev`, `build`, `test`, `test:watch`, `typecheck`, `e2e`. A rendering `<App />`.

We scaffold by hand rather than with `npm create vite`, because create-vite is
interactive and its template shifts between releases; a plan that says "run
the wizard then edit" is not reproducible.

- [ ] **Step 1: Write the failing test**

`src/ui/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { App } from './App'

test('renders the app title', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: /chess/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: FAIL — vitest is not installed yet, so the command itself errors. That is the expected failure at this step.

- [ ] **Step 3: Create `package.json` and install**

```json
{
  "name": "chess-game",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "chess.js": "^1.4.0",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^30.1.0",
    "typescript": "^7.0.2",
    "vite": "^8.3.0",
    "vitest": "^5.0.1"
  }
}
```

Run: `npm install`

Note: TypeScript 7.x is the native (Go) compiler. If `tsc -b` misbehaves in a
way you cannot resolve in a few minutes, drop to `"typescript": "^6.0.0"` and
say so in the commit message. Do not spend an hour on it.

- [ ] **Step 4: Create the config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests"]
}
```

`vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
```

`src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

`src/vite-env.d.ts` — required before any module does `import './x.css'`,
which a later task does. Without it TypeScript has no declaration for CSS
side-effect imports and `npm run typecheck` fails:
```ts
/// <reference types="vite/client" />
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chess</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/ui/App.tsx`:
```tsx
export function App() {
  return <h1>Chess</h1>
}
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.local
test-results/
playwright-report/
```

- [ ] **Step 5: Run the test and the typechecker**

Run: `npm test`
Expected: PASS, 1 test.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Write `NOTICE.md`**

```markdown
# Third-party assets

Chess piece artwork: the **Rhosgfx** set by RhosGFX, released under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain dedication). Obtained from the Lichess asset repository,
which records the licence in its `COPYING.md`.
Source: https://rhosgfx.itch.io/vector-chess-pieces

CC0 requires no attribution; this credit is given voluntarily.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript + Vitest"
```

---

### Task 2: game-core types and the Position facade

**Files:**
- Create: `src/game-core/types.ts`
- Create: `src/game-core/position.ts`
- Test: `src/game-core/position.test.ts`

**Interfaces:**
- Consumes: `chess.js` (this directory is the only place it may be imported).
- Produces:
  - `type PlayedMove = { san: string; from: Square; to: Square; piece: PieceSymbol; color: Color; captured?: PieceSymbol; promotion?: PieceSymbol; isCapture: boolean; isCastle: boolean; isEnPassant: boolean; fenAfter: string }`
  - `type MoveIntent = { from: Square; to: Square; promotion?: PieceSymbol }`
  - `type MoveResult = { ok: true; move: PlayedMove } | { ok: false; reason: 'illegal' | 'game-over' | 'needs-promotion' }`
  - `type DrawReason = 'stalemate' | 'insufficient-material' | 'threefold-repetition' | 'fifty-move-rule'`
  - `type GameStatus = { kind: 'in-progress'; inCheck: boolean } | { kind: 'checkmate'; winner: Color } | { kind: 'draw'; reason: DrawReason }`
  - `class Position` with `fen()`, `turn()`, `board()`, `legalMoves()`, `legalMovesFrom(sq)`, `isPromotion(from, to)`, `tryMove(intent)`, `undo()`, `status()`, `kingSquare(color)`, `clone()`, and `static fromFen(fen)`.

**Why this wrapper exists:** chess.js is mutable and throws on illegal moves.
A UI that speculatively asks "is this legal?" on every drag cannot use
exceptions for control flow, and React state cannot hold chess.js `Move`
instances because their methods do not survive cloning. The facade converts
both problems into plain data at a single boundary.

- [ ] **Step 1: Write the failing test**

`src/game-core/position.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Position } from './position'

describe('Position', () => {
  test('a new position is the standard opening, White to move', () => {
    const p = new Position()
    expect(p.turn()).toBe('w')
    expect(p.fen()).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(p.status()).toEqual({ kind: 'in-progress', inCheck: false })
  })

  test('legalMovesFrom returns the pawn double and single push', () => {
    const p = new Position()
    const tos = p.legalMovesFrom('e2').map((m) => m.to).sort()
    expect(tos).toEqual(['e3', 'e4'])
  })

  test('tryMove returns ok and a PlayedMove for a legal move', () => {
    const p = new Position()
    const r = p.tryMove({ from: 'e2', to: 'e4' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.move.san).toBe('e4')
    expect(r.move.isCapture).toBe(false)
    expect(p.turn()).toBe('b')
  })

  test('tryMove REPORTS an illegal move instead of throwing', () => {
    const p = new Position()
    expect(() => p.tryMove({ from: 'e2', to: 'e5' })).not.toThrow()
    expect(p.tryMove({ from: 'e2', to: 'e5' })).toEqual({ ok: false, reason: 'illegal' })
    expect(p.turn()).toBe('w')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/game-core/position.test.ts`
Expected: FAIL — `Cannot find module './position'`.

- [ ] **Step 3: Write `src/game-core/types.ts`**

```ts
import type { Color, PieceSymbol, Square } from 'chess.js'

export type { Color, PieceSymbol, Square }

/** A plain, cloneable record of a played move. Never a chess.js Move. */
export interface PlayedMove {
  san: string
  from: Square
  to: Square
  piece: PieceSymbol
  color: Color
  captured?: PieceSymbol
  promotion?: PieceSymbol
  /** True for en passant too, unlike chess.js Move.isCapture(). */
  isCapture: boolean
  isCastle: boolean
  isEnPassant: boolean
  fenAfter: string
}

export interface MoveIntent {
  from: Square
  to: Square
  promotion?: PieceSymbol
}

export type MoveResult =
  | { ok: true; move: PlayedMove }
  | { ok: false; reason: 'illegal' | 'game-over' | 'needs-promotion' }

export type DrawReason =
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'

export type GameStatus =
  | { kind: 'in-progress'; inCheck: boolean }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'draw'; reason: DrawReason }

export const STARTING_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
```

- [ ] **Step 4: Write `src/game-core/position.ts`**

```ts
import { Chess, type Move } from 'chess.js'
import type {
  Color,
  GameStatus,
  MoveIntent,
  MoveResult,
  PieceSymbol,
  PlayedMove,
  Square,
} from './types'

/** Convert a chess.js Move (a class) into our plain, cloneable record. */
function toPlayedMove(m: Move): PlayedMove {
  return {
    san: m.san,
    from: m.from,
    to: m.to,
    piece: m.piece,
    color: m.color,
    captured: m.captured,
    promotion: m.promotion,
    // chess.js isCapture() is FALSE for en passant — fix it here, once.
    isCapture: m.isCapture() || m.isEnPassant(),
    // chess.js 1.4.0 documents an isCastle() in a doc comment but does NOT
    // ship one — it is undefined at runtime. Compose it from the two that
    // do exist.
    isCastle: m.isKingsideCastle() || m.isQueensideCastle(),
    isEnPassant: m.isEnPassant(),
    fenAfter: m.after,
  }
}

export class Position {
  private readonly chess: Chess

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess()
  }

  static fromFen(
    fen: string,
  ): { ok: true; position: Position } | { ok: false; error: string } {
    try {
      return { ok: true, position: new Position(fen) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  fen(): string {
    return this.chess.fen()
  }

  turn(): Color {
    return this.chess.turn()
  }

  board() {
    return this.chess.board()
  }

  /**
   * Every legal move, with promotions expanded into four separate intents.
   * The expansion matters: a collapsed promotion undercounts in perft and
   * would hide a whole class of move-generation bug.
   */
  legalMoves(): MoveIntent[] {
    return this.chess.moves({ verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }))
  }

  legalMovesFrom(square: Square): MoveIntent[] {
    return this.chess.moves({ square, verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      ...(m.promotion ? { promotion: m.promotion } : {}),
    }))
  }

  /** Would a move from->to require choosing a promotion piece? */
  isPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && m.promotion !== undefined)
  }

  /** Never throws. An illegal move is a returned value. */
  tryMove(intent: MoveIntent): MoveResult {
    if (this.status().kind !== 'in-progress') {
      return { ok: false, reason: 'game-over' }
    }
    if (!intent.promotion && this.isPromotion(intent.from, intent.to)) {
      return { ok: false, reason: 'needs-promotion' }
    }
    try {
      const m = this.chess.move({
        from: intent.from,
        to: intent.to,
        ...(intent.promotion ? { promotion: intent.promotion } : {}),
      })
      return { ok: true, move: toPlayedMove(m) }
    } catch {
      return { ok: false, reason: 'illegal' }
    }
  }

  undo(): PlayedMove | null {
    const m = this.chess.undo()
    return m ? toPlayedMove(m) : null
  }

  /**
   * Order matters and is deliberate: checkmate first, then each draw
   * condition in a fixed priority so the reported reason is deterministic.
   */
  status(): GameStatus {
    if (this.chess.isCheckmate()) {
      return { kind: 'checkmate', winner: this.chess.turn() === 'w' ? 'b' : 'w' }
    }
    if (this.chess.isStalemate()) {
      return { kind: 'draw', reason: 'stalemate' }
    }
    if (this.chess.isInsufficientMaterial()) {
      return { kind: 'draw', reason: 'insufficient-material' }
    }
    if (this.chess.isThreefoldRepetition()) {
      return { kind: 'draw', reason: 'threefold-repetition' }
    }
    if (this.chess.isDrawByFiftyMoves()) {
      return { kind: 'draw', reason: 'fifty-move-rule' }
    }
    return { kind: 'in-progress', inCheck: this.chess.isCheck() }
  }

  kingSquare(color: Color): Square | null {
    const found = this.chess.findPiece({ color, type: 'k' as PieceSymbol })
    return found[0] ?? null
  }

  clone(): Position {
    return new Position(this.fen())
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/game-core/position.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/game-core tests
git commit -m "feat(game-core): Position facade over chess.js with result-typed moves"
```

---

### Task 3: Rules correctness — perft and special-move tests

**Files:**
- Create: `src/game-core/perft.ts`
- Create: `tests/fixtures/positions.ts`
- Test: `src/game-core/perft.test.ts`, `src/game-core/rules.test.ts`

**Interfaces:**
- Consumes: `Position` from Task 2.
- Produces: `function perft(pos: Position, depth: number): number`, and the fixture FEN constants used by later tasks' tests.

Perft counts the leaves of the legal-move tree to a given depth. Comparing
against published counts is the standard proof that a move generator handles
castling, en passant, promotion, and pins correctly. We are chiefly testing
our own `legalMoves()` — if it filtered, duplicated, or failed to expand a
promotion, perft catches it immediately, and almost nothing else would.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/positions.ts`:
```ts
/**
 * Perft reference positions and node counts from the Chess Programming Wiki
 * "Perft Results" page, cross-checked against rocechess.ch and the
 * python-chess `tricky.perft` corpus. All three sources agreed exactly.
 */
export const PERFT_POSITIONS = [
  {
    name: 'initial position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    nodes: [20, 400, 8902, 197281],
  },
  {
    name: 'Kiwipete (position 2)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    nodes: [48, 2039, 97862, 4085603],
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    nodes: [14, 191, 2812, 43238],
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    nodes: [6, 264, 9467, 422333],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    nodes: [44, 1486, 62379, 2103487],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    nodes: [46, 2079, 89890, 3894594],
  },
] as const

/** Positions exercising one rule each, for the targeted rules tests. */
export const RULE_FIXTURES = {
  /** White pawn on a7 may promote to any of four pieces. */
  promotionChoice: '8/P7/8/8/8/8/8/K6k w - - 0 1',
  /** Black has just played d7-d5; White may capture en passant on d6. */
  enPassantAvailable: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
  /** White to move, castling rights intact, nothing attacked. */
  castlingAvailable: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
  /**
   * White king on e1 is in check from the black rook on e8 down the open
   * e-file, with castling rights still intact on both sides. Verified with
   * chess.js: isCheck() === true, and legalMovesFrom('e1') is ['f1','d1'] —
   * neither g1 nor c1.
   */
  castlingWhileInCheck: '4r2k/pppp1ppp/8/8/8/8/PPPP1PPP/R3K2R w KQ - 0 1',
  /** Black king alone vs white king: insufficient material. */
  insufficientMaterial: '8/8/8/4k3/8/8/8/4K3 w - - 0 1',
  /** Black to move is stalemated. */
  stalemate: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
  /** White mates in one with Qxf7. */
  mateInOne: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
} as const
```

The `castlingWhileInCheck` FEN above has been verified against chess.js —
an earlier draft of this plan used a position where the two kings faced each
other down an open e-file, which is not check at all (and is in fact an
impossible position). The test still asserts `inCheck: true` FIRST and only
then asserts that no castling move appears, so that it can never pass for
the wrong reason.

- [ ] **Step 2: Write the failing perft test**

`src/game-core/perft.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Position } from './position'
import { perft } from './perft'
import { PERFT_POSITIONS } from '../../tests/fixtures/positions'

describe('perft', () => {
  for (const pos of PERFT_POSITIONS) {
    // Depths 1-3 run on every test invocation; depth 4 is millions of nodes
    // for some positions and would make the suite unusable.
    for (let depth = 1; depth <= 3; depth++) {
      test(`${pos.name} depth ${depth}`, () => {
        expect(perft(new Position(pos.fen), depth)).toBe(pos.nodes[depth - 1])
      })
    }
  }
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/game-core/perft.test.ts`
Expected: FAIL — `Cannot find module './perft'`.

- [ ] **Step 4: Write `src/game-core/perft.ts`**

```ts
import type { Position } from './position'

/**
 * Count the leaves of the legal-move tree to `depth`.
 *
 * This validates our own legalMoves(): if it dropped a move, duplicated one,
 * or failed to expand a promotion into four entries, the count diverges from
 * the published value immediately. Very little else would catch those bugs.
 */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1
  let nodes = 0
  for (const intent of pos.legalMoves()) {
    const next = pos.clone()
    const result = next.tryMove(intent)
    if (!result.ok) {
      throw new Error(
        `legalMoves() produced an illegal move: ${intent.from}${intent.to}` +
          `${intent.promotion ?? ''} in ${pos.fen()}`,
      )
    }
    nodes += perft(next, depth - 1)
  }
  return nodes
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/game-core/perft.test.ts`
Expected: PASS, 18 tests. If any position's count is wrong, the bug is in
`legalMoves()` — most likely the promotion expansion.

- [ ] **Step 6: Write the targeted rules tests**

`src/game-core/rules.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Position } from './position'
import type { Square } from './types'
import { RULE_FIXTURES } from '../../tests/fixtures/positions'

describe('special moves', () => {
  test('a promotion offers exactly four choices', () => {
    const p = new Position(RULE_FIXTURES.promotionChoice)
    const promos = p.legalMovesFrom('a7').filter((m) => m.to === 'a8')
    expect(promos.map((m) => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r'])
  })

  test('a promotion move without a piece is reported as needs-promotion', () => {
    const p = new Position(RULE_FIXTURES.promotionChoice)
    expect(p.tryMove({ from: 'a7', to: 'a8' })).toEqual({
      ok: false,
      reason: 'needs-promotion',
    })
    const r = p.tryMove({ from: 'a7', to: 'a8', promotion: 'n' })
    expect(r.ok).toBe(true)
  })

  test('en passant is available immediately after the double push', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    expect(p.legalMovesFrom('e5').some((m) => m.to === 'd6')).toBe(true)
  })

  test('an en passant capture is recorded as a capture', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    const r = p.tryMove({ from: 'e5', to: 'd6' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    // chess.js's own isCapture() is FALSE here; our boundary must fix it.
    expect(r.move.isEnPassant).toBe(true)
    expect(r.move.isCapture).toBe(true)
  })

  test('en passant expires if not taken immediately', () => {
    const p = new Position(RULE_FIXTURES.enPassantAvailable)
    p.tryMove({ from: 'a2', to: 'a3' })
    p.tryMove({ from: 'a7', to: 'a6' })
    expect(p.legalMovesFrom('e5').some((m) => m.to === 'd6')).toBe(false)
  })

  test('castling is offered when legal', () => {
    const p = new Position(RULE_FIXTURES.castlingAvailable)
    const kingMoves = p.legalMovesFrom('e1').map((m) => m.to)
    expect(kingMoves).toContain('g1')
    expect(kingMoves).toContain('c1')
  })

  test('castling is unavailable while in check', () => {
    const p = new Position(RULE_FIXTURES.castlingWhileInCheck)
    expect(p.status()).toEqual({ kind: 'in-progress', inCheck: true })
    const kingMoves = p.legalMovesFrom('e1').map((m) => m.to)
    expect(kingMoves).not.toContain('g1')
    expect(kingMoves).not.toContain('c1')
  })

  test('castling rights are lost once the rook moves', () => {
    const p = new Position(RULE_FIXTURES.castlingAvailable)
    p.tryMove({ from: 'h1', to: 'g1' })
    p.tryMove({ from: 'a7', to: 'a6' })
    p.tryMove({ from: 'g1', to: 'h1' })
    p.tryMove({ from: 'a6', to: 'a5' })
    expect(p.legalMovesFrom('e1').map((m) => m.to)).not.toContain('g1')
  })
})

describe('game results', () => {
  test('checkmate names the winner', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    const r = p.tryMove({ from: 'f3', to: 'f7' })
    expect(r.ok).toBe(true)
    expect(p.status()).toEqual({ kind: 'checkmate', winner: 'w' })
  })

  test('stalemate is a draw, not a checkmate', () => {
    const p = new Position(RULE_FIXTURES.stalemate)
    expect(p.status()).toEqual({ kind: 'draw', reason: 'stalemate' })
  })

  test('bare kings are insufficient material', () => {
    const p = new Position(RULE_FIXTURES.insufficientMaterial)
    expect(p.status()).toEqual({ kind: 'draw', reason: 'insufficient-material' })
  })

  test('threefold repetition is detected across a transposition', () => {
    const p = new Position()
    // Shuffle both knights out and back, twice, returning to the start
    // position for the third time.
    // The start position is counted once at construction, a second time
    // after the first cycle, and a third after the second — hence threefold.
    const cycle: Array<[Square, Square]> = [
      ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ]
    for (let i = 0; i < 2; i++) {
      for (const [from, to] of cycle) {
        const r = p.tryMove({ from, to })
        expect(r.ok).toBe(true)
      }
    }
    expect(p.status()).toEqual({ kind: 'draw', reason: 'threefold-repetition' })
  })

  test('undo restores the position exactly, including repetition state', () => {
    const p = new Position()
    const before = p.fen()
    p.tryMove({ from: 'e2', to: 'e4' })
    p.undo()
    expect(p.fen()).toBe(before)
  })

  test('a move is refused once the game is over', () => {
    const p = new Position(RULE_FIXTURES.mateInOne)
    p.tryMove({ from: 'f3', to: 'f7' })
    expect(p.tryMove({ from: 'e8', to: 'e7' })).toEqual({
      ok: false,
      reason: 'game-over',
    })
  })
})
```

- [ ] **Step 7: Run the rules tests**

Run: `npx vitest run src/game-core/rules.test.ts`
Expected: PASS. If `castlingWhileInCheck` fails its `inCheck: true`
assertion, fix the fixture FEN as flagged in Step 1 — do not weaken the test.

- [ ] **Step 8: Add a slow-depth guard and commit**

Add to `src/game-core/perft.test.ts`, so depth 4 is available but not run by
default:

```ts
describe.skip('perft depth 4 (slow — run manually)', () => {
  for (const pos of PERFT_POSITIONS) {
    test(`${pos.name} depth 4`, () => {
      expect(perft(new Position(pos.fen), 4)).toBe(pos.nodes[3])
    }, 120_000)
  }
})
```

```bash
git add src/game-core tests/fixtures
git commit -m "test(game-core): perft and special-move rules coverage"
```

---

### Task 4: Game — history, undo/redo, and move navigation

**Files:**
- Create: `src/game-core/game.ts`
- Test: `src/game-core/game.test.ts`

**Interfaces:**
- Consumes: `Position`, `PlayedMove`, `MoveIntent`, `MoveResult`, `GameStatus` from Tasks 2–3.
- Produces: `class Game` with `moves` (readonly `PlayedMove[]`), `ply`, `livePly`, `isViewingLive()`, `current()`, `positionAt(ply)`, `play(intent)`, `undo()`, `redo()`, `goTo(ply)`, `truncate(ply)`, `status()`, `startFen`.

**The one design decision that matters here:** browsing history is separate
from playing. `goTo(3)` shows the position after ply 3 but does **not**
discard the rest of the game. `play()` while browsing returns
`{ok:false, reason:'illegal'}` rather than silently destroying the moves
after the viewed ply — silently deleting a game the user was only reviewing
is the worst thing this class could do. Branching is explicit: call
`truncate(ply)` first, then `play()`.

`Game` stores the start FEN and the move list, and rebuilds a `Position` by
replaying moves. Replaying up to 200 plies is microseconds and keeps there
from being two sources of truth.

- [ ] **Step 1: Write the failing test**

`src/game-core/game.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Game } from './game'

describe('Game', () => {
  test('plays moves and records SAN history', () => {
    const g = new Game()
    expect(g.play({ from: 'e2', to: 'e4' }).ok).toBe(true)
    expect(g.play({ from: 'e7', to: 'e5' }).ok).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(g.livePly).toBe(2)
    expect(g.current().turn()).toBe('w')
  })

  test('undo removes the last move; redo restores it', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    expect(g.undo()).toBe(true)
    expect(g.moves).toHaveLength(0)
    expect(g.current().turn()).toBe('w')
    expect(g.redo()).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4'])
  })

  test('undo on an empty game returns false', () => {
    expect(new Game().undo()).toBe(false)
  })

  test('goTo shows an earlier position without discarding later moves', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    expect(g.ply).toBe(1)
    expect(g.isViewingLive()).toBe(false)
    expect(g.livePly).toBe(2)
    expect(g.moves).toHaveLength(2)
  })

  test('playing while browsing history is refused, not silently destructive', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    const r = g.play({ from: 'd7', to: 'd5' })
    expect(r.ok).toBe(false)
    expect(g.moves).toHaveLength(2)
  })

  test('truncate then play branches deliberately', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    g.truncate(1)
    expect(g.play({ from: 'c7', to: 'c5' }).ok).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'c5'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/game-core/game.test.ts`
Expected: FAIL — `Cannot find module './game'`.

- [ ] **Step 3: Write `src/game-core/game.ts`**

```ts
import { Position } from './position'
import { STARTING_FEN, type GameStatus, type MoveIntent, type MoveResult, type PlayedMove } from './types'

export class Game {
  readonly startFen: string
  private played: PlayedMove[] = []
  /** Moves taken back by undo(), available to redo(). Cleared on a new play. */
  private future: PlayedMove[] = []
  private viewPly: number

  constructor(opts?: { fen?: string }) {
    this.startFen = opts?.fen ?? STARTING_FEN
    this.viewPly = 0
  }

  get moves(): readonly PlayedMove[] {
    return this.played
  }

  get ply(): number {
    return this.viewPly
  }

  get livePly(): number {
    return this.played.length
  }

  isViewingLive(): boolean {
    return this.viewPly === this.played.length
  }

  /** Rebuild the position after `ply` moves by replaying from the start. */
  positionAt(ply: number): Position {
    const clamped = Math.max(0, Math.min(ply, this.played.length))
    const pos = new Position(this.startFen)
    for (let i = 0; i < clamped; i++) {
      const m = this.played[i]
      if (!m) break
      const r = pos.tryMove({ from: m.from, to: m.to, promotion: m.promotion })
      if (!r.ok) {
        throw new Error(`corrupt history: move ${i + 1} (${m.san}) is not legal`)
      }
    }
    return pos
  }

  current(): Position {
    return this.positionAt(this.viewPly)
  }

  play(intent: MoveIntent): MoveResult {
    if (!this.isViewingLive()) {
      // Refuse rather than discard. Call truncate() first to branch.
      return { ok: false, reason: 'illegal' }
    }
    const pos = this.positionAt(this.played.length)
    const result = pos.tryMove(intent)
    if (!result.ok) return result
    this.played.push(result.move)
    this.future = []
    this.viewPly = this.played.length
    return result
  }

  undo(): boolean {
    if (this.played.length === 0) return false
    const m = this.played.pop()
    if (m) this.future.push(m)
    this.viewPly = this.played.length
    return true
  }

  redo(): boolean {
    const m = this.future.pop()
    if (!m) return false
    this.played.push(m)
    this.viewPly = this.played.length
    return true
  }

  goTo(ply: number): void {
    this.viewPly = Math.max(0, Math.min(ply, this.played.length))
  }

  /** Discard every move after `ply`, making that the live position. */
  truncate(ply: number): void {
    const clamped = Math.max(0, Math.min(ply, this.played.length))
    this.played = this.played.slice(0, clamped)
    this.future = []
    this.viewPly = this.played.length
  }

  status(): GameStatus {
    return this.positionAt(this.played.length).status()
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/game-core/game.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/game-core/game.ts src/game-core/game.test.ts
git commit -m "feat(game-core): Game with history, undo/redo, and non-destructive browsing"
```

---

### Task 5: Chess clock

**Files:**
- Create: `src/clock/types.ts`, `src/clock/clock.ts`
- Test: `src/clock/clock.test.ts`

**Interfaces:**
- Consumes: nothing. This module imports no other project code.
- Produces:
  - `type TimeControl = { kind: 'timed'; initialMs: number; incrementMs: number } | { kind: 'untimed' }`
  - `type ClockState = { whiteMs: number; blackMs: number; running: 'w' | 'b' | null; flagged: 'w' | 'b' | null }`
  - `class Clock` with `start(side)`, `switchTo(side)`, `pause()`, `resume()`, `getState()`, `onFlag(cb)`, `dispose()`
  - `const TIME_CONTROLS: readonly { id: string; label: string; control: TimeControl }[]`

**Why it is built this way:** the clock does not decrement on a tick. It
records when the running side started and computes remaining time on read,
with a single `setTimeout` scheduled for exactly the remaining milliseconds
to fire the flag. A tick-based clock accumulates drift and will visibly
disagree with the wall clock over a long game. `now()` and the timer are
both injectable so tests use fake timers and never actually wait.

- [ ] **Step 1: Write the failing test**

`src/clock/clock.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Clock } from './clock'
import type { TimeControl } from './types'

const FIVE_MIN: TimeControl = { kind: 'timed', initialMs: 300_000, incrementMs: 3_000 }

describe('Clock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a new clock holds the initial time and is not running', () => {
    const c = new Clock(FIVE_MIN)
    expect(c.getState()).toEqual({
      whiteMs: 300_000, blackMs: 300_000, running: null, flagged: null,
    })
  })

  test('the running side loses time; the idle side does not', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(3_000)
    const s = c.getState()
    expect(s.whiteMs).toBe(297_000)
    expect(s.blackMs).toBe(300_000)
    expect(s.running).toBe('w')
  })

  test('switching sides applies the increment to the side that moved', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(3_000)
    c.switchTo('b')
    const s = c.getState()
    expect(s.whiteMs).toBe(300_000) // 297_000 + 3_000 increment
    expect(s.running).toBe('b')
  })

  test('pause freezes the clock and resume continues from the same time', () => {
    const c = new Clock(FIVE_MIN)
    c.start('w')
    vi.advanceTimersByTime(5_000)
    c.pause()
    vi.advanceTimersByTime(60_000)
    expect(c.getState().whiteMs).toBe(295_000)
    c.resume()
    vi.advanceTimersByTime(1_000)
    expect(c.getState().whiteMs).toBe(294_000)
  })

  test('running out fires onFlag once and clamps at zero', () => {
    const c = new Clock({ kind: 'timed', initialMs: 1_000, incrementMs: 0 })
    const flagged = vi.fn()
    c.onFlag(flagged)
    c.start('w')
    vi.advanceTimersByTime(5_000)
    expect(flagged).toHaveBeenCalledTimes(1)
    expect(flagged).toHaveBeenCalledWith('w')
    const s = c.getState()
    expect(s.whiteMs).toBe(0)
    expect(s.flagged).toBe('w')
  })

  test('an untimed control never runs and never flags', () => {
    const c = new Clock({ kind: 'untimed' })
    const flagged = vi.fn()
    c.onFlag(flagged)
    c.start('w')
    vi.advanceTimersByTime(600_000)
    expect(flagged).not.toHaveBeenCalled()
    expect(c.getState().running).toBe(null)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/clock/clock.test.ts`
Expected: FAIL — `Cannot find module './clock'`.

- [ ] **Step 3: Write `src/clock/types.ts`**

```ts
export type TimeControl =
  | { kind: 'timed'; initialMs: number; incrementMs: number }
  | { kind: 'untimed' }

export interface ClockState {
  whiteMs: number
  blackMs: number
  running: 'w' | 'b' | null
  flagged: 'w' | 'b' | null
}

export const TIME_CONTROLS: readonly {
  id: string
  label: string
  control: TimeControl
}[] = [
  { id: 'bullet-1-0', label: 'Bullet 1+0', control: { kind: 'timed', initialMs: 60_000, incrementMs: 0 } },
  { id: 'bullet-2-1', label: 'Bullet 2+1', control: { kind: 'timed', initialMs: 120_000, incrementMs: 1_000 } },
  { id: 'blitz-3-2', label: 'Blitz 3+2', control: { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 } },
  { id: 'blitz-5-3', label: 'Blitz 5+3', control: { kind: 'timed', initialMs: 300_000, incrementMs: 3_000 } },
  { id: 'rapid-10-5', label: 'Rapid 10+5', control: { kind: 'timed', initialMs: 600_000, incrementMs: 5_000 } },
  { id: 'rapid-15-10', label: 'Rapid 15+10', control: { kind: 'timed', initialMs: 900_000, incrementMs: 10_000 } },
  { id: 'classical-30-0', label: 'Classical 30+0', control: { kind: 'timed', initialMs: 1_800_000, incrementMs: 0 } },
  { id: 'untimed', label: 'No clock', control: { kind: 'untimed' } },
]
```

- [ ] **Step 4: Write `src/clock/clock.ts`**

```ts
import type { ClockState, TimeControl } from './types'

type Side = 'w' | 'b'

export class Clock {
  private readonly control: TimeControl
  private readonly now: () => number
  private remaining: Record<Side, number>
  private running: Side | null = null
  private startedAt = 0
  private flagged: Side | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private flagCallbacks: Array<(side: Side) => void> = []
  private pausedSide: Side | null = null

  constructor(control: TimeControl, now: () => number = Date.now) {
    this.control = control
    this.now = now
    const initial = control.kind === 'timed' ? control.initialMs : 0
    this.remaining = { w: initial, b: initial }
  }

  private get isTimed(): boolean {
    return this.control.kind === 'timed'
  }

  private elapsed(): number {
    return this.running === null ? 0 : this.now() - this.startedAt
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Bank the running side's elapsed time back into `remaining`. */
  private settle(): void {
    if (this.running === null) return
    const side = this.running
    this.remaining[side] = Math.max(0, this.remaining[side] - this.elapsed())
    this.running = null
    this.clearTimer()
  }

  private scheduleFlag(): void {
    if (!this.isTimed || this.running === null) return
    const side = this.running
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.remaining[side] = 0
      this.running = null
      this.timer = null
      this.flagged = side
      for (const cb of this.flagCallbacks) cb(side)
    }, this.remaining[side])
  }

  start(side: Side): void {
    if (!this.isTimed || this.flagged !== null) return
    this.settle()
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  /** The side that just moved gets the increment; `side` starts thinking. */
  switchTo(side: Side): void {
    if (!this.isTimed || this.flagged !== null) return
    const mover = this.running
    this.settle()
    if (mover !== null && this.control.kind === 'timed') {
      this.remaining[mover] += this.control.incrementMs
    }
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  pause(): void {
    if (!this.isTimed || this.running === null) return
    this.pausedSide = this.running
    this.settle()
  }

  resume(): void {
    if (!this.isTimed || this.pausedSide === null || this.flagged !== null) return
    const side = this.pausedSide
    this.pausedSide = null
    this.running = side
    this.startedAt = this.now()
    this.scheduleFlag()
  }

  getState(): ClockState {
    const live = { ...this.remaining }
    if (this.running !== null) {
      live[this.running] = Math.max(0, live[this.running] - this.elapsed())
    }
    return {
      whiteMs: live.w,
      blackMs: live.b,
      running: this.running,
      flagged: this.flagged,
    }
  }

  onFlag(cb: (side: Side) => void): void {
    this.flagCallbacks.push(cb)
  }

  dispose(): void {
    this.clearTimer()
    this.flagCallbacks = []
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/clock/clock.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/clock
git commit -m "feat(clock): drift-free chess clock with increment and flag detection"
```

---

### Task 6: Board rendering

**Files:**
- Create: `src/ui/Board/squares.ts`, `src/ui/Board/Piece.tsx`, `src/ui/Board/Square.tsx`, `src/ui/Board/Board.tsx`, `src/ui/Board/board.css`
- Create: `public/pieces/` (12 SVG files)
- Test: `src/ui/Board/squares.test.ts`, `src/ui/Board/Board.test.tsx`

**Interfaces:**
- Consumes: `Position` from Task 2.
- Produces:
  - `function squaresInOrder(orientation: 'white' | 'black'): Square[]`
  - `interface Highlights { selected?: Square; legal?: Square[]; captures?: Square[]; lastMove?: [Square, Square]; check?: Square }`
  - `<Board position={Position} orientation={'white'|'black'} highlights={Highlights} onSquareClick={(sq: Square) => void} />`

The board is a CSS grid of 64 `<div>`s, each carrying `data-square="e4"`.
That attribute is the stable hook the Playwright tests in Task 19 use, so do
not remove it. A single SVG canvas or a third-party board component would
both have to be fought for the per-square highlight states we need.

- [ ] **Step 1: Download the CC0 piece artwork**

```bash
mkdir -p public/pieces
for f in wK wQ wR wB wN wP bK bQ bR bB bN bP; do
  curl -sfL -o "public/pieces/$f.svg" \
    "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/rhosgfx/$f.svg"
done
ls public/pieces | wc -l   # expect 12
```

All twelve URLs were verified to return HTTP 200. The set is CC0 1.0 per
`lichess-org/lila`'s `COPYING.md`, already credited in `NOTICE.md`.

- [ ] **Step 2: Write the failing test for square ordering**

`src/ui/Board/squares.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { squaresInOrder } from './squares'

describe('squaresInOrder', () => {
  test('white orientation reads a8 first and h1 last', () => {
    const s = squaresInOrder('white')
    expect(s).toHaveLength(64)
    expect(s[0]).toBe('a8')
    expect(s[63]).toBe('h1')
  })

  test('black orientation is the exact reverse', () => {
    expect(squaresInOrder('black')).toEqual([...squaresInOrder('white')].reverse())
  })

  test('every square appears exactly once', () => {
    expect(new Set(squaresInOrder('white')).size).toBe(64)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/ui/Board/squares.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/ui/Board/squares.ts`**

```ts
import type { Square } from '../../game-core/types'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const

/** Reading order for rendering: a8..h8, a7..h7, … h1 for a white view. */
export function squaresInOrder(orientation: 'white' | 'black'): Square[] {
  const out: Square[] = []
  for (const rank of RANKS) {
    for (const file of FILES) {
      out.push(`${file}${rank}` as Square)
    }
  }
  return orientation === 'white' ? out : out.reverse()
}

export function isLightSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number])
  const rank = Number(square[1])
  return (file + rank) % 2 === 0
}
```

- [ ] **Step 5: Run it and watch it pass, then write the Board test**

Run: `npx vitest run src/ui/Board/squares.test.ts` → PASS.

`src/ui/Board/Board.test.tsx`:
```tsx
// NOTE: do not import `screen` here — these tests query via `container`,
// and an unused import fails the project's `noUnusedLocals`.
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Board } from './Board'
import { Position } from '../../game-core/position'

describe('Board', () => {
  test('renders 64 squares and 32 pieces from the start position', () => {
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
    expect(container.querySelectorAll('[data-piece]')).toHaveLength(32)
  })

  test('places the white king on e1 regardless of orientation', () => {
    for (const orientation of ['white', 'black'] as const) {
      const { container, unmount } = render(
        <Board position={new Position()} orientation={orientation} highlights={{}} onSquareClick={vi.fn()} />,
      )
      const e1 = container.querySelector('[data-square="e1"]')
      expect(e1?.querySelector('[data-piece]')?.getAttribute('data-piece')).toBe('wK')
      unmount()
    }
  })

  test('applies highlight classes', () => {
    const { container } = render(
      <Board
        position={new Position()}
        orientation="white"
        highlights={{ selected: 'e2', legal: ['e3', 'e4'], check: 'e1' }}
        onSquareClick={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-square="e2"]')?.className).toContain('selected')
    expect(container.querySelector('[data-square="e4"]')?.className).toContain('legal')
    expect(container.querySelector('[data-square="e1"]')?.className).toContain('check')
  })

  test('coordinates label the two edges nearest the viewer and flip with the board', () => {
    const { container, unmount } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={vi.fn()} />,
    )
    // White view: files along rank 1, ranks up the a-file.
    expect(container.querySelector('[data-square="a1"] .coord.file')).toHaveTextContent('a')
    expect(container.querySelector('[data-square="a1"] .coord.rank')).toHaveTextContent('1')
    expect(container.querySelector('[data-square="h8"] .coord')).toBeNull()
    expect(container.querySelectorAll('.coord.file')).toHaveLength(8)
    expect(container.querySelectorAll('.coord.rank')).toHaveLength(8)
    unmount()

    const flipped = render(
      <Board position={new Position()} orientation="black" highlights={{}} onSquareClick={vi.fn()} />,
    )
    // Black view: files along rank 8, ranks up the h-file.
    expect(flipped.container.querySelector('[data-square="h8"] .coord.file')).toHaveTextContent('h')
    expect(flipped.container.querySelector('[data-square="h8"] .coord.rank')).toHaveTextContent('8')
  })

  test('clicking a square reports it', async () => {
    const onSquareClick = vi.fn()
    const { container } = render(
      <Board position={new Position()} orientation="white" highlights={{}} onSquareClick={onSquareClick} />,
    )
    const e2 = container.querySelector('[data-square="e2"]') as HTMLElement
    e2.click()
    expect(onSquareClick).toHaveBeenCalledWith('e2')
  })
})
```

- [ ] **Step 6: Write the components**

`src/ui/Board/Piece.tsx`:
```tsx
import type { Color, PieceSymbol } from '../../game-core/types'

const LETTER: Record<PieceSymbol, string> = {
  p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
}

export function Piece({ color, type }: { color: Color; type: PieceSymbol }) {
  const code = `${color === 'w' ? 'w' : 'b'}${LETTER[type]}`
  return (
    <img
      className="piece"
      data-piece={code}
      src={`/pieces/${code}.svg`}
      alt=""
      draggable={false}
    />
  )
}
```

`src/ui/Board/Square.tsx`:
```tsx
import type { ReactNode } from 'react'
import type { Square as SquareName } from '../../game-core/types'
import { isLightSquare } from './squares'

export function Square({
  name,
  classes,
  onClick,
  fileLabel,
  rankLabel,
  children,
}: {
  name: SquareName
  classes: string[]
  onClick: (square: SquareName) => void
  /** Shown in the corner of squares along the bottom edge of the view. */
  fileLabel?: string
  /** Shown in the corner of squares along the left edge of the view. */
  rankLabel?: string
  children?: ReactNode
}) {
  const className = [
    'square',
    isLightSquare(name) ? 'light' : 'dark',
    ...classes,
  ].join(' ')
  return (
    <div
      className={className}
      data-square={name}
      role="gridcell"
      aria-label={name}
      onClick={() => onClick(name)}
    >
      {rankLabel ? <span className="coord rank">{rankLabel}</span> : null}
      {fileLabel ? <span className="coord file">{fileLabel}</span> : null}
      {children}
    </div>
  )
}
```

`src/ui/Board/Board.tsx`:
```tsx
import type { Position } from '../../game-core/position'
import type { Color, PieceSymbol, Square as SquareName } from '../../game-core/types'
import { Piece } from './Piece'
import { Square } from './Square'
import { squaresInOrder } from './squares'
import './board.css'

export interface Highlights {
  selected?: SquareName
  legal?: SquareName[]
  captures?: SquareName[]
  lastMove?: [SquareName, SquareName]
  check?: SquareName
}

export function Board({
  position,
  orientation,
  highlights,
  onSquareClick,
}: {
  position: Position
  orientation: 'white' | 'black'
  highlights: Highlights
  onSquareClick: (square: SquareName) => void
}) {
  // board() is rank-8-first; flatten it into a square -> piece lookup.
  const pieces = new Map<SquareName, { color: Color; type: PieceSymbol }>()
  for (const row of position.board()) {
    for (const cell of row) {
      if (cell) pieces.set(cell.square, { color: cell.color, type: cell.type })
    }
  }

  const legal = new Set(highlights.legal ?? [])
  const captures = new Set(highlights.captures ?? [])

  return (
    <div className={`board ${orientation}`} role="grid" aria-label="Chess board">
      {squaresInOrder(orientation).map((name) => {
        const classes: string[] = []
        if (highlights.selected === name) classes.push('selected')
        if (legal.has(name)) classes.push('legal')
        if (captures.has(name)) classes.push('capture')
        if (highlights.lastMove?.includes(name)) classes.push('last-move')
        if (highlights.check === name) classes.push('check')
        const piece = pieces.get(name)
        // Coordinates sit on the two edges nearest the viewer, so they flip
        // with the board: files along the bottom rank, ranks up the left file.
        const file = name[0]
        const rank = name[1]
        const bottomRank = orientation === 'white' ? '1' : '8'
        const leftFile = orientation === 'white' ? 'a' : 'h'
        return (
          <Square
            key={name}
            name={name}
            classes={classes}
            onClick={onSquareClick}
            {...(rank === bottomRank ? { fileLabel: file } : {})}
            {...(file === leftFile ? { rankLabel: rank } : {})}
          >
            {piece ? <Piece color={piece.color} type={piece.type} /> : null}
          </Square>
        )
      })}
    </div>
  )
}
```

`src/ui/Board/board.css`:
```css
.board {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  width: min(80vmin, 640px);
  aspect-ratio: 1;
  border: 2px solid #3a3226;
  user-select: none;
}
.square { position: relative; display: flex; align-items: center; justify-content: center; }
.square.light { background: #f0d9b5; }
.square.dark  { background: #b58863; }
.square.last-move { box-shadow: inset 0 0 0 100vmax rgba(255, 238, 88, 0.35); }
.square.selected  { box-shadow: inset 0 0 0 100vmax rgba(90, 160, 255, 0.40); }
.square.check     { box-shadow: inset 0 0 0 100vmax rgba(220, 60, 60, 0.45); }
.square.legal::after {
  content: ''; position: absolute; width: 28%; aspect-ratio: 1;
  border-radius: 50%; background: rgba(0, 0, 0, 0.25);
}
.square.capture::after {
  content: ''; position: absolute; inset: 6%;
  border-radius: 50%; border: 6px solid rgba(0, 0, 0, 0.25);
}
.piece { width: 92%; height: 92%; pointer-events: none; }
.coord {
  position: absolute; font-size: clamp(8px, 1.6vmin, 12px);
  font-weight: 600; opacity: 0.7; pointer-events: none; line-height: 1;
}
.coord.rank { top: 2px; left: 3px; }
.coord.file { bottom: 2px; right: 3px; }
.square.light .coord { color: #b58863; }
.square.dark .coord { color: #f0d9b5; }
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/ui/Board`
Expected: PASS, 8 tests.

- [ ] **Step 8: Commit**

```bash
git add src/ui/Board public/pieces NOTICE.md
git commit -m "feat(ui): board rendering with CC0 piece artwork and highlight states"
```

---

### Task 7: Move selection state machine

**Files:**
- Create: `src/ui/Board/selection.ts`
- Test: `src/ui/Board/selection.test.ts`

**Interfaces:**
- Consumes: `Position`, `MoveIntent`, `Square` from Task 2.
- Produces:
  - `type SelectionState = { kind: 'idle' } | { kind: 'selected'; square: Square } | { kind: 'awaiting-promotion'; from: Square; to: Square }`
  - `type SelectionEvent = { kind: 'square-clicked'; square: Square } | { kind: 'promotion-chosen'; piece: PieceSymbol } | { kind: 'cancel' }`
  - `type SelectionOutcome = { state: SelectionState; move?: MoveIntent }`
  - `function reduceSelection(state: SelectionState, event: SelectionEvent, position: Position): SelectionOutcome`

All click-to-move logic lives here as a pure reducer, so it is tested
without a DOM. The component in Task 8 only wires events to it.

- [ ] **Step 1: Write the failing test**

`src/ui/Board/selection.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Position } from '../../game-core/position'
import { reduceSelection, type SelectionState } from './selection'

const idle: SelectionState = { kind: 'idle' }

describe('reduceSelection', () => {
  test('clicking own piece selects it', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e2' }, new Position())
    expect(out.state).toEqual({ kind: 'selected', square: 'e2' })
    expect(out.move).toBeUndefined()
  })

  test('clicking an empty square while idle does nothing', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e4' }, new Position())
    expect(out.state).toEqual(idle)
  })

  test('clicking the opponent piece while idle does nothing', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e7' }, new Position())
    expect(out.state).toEqual(idle)
  })

  test('selecting then clicking a legal destination emits the move', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e4' },
      new Position(),
    )
    expect(out.move).toEqual({ from: 'e2', to: 'e4' })
    expect(out.state).toEqual(idle)
  })

  test('clicking the selected square deselects', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e2' },
      new Position(),
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })

  test('clicking another own piece re-selects rather than failing', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'd2' },
      new Position(),
    )
    expect(out.state).toEqual({ kind: 'selected', square: 'd2' })
    expect(out.move).toBeUndefined()
  })

  test('clicking an illegal empty destination deselects without a move', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e5' },
      new Position(),
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })

  test('a promotion destination asks for a piece instead of emitting a move', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'selected', square: 'a7' },
      { kind: 'square-clicked', square: 'a8' },
      pos,
    )
    expect(out.state).toEqual({ kind: 'awaiting-promotion', from: 'a7', to: 'a8' })
    expect(out.move).toBeUndefined()
  })

  test('choosing a promotion piece emits the complete move', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'awaiting-promotion', from: 'a7', to: 'a8' },
      { kind: 'promotion-chosen', piece: 'n' },
      pos,
    )
    expect(out.move).toEqual({ from: 'a7', to: 'a8', promotion: 'n' })
    expect(out.state).toEqual(idle)
  })

  test('cancelling a promotion emits no move at all', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'awaiting-promotion', from: 'a7', to: 'a8' },
      { kind: 'cancel' },
      pos,
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/Board/selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/Board/selection.ts`**

```ts
import type { Position } from '../../game-core/position'
import type { MoveIntent, PieceSymbol, Square } from '../../game-core/types'

export type SelectionState =
  | { kind: 'idle' }
  | { kind: 'selected'; square: Square }
  | { kind: 'awaiting-promotion'; from: Square; to: Square }

export type SelectionEvent =
  | { kind: 'square-clicked'; square: Square }
  | { kind: 'promotion-chosen'; piece: PieceSymbol }
  | { kind: 'cancel' }

export interface SelectionOutcome {
  state: SelectionState
  /** Present only when a complete, legal move has been assembled. */
  move?: MoveIntent
}

const IDLE: SelectionState = { kind: 'idle' }

function holdsOwnPiece(position: Position, square: Square): boolean {
  return position.legalMovesFrom(square).length > 0
}

export function reduceSelection(
  state: SelectionState,
  event: SelectionEvent,
  position: Position,
): SelectionOutcome {
  if (event.kind === 'cancel') return { state: IDLE }

  if (state.kind === 'awaiting-promotion') {
    if (event.kind === 'promotion-chosen') {
      return {
        state: IDLE,
        move: { from: state.from, to: state.to, promotion: event.piece },
      }
    }
    // Any click while the picker is open cancels the whole move.
    return { state: IDLE }
  }

  if (event.kind !== 'square-clicked') return { state }
  const clicked = event.square

  if (state.kind === 'idle') {
    return holdsOwnPiece(position, clicked)
      ? { state: { kind: 'selected', square: clicked } }
      : { state: IDLE }
  }

  // state.kind === 'selected'
  if (clicked === state.square) return { state: IDLE }

  const legal = position.legalMovesFrom(state.square).filter((m) => m.to === clicked)
  if (legal.length === 0) {
    // Re-select if they clicked another of their own pieces; otherwise drop.
    return holdsOwnPiece(position, clicked)
      ? { state: { kind: 'selected', square: clicked } }
      : { state: IDLE }
  }

  if (position.isPromotion(state.square, clicked)) {
    return { state: { kind: 'awaiting-promotion', from: state.square, to: clicked } }
  }

  return { state: IDLE, move: { from: state.square, to: clicked } }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/ui/Board/selection.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Board/selection.ts src/ui/Board/selection.test.ts
git commit -m "feat(ui): pure click-to-move selection reducer"
```

---

### Task 7b: Drag-and-drop input

**Files:**
- Create: `src/ui/Board/useDragMove.ts`
- Modify: `src/ui/Board/Board.tsx` (add drag props), `src/ui/Board/board.css`
- Test: `src/ui/Board/useDragMove.test.ts`

**Interfaces:**
- Consumes: `Position` (Task 2), `MoveIntent`/`Square` (Task 2).
- Produces:
  - `interface DragState { from: Square; x: number; y: number } | null`
  - `function squareFromPoint(x: number, y: number): Square | null`
  - `function useDragMove(opts: { position: Position; enabled: boolean; onDrop: (intent: { from: Square; to: Square }) => void }): { drag: DragState; handlers: { onPointerDown: (e: React.PointerEvent) => void } }`

**Use pointer events, not HTML5 drag-and-drop.** HTML5 `dragstart` is
unreliable on touch devices and cannot be driven from tests; pointer events
give mouse, touch, and pen one code path, and `setPointerCapture` keeps
receiving moves when the cursor leaves the square.

Drag and click-to-move must coexist without fighting. The rule: a pointer
sequence that travels less than a small threshold is a *click* and is left
entirely to the Task 7 reducer; only a sequence that exceeds the threshold
becomes a drag, and a completed drag suppresses the click that would
otherwise follow. Keep the geometry in a pure `squareFromPoint` helper so it
is testable without real pointer events.

- [ ] **Step 1: Write the failing test**

`src/ui/Board/useDragMove.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { exceedsDragThreshold, squareFromElement } from './useDragMove'

describe('exceedsDragThreshold', () => {
  test('a tiny movement is a click, not a drag', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false)
  })

  test('a clear movement is a drag', () => {
    expect(exceedsDragThreshold({ x: 10, y: 10 }, { x: 60, y: 40 })).toBe(true)
  })

  test('the threshold is symmetric in both axes', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 0, y: 30 })).toBe(true)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 30, y: 0 })).toBe(true)
  })
})

describe('squareFromElement', () => {
  test('reads the square name from an element carrying data-square', () => {
    const el = document.createElement('div')
    el.setAttribute('data-square', 'e4')
    expect(squareFromElement(el)).toBe('e4')
  })

  test('finds it on an ancestor when the pointer lands on a piece', () => {
    const square = document.createElement('div')
    square.setAttribute('data-square', 'd5')
    const piece = document.createElement('img')
    square.appendChild(piece)
    expect(squareFromElement(piece)).toBe('d5')
  })

  test('returns null outside the board', () => {
    expect(squareFromElement(document.createElement('div'))).toBeNull()
    expect(squareFromElement(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/Board/useDragMove.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/Board/useDragMove.ts`**

> **The code below is INCOMPLETE and was corrected during implementation.**
> Review found three real defects in it, all in the touch paths that pointer
> events exist to serve. The shipped implementation fixes all three; consult
> `src/ui/Board/useDragMove.ts` in the repository rather than transcribing
> this block verbatim. The defects were:
>
> 1. **No `pointercancel` handler.** A touch interrupted by a system gesture
>    fires `pointercancel` *instead of* `pointerup`, so cleanup never ran: the
>    square stayed faded and the listeners leaked. The next drag stacked a
>    second listener pair on the live first pair, and a later `pointerup`
>    fired both — submitting two moves from one gesture. The fix adds a
>    `pointercancel` handler sharing one `cleanup()` with `up()` (so the paths
>    cannot drift), which removes all three listeners including itself.
> 2. **The suppression flag could strand itself true.** It was set before
>    validating the drop target, but `setPointerCapture` does not redirect the
>    synthesized `click`, which is hit-tested at the release point. Releasing
>    off-board meant no click arrived, the flag was never consumed, and the
>    user's next legitimate click was silently swallowed. The fix sets the
>    flag only when the release landed on a real `[data-square]`, *and* resets
>    it at the start of every `onPointerDown`.
> 3. **No `pointerId` filtering.** Pointer capture only redirects the captured
>    pointer, so a second finger's `pointerup` could complete the first
>    finger's drag onto an unrelated square. The fix captures the initiating
>    `pointerId` and gates all three handlers on it.

```ts
import { useRef, useState } from 'react'
import type { Position } from '../../game-core/position'
import type { Square } from '../../game-core/types'

/** Pixels the pointer must travel before we treat the gesture as a drag. */
const DRAG_THRESHOLD_PX = 6

export interface DragState {
  from: Square
  /** Viewport coordinates of the dragged piece's centre. */
  x: number
  y: number
}

export function exceedsDragThreshold(
  start: { x: number; y: number },
  now: { x: number; y: number },
): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) >= DRAG_THRESHOLD_PX
}

/** Walk up from the event target to the square that owns it. */
export function squareFromElement(el: Element | null): Square | null {
  const found = el?.closest('[data-square]')
  const name = found?.getAttribute('data-square')
  return (name as Square | undefined) ?? null
}

export function useDragMove({
  position,
  enabled,
  onDrop,
}: {
  position: Position
  enabled: boolean
  onDrop: (intent: { from: Square; to: Square }) => void
}): {
  drag: DragState | null
  /** True immediately after a drag, so Board can swallow the trailing click. */
  consumeSuppressedClick: () => boolean
  onPointerDown: (e: React.PointerEvent) => void
} {
  const [drag, setDrag] = useState<DragState | null>(null)
  const suppressClick = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.button !== 0) return
    const from = squareFromElement(e.target as Element)
    if (!from) return
    // Only start a drag from a square that can actually move.
    if (position.legalMovesFrom(from).length === 0) return

    const start = { x: e.clientX, y: e.clientY }
    let dragging = false
    const target = e.currentTarget as Element
    target.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      if (!dragging && exceedsDragThreshold(start, { x: ev.clientX, y: ev.clientY })) {
        dragging = true
      }
      if (dragging) setDrag({ from, x: ev.clientX, y: ev.clientY })
    }

    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId)
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      setDrag(null)
      if (!dragging) return // a plain click: leave it to the selection reducer

      suppressClick.current = true
      const to = squareFromElement(
        document.elementFromPoint(ev.clientX, ev.clientY),
      )
      if (to && to !== from) onDrop({ from, to })
    }

    target.addEventListener('pointermove', move as EventListener)
    target.addEventListener('pointerup', up as EventListener)
  }

  const consumeSuppressedClick = () => {
    const was = suppressClick.current
    suppressClick.current = false
    return was
  }

  return { drag, consumeSuppressedClick, onPointerDown }
}
```

- [ ] **Step 4: Wire it into `Board.tsx`**

Add two optional props to `Board`: `onPointerDown?: (e: React.PointerEvent) => void`
and `dragging?: Square | null`. Put `onPointerDown` on the board container
(one handler for all 64 squares, via the capture walk above), and add the
class `dragging` to the source square so CSS can fade it:

```css
.square.dragging .piece { opacity: 0.35; }
.board { touch-action: none; } /* let us handle touch drags ourselves */
```

`App` owns the hook, passes `onPointerDown` and `dragging` down, and routes
`onDrop` into the same move-submitting path the click reducer uses — a drop
onto a promotion square must raise the same picker, so send it through
`reduceSelection` as a `square-clicked` on the source followed by one on the
destination, rather than calling `play()` directly. That keeps one code path
for promotions instead of two.

`Board`'s `onSquareClick` must call `consumeSuppressedClick()` first and
return early when it is true, so the click ending a drag does not also run
the selection reducer.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/Board`
Expected: PASS — 6 new drag tests plus the existing board and selection tests.

- [ ] **Step 6: Try it by hand**

Run `npm run dev`. Confirm all four: click-to-move still works; dragging a
piece moves it; dragging a pawn to the last rank raises the promotion
picker; and a click that wobbles slightly still registers as a click rather
than dropping the piece back.

- [ ] **Step 7: Commit**

```bash
git add src/ui/Board
git commit -m "feat(ui): pointer-based drag-and-drop alongside click-to-move"
```

---

### Task 8: Promotion picker and the two-player game

**Files:**
- Create: `src/ui/Board/Promotion.tsx`
- Create: `src/ui/panels/Controls.tsx`
- Modify: `src/ui/App.tsx` (replace the placeholder heading entirely)
- Test: `src/ui/App.test.tsx` (rewrite), `src/ui/Board/Promotion.test.tsx`

**Interfaces:**
- Consumes: `Game` (Task 4), `Board`/`Highlights` (Task 6), `reduceSelection` (Task 7).
- Produces: `<Promotion color={Color} onChoose={(p: PieceSymbol) => void} onCancel={() => void} />`, and an `<App />` that plays a complete two-human game.

**Milestone:** at the end of this task the project is a working two-player
chess program with full rules. No engine, no clock UI yet.

- [ ] **Step 1: Write the failing tests**

`src/ui/Board/Promotion.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Promotion } from './Promotion'

describe('Promotion', () => {
  test('offers queen, rook, bishop and knight', () => {
    render(<Promotion color="w" onChoose={vi.fn()} onCancel={vi.fn()} />)
    for (const name of ['Queen', 'Rook', 'Bishop', 'Knight']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  test('choosing reports the piece symbol', () => {
    const onChoose = vi.fn()
    render(<Promotion color="w" onChoose={onChoose} onCancel={vi.fn()} />)
    screen.getByRole('button', { name: 'Knight' }).click()
    expect(onChoose).toHaveBeenCalledWith('n')
  })
})
```

`src/ui/App.test.tsx` (replacing the Task 1 placeholder):
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { App } from './App'

function clickSquare(container: HTMLElement, square: string) {
  const el = container.querySelector(`[data-square="${square}"]`) as HTMLElement
  el.click()
}

describe('App (two-player)', () => {
  test('renders a board', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[data-square]')).toHaveLength(64)
  })

  test('a legal move moves the piece and passes the turn', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull()
    expect(container.querySelector('[data-square="e2"] [data-piece]')).toBeNull()
    expect(screen.getByTestId('turn')).toHaveTextContent(/black/i)
  })

  test('Scholar’s Mate ends the game', () => {
    const { container } = render(<App />)
    const moves: Array<[string, string]> = [
      ['e2', 'e4'], ['e7', 'e5'],
      ['f1', 'c4'], ['b8', 'c6'],
      ['d1', 'h5'], ['g8', 'f6'],
      ['h5', 'f7'],
    ]
    for (const [from, to] of moves) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i)
    expect(screen.getByTestId('result')).toHaveTextContent(/white/i)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui`
Expected: FAIL — `Promotion` module missing, and `App` still renders only a heading.

- [ ] **Step 3: Write `src/ui/Board/Promotion.tsx`**

```tsx
import type { Color, PieceSymbol } from '../../game-core/types'

const CHOICES: Array<{ piece: PieceSymbol; label: string; letter: string }> = [
  { piece: 'q', label: 'Queen', letter: 'Q' },
  { piece: 'r', label: 'Rook', letter: 'R' },
  { piece: 'b', label: 'Bishop', letter: 'B' },
  { piece: 'n', label: 'Knight', letter: 'N' },
]

export function Promotion({
  color,
  onChoose,
  onCancel,
}: {
  color: Color
  onChoose: (piece: PieceSymbol) => void
  onCancel: () => void
}) {
  return (
    <div className="promotion-backdrop" onClick={onCancel} role="presentation">
      <div
        className="promotion"
        role="dialog"
        aria-label="Choose a promotion piece"
        onClick={(e) => e.stopPropagation()}
      >
        {CHOICES.map(({ piece, label, letter }) => (
          <button key={piece} aria-label={label} onClick={() => onChoose(piece)}>
            <img src={`/pieces/${color}${letter}.svg`} alt="" />
          </button>
        ))}
      </div>
    </div>
  )
}
```

Add to `src/ui/Board/board.css`:
```css
.promotion-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.promotion { display: flex; gap: 0.5rem; padding: 1rem; background: #fff; border-radius: 8px; }
.promotion button { width: 72px; height: 72px; cursor: pointer; background: #f0d9b5; border: 2px solid #b58863; border-radius: 6px; }
.promotion img { width: 100%; height: 100%; }
```

- [ ] **Step 4: Write `src/ui/App.tsx`**

```tsx
import { useState } from 'react'
import { Game } from '../game-core/game'
import type { GameStatus, PieceSymbol, Square } from '../game-core/types'
import { Board, type Highlights } from './Board/Board'
import { Promotion } from './Board/Promotion'
import { reduceSelection, type SelectionState } from './Board/selection'

function describeStatus(status: GameStatus): string {
  switch (status.kind) {
    case 'checkmate':
      return `Checkmate — ${status.winner === 'w' ? 'White' : 'Black'} wins`
    case 'draw':
      return {
        stalemate: 'Draw — stalemate',
        'insufficient-material': 'Draw — insufficient material',
        'threefold-repetition': 'Draw — threefold repetition',
        'fifty-move-rule': 'Draw — fifty-move rule',
      }[status.reason]
    case 'in-progress':
      return status.inCheck ? 'Check' : ''
  }
}

export function App() {
  const [game] = useState(() => new Game())
  const [selection, setSelection] = useState<SelectionState>({ kind: 'idle' })
  const [, forceRender] = useState(0)
  const [orientation, setOrientation] = useState<'white' | 'black'>('white')

  const position = game.current()
  const status = game.status()
  const lastMove = game.moves[game.ply - 1]

  const apply = (next: SelectionState, move?: { from: Square; to: Square; promotion?: PieceSymbol }) => {
    setSelection(next)
    if (move) {
      game.play(move)
      forceRender((n) => n + 1)
    }
  }

  const onSquareClick = (square: Square) => {
    const out = reduceSelection(selection, { kind: 'square-clicked', square }, position)
    apply(out.state, out.move)
  }

  const highlights: Highlights = {
    ...(selection.kind === 'selected' ? { selected: selection.square } : {}),
    legal:
      selection.kind === 'selected'
        ? position.legalMovesFrom(selection.square).map((m) => m.to)
        : [],
    ...(lastMove ? { lastMove: [lastMove.from, lastMove.to] as [Square, Square] } : {}),
    ...(status.kind === 'in-progress' && status.inCheck
      ? { check: position.kingSquare(position.turn()) ?? undefined }
      : {}),
  }

  return (
    <main className="app">
      <h1>Chess</h1>
      <p data-testid="turn">{position.turn() === 'w' ? 'White to move' : 'Black to move'}</p>
      <p data-testid="result">{describeStatus(status)}</p>
      <Board
        position={position}
        orientation={orientation}
        highlights={highlights}
        onSquareClick={onSquareClick}
      />
      <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
        Flip board
      </button>
      <button
        onClick={() => {
          game.undo()
          setSelection({ kind: 'idle' })
          forceRender((n) => n + 1)
        }}
      >
        Undo
      </button>
      {selection.kind === 'awaiting-promotion' ? (
        <Promotion
          color={position.turn()}
          onChoose={(piece) => {
            const out = reduceSelection(selection, { kind: 'promotion-chosen', piece }, position)
            apply(out.state, out.move)
          }}
          onCancel={() => setSelection({ kind: 'idle' })}
        />
      ) : null}
    </main>
  )
}
```

The `forceRender` counter is a deliberate, temporary shim: `Game` is a
mutable object, not React state. Task 12 replaces it with a proper
`useSyncExternalStore` subscription to `MatchController`. Leave a comment
saying so, so the next implementer does not mistake it for a pattern to copy.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run`
Expected: PASS, all suites.

- [ ] **Step 6: Play it by hand**

Run: `npm run dev` and open the printed URL. Confirm you can play a full
game with a second person, that promotion offers four pieces, and that the
board flips.

- [ ] **Step 7: Commit**

```bash
git add src/ui
git commit -m "feat(ui): playable two-player game with promotion picker"
```

---

### Task 9: Storage

**Files:**
- Create: `src/storage/storage.ts`
- Test: `src/storage/storage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8` (defined here and imported by `engine/strength.ts` and `match/types.ts`), `loadSettings()`, `saveSettings(s)`, `loadScore()`, `saveScore(s)`, `loadInProgress()`, `saveInProgress(pgn)`, `clearInProgress()`, `DEFAULT_SETTINGS`, and the types `Settings` and `MatchScore`.

Every read is defensive. A user carrying stale or corrupt `localStorage`
from an earlier version must get defaults, never a white screen, and a
quota-exceeded write must not throw.

- [ ] **Step 1: Write the failing test**

`src/storage/storage.test.ts`:
```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS, loadScore, loadSettings, saveScore, saveSettings,
} from './storage'

beforeEach(() => localStorage.clear())

describe('storage', () => {
  test('missing settings fall back to defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('settings round-trip', () => {
    saveSettings({ ...DEFAULT_SETTINGS, level: 5, orientation: 'black' })
    expect(loadSettings().level).toBe(5)
    expect(loadSettings().orientation).toBe('black')
  })

  test('malformed JSON falls back to defaults', () => {
    localStorage.setItem('chess-game:settings', '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('a value of the wrong shape falls back to defaults', () => {
    localStorage.setItem('chess-game:settings', '"a string"')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('an out-of-range level falls back to the default level', () => {
    localStorage.setItem('chess-game:settings', JSON.stringify({ level: 99 }))
    expect(loadSettings().level).toBe(DEFAULT_SETTINGS.level)
  })

  test('a failing write does not throw', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow()
    spy.mockRestore()
  })

  test('score round-trips and defaults to zeroes', () => {
    expect(loadScore()).toEqual({ wins: 0, losses: 0, draws: 0 })
    saveScore({ wins: 2, losses: 1, draws: 3 })
    expect(loadScore()).toEqual({ wins: 2, losses: 1, draws: 3 })
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/storage`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/storage/storage.ts`**

```ts
export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Settings {
  level: Level
  timeControlId: string
  orientation: 'white' | 'black'
  soundEnabled: boolean
  themeId: string
}

export interface MatchScore {
  wins: number
  losses: number
  draws: number
}

export const DEFAULT_SETTINGS: Settings = {
  level: 3,
  timeControlId: 'untimed',
  orientation: 'white',
  soundEnabled: true,
  themeId: 'classic',
}

const KEYS = {
  settings: 'chess-game:settings',
  score: 'chess-game:score',
  inProgress: 'chess-game:in-progress',
} as const

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is acceptable;
    // crashing the game is not.
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function loadSettings(): Settings {
  const raw = readJson(KEYS.settings)
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS }
  const level = raw['level']
  const orientation = raw['orientation']
  return {
    level:
      typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 8
        ? (level as Level)
        : DEFAULT_SETTINGS.level,
    timeControlId:
      typeof raw['timeControlId'] === 'string'
        ? raw['timeControlId']
        : DEFAULT_SETTINGS.timeControlId,
    orientation:
      orientation === 'white' || orientation === 'black'
        ? orientation
        : DEFAULT_SETTINGS.orientation,
    soundEnabled:
      typeof raw['soundEnabled'] === 'boolean'
        ? raw['soundEnabled']
        : DEFAULT_SETTINGS.soundEnabled,
    themeId: typeof raw['themeId'] === 'string' ? raw['themeId'] : DEFAULT_SETTINGS.themeId,
  }
}

export function saveSettings(s: Settings): void {
  writeJson(KEYS.settings, s)
}

export function loadScore(): MatchScore {
  const raw = readJson(KEYS.score)
  if (!isRecord(raw)) return { wins: 0, losses: 0, draws: 0 }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return { wins: num(raw['wins']), losses: num(raw['losses']), draws: num(raw['draws']) }
}

export function saveScore(s: MatchScore): void {
  writeJson(KEYS.score, s)
}

export function loadInProgress(): string | null {
  const raw = readJson(KEYS.inProgress)
  return typeof raw === 'string' ? raw : null
}

export function saveInProgress(pgn: string): void {
  writeJson(KEYS.inProgress, pgn)
}

export function clearInProgress(): void {
  try {
    localStorage.removeItem(KEYS.inProgress)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run it and watch it pass, then commit**

Run: `npx vitest run src/storage` → PASS, 7 tests.

```bash
git add src/storage
git commit -m "feat(storage): defensive localStorage for settings and score"
```

---

### Task 10: Engine strength ladder

**Files:**
- Create: `src/engine/strength.ts`
- Test: `src/engine/strength.test.ts`

**Interfaces:**
- Consumes: `Level` from `src/storage/storage.ts` (Task 9).
- Produces:
  - `interface StrengthProfile { level: Level; label: string; skillLevel: number; uciElo: number | null; depth: number; moveTimeMs: number; blunderChance: number; blunderPool: number }`
  - `function profileFor(level: Level): StrengthProfile`
  - `const LEVELS: readonly StrengthProfile[]`

**The constraint that shapes this table:** Stockfish's calibrated
`UCI_Elo` option has a **minimum of 1320**. That is already a decent club
player and far too strong for a beginner, so the bottom three levels cannot
use it. They instead run `Skill Level` at its floor with a shallow depth and
a deliberate blunder rate. Levels 4–8 use `UCI_LimitStrength` +
`UCI_Elo`, which *is* calibrated against CCRL ratings and is the honest way
to offer "about 1800".

**Why blunders are injected rather than relying on depth alone:** a
depth-limited Stockfish still plays far above a beginner and never errs in a
human-looking way. When the blunder roll fires we ask for `MultiPV` and play
a move from the *lower* end of the engine's own ranked list — a plausible
inaccuracy — rather than a uniformly random legal move, which would hang the
queen on move three and feel absurd.

- [ ] **Step 1: Write the failing test**

`src/engine/strength.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { LEVELS, profileFor } from './strength'
import type { Level } from '../storage/storage'

const ALL: Level[] = [1, 2, 3, 4, 5, 6, 7, 8]

describe('strength ladder', () => {
  test('there are exactly eight levels', () => {
    expect(LEVELS).toHaveLength(8)
  })

  test('every level has a non-empty label', () => {
    for (const l of ALL) expect(profileFor(l).label.length).toBeGreaterThan(0)
  })

  test('the top level is full strength with no blunders', () => {
    const top = profileFor(8)
    expect(top.blunderChance).toBe(0)
    expect(top.skillLevel).toBe(20)
  })

  test('difficulty is monotonic: depth never decreases', () => {
    for (let i = 1; i < ALL.length; i++) {
      expect(profileFor(ALL[i]!).depth).toBeGreaterThanOrEqual(profileFor(ALL[i - 1]!).depth)
    }
  })

  test('blunder chance never increases as the level rises', () => {
    for (let i = 1; i < ALL.length; i++) {
      expect(profileFor(ALL[i]!).blunderChance).toBeLessThanOrEqual(
        profileFor(ALL[i - 1]!).blunderChance,
      )
    }
  })

  test('levels below 4 do not use UCI_Elo, because its floor is 1320', () => {
    for (const l of [1, 2, 3] as Level[]) expect(profileFor(l).uciElo).toBeNull()
  })

  test('levels 4 and up use UCI_Elo within the engine’s supported range', () => {
    for (const l of [4, 5, 6, 7, 8] as Level[]) {
      const elo = profileFor(l).uciElo
      if (elo !== null) {
        expect(elo).toBeGreaterThanOrEqual(1320)
        expect(elo).toBeLessThanOrEqual(3190)
      }
    }
  })

  test('a level that blunders has a pool to blunder from', () => {
    for (const l of ALL) {
      const p = profileFor(l)
      if (p.blunderChance > 0) expect(p.blunderPool).toBeGreaterThan(1)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/strength.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/engine/strength.ts`**

```ts
import type { Level } from '../storage/storage'

export interface StrengthProfile {
  level: Level
  label: string
  /** Stockfish "Skill Level" option, 0-20. */
  skillLevel: number
  /**
   * Stockfish "UCI_Elo", 1320-3190, or null to use Skill Level instead.
   * Null below level 4: UCI_Elo cannot go under 1320, which is already far
   * too strong for a beginner.
   */
  uciElo: number | null
  depth: number
  moveTimeMs: number
  /** Probability of playing a deliberately weaker move. */
  blunderChance: number
  /** MultiPV width to choose the weaker move from. */
  blunderPool: number
}

export const LEVELS: readonly StrengthProfile[] = [
  { level: 1, label: 'Beginner',      skillLevel: 0,  uciElo: null, depth: 1,  moveTimeMs: 50,   blunderChance: 0.55, blunderPool: 6 },
  { level: 2, label: 'Casual',        skillLevel: 1,  uciElo: null, depth: 2,  moveTimeMs: 100,  blunderChance: 0.40, blunderPool: 5 },
  { level: 3, label: 'Improving',     skillLevel: 3,  uciElo: null, depth: 3,  moveTimeMs: 150,  blunderChance: 0.28, blunderPool: 4 },
  { level: 4, label: 'Club (~1500)',  skillLevel: 6,  uciElo: 1500, depth: 5,  moveTimeMs: 250,  blunderChance: 0.15, blunderPool: 3 },
  { level: 5, label: 'Strong club (~1800)', skillLevel: 10, uciElo: 1800, depth: 8,  moveTimeMs: 400,  blunderChance: 0.07, blunderPool: 3 },
  { level: 6, label: 'Expert (~2100)',      skillLevel: 14, uciElo: 2100, depth: 12, moveTimeMs: 700,  blunderChance: 0.03, blunderPool: 2 },
  { level: 7, label: 'Master (~2400)',      skillLevel: 18, uciElo: 2400, depth: 16, moveTimeMs: 1200, blunderChance: 0.01, blunderPool: 2 },
  { level: 8, label: 'Full strength',       skillLevel: 20, uciElo: null, depth: 22, moveTimeMs: 2000, blunderChance: 0,    blunderPool: 1 },
]

export function profileFor(level: Level): StrengthProfile {
  const found = LEVELS.find((p) => p.level === level)
  if (!found) throw new Error(`unknown level: ${level}`)
  return found
}
```

Note level 8 sets `uciElo: null` deliberately: limiting strength at all
would cap the engine below its ceiling, and "full strength" should mean
exactly that.

- [ ] **Step 4: Run it and watch it pass, then commit**

Run: `npx vitest run src/engine/strength.test.ts` → PASS, 8 tests.

```bash
git add src/engine/strength.ts src/engine/strength.test.ts
git commit -m "feat(engine): eight-level strength ladder with blunder injection"
```

---

### Task 11: UCI parsing

**Files:**
- Create: `src/engine/uci.ts`
- Test: `src/engine/uci.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface EngineInfo { depth?: number; multipv?: number; scoreCp?: number; scoreMate?: number; nodes?: number; timeMs?: number; pv: string[] }`
  - `function parseInfo(line: string): EngineInfo | null`
  - `function parseBestMove(line: string): { best: string; ponder?: string } | null`
  - `function isCriticalError(line: string): boolean`
  - `function uciToIntent(uci: string): MoveIntent | null`

Pure string handling, so it is fully testable with no worker. The sample
lines below are copied from the official Stockfish UCI documentation.

- [ ] **Step 1: Write the failing test**

`src/engine/uci.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { isCriticalError, parseBestMove, parseInfo, uciToIntent } from './uci'

describe('uciToIntent', () => {
  test('parses a plain move', () => {
    expect(uciToIntent('e2e4')).toEqual({ from: 'e2', to: 'e4' })
  })

  test('parses a promotion', () => {
    expect(uciToIntent('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' })
  })

  test('rejects the engine’s "no move" marker and short strings', () => {
    expect(uciToIntent('(none)')).toBeNull()
    expect(uciToIntent('e2')).toBeNull()
  })
})

describe('parseBestMove', () => {
  test('parses a bestmove with a ponder move', () => {
    expect(parseBestMove('bestmove e2e4 ponder d7d6')).toEqual({
      best: 'e2e4', ponder: 'd7d6',
    })
  })

  test('parses a bestmove without a ponder move', () => {
    expect(parseBestMove('bestmove g1f3')).toEqual({ best: 'g1f3' })
  })

  test('parses a promotion bestmove', () => {
    expect(parseBestMove('bestmove e7e8q')).toEqual({ best: 'e7e8q' })
  })

  test('returns null for any other line', () => {
    expect(parseBestMove('info depth 1 score cp 17 pv e2e4')).toBeNull()
  })
})

describe('parseInfo', () => {
  test('parses a centipawn line', () => {
    const line =
      'info depth 4 seldepth 7 multipv 1 score cp 39 nodes 512 nps 128000 hashfull 0 tbhits 0 time 4 pv g1f3 d7d5 d2d4'
    expect(parseInfo(line)).toEqual({
      depth: 4, multipv: 1, scoreCp: 39, nodes: 512, timeMs: 4,
      pv: ['g1f3', 'd7d5', 'd2d4'],
    })
  })

  test('parses a mate line', () => {
    const line =
      'info depth 1 seldepth 1 multipv 1 score mate 1 nodes 31 nps 10333 hashfull 0 tbhits 0 time 3 pv d8h4'
    const info = parseInfo(line)
    expect(info?.scoreMate).toBe(1)
    expect(info?.scoreCp).toBeUndefined()
    expect(info?.pv).toEqual(['d8h4'])
  })

  test('parses a negative mate score', () => {
    expect(parseInfo('info depth 3 score mate -2 pv a1a2')?.scoreMate).toBe(-2)
  })

  test('returns null for a line with no principal variation', () => {
    expect(parseInfo('info string NNUE evaluation using nn-abc.nnue')).toBeNull()
  })

  test('returns null for non-info lines', () => {
    expect(parseInfo('bestmove e2e4')).toBeNull()
  })
})

describe('isCriticalError', () => {
  test('detects the fatal engine error line', () => {
    expect(isCriticalError('info string CRITICAL ERROR: illegal move in position')).toBe(true)
  })

  test('ordinary info strings are not errors', () => {
    expect(isCriticalError('info string NNUE evaluation using nn-abc.nnue')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/uci.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/engine/uci.ts`**

```ts
import type { MoveIntent } from '../game-core/types'

export interface EngineInfo {
  depth?: number
  multipv?: number
  /** Centipawns, from the side-to-move's perspective. */
  scoreCp?: number
  /** Signed moves to mate; negative means the engine is being mated. */
  scoreMate?: number
  nodes?: number
  timeMs?: number
  pv: string[]
}

function firstNumber(line: string, re: RegExp): number | undefined {
  const m = line.match(re)
  return m?.[1] === undefined ? undefined : Number(m[1])
}

/**
 * Parse an `info` line. Returns null unless the line carries a principal
 * variation, since those are the only ones we act on.
 *
 * `pv` is always the final field and runs to end of line, so it must be
 * matched with a trailing pattern rather than a token count.
 */
export function parseInfo(line: string): EngineInfo | null {
  if (!line.startsWith('info ')) return null
  const pvMatch = line.match(/\bpv (.+)$/)
  if (!pvMatch?.[1]) return null

  const info: EngineInfo = { pv: pvMatch[1].trim().split(/\s+/) }
  const depth = firstNumber(line, /\bdepth (\d+)/)
  const multipv = firstNumber(line, /\bmultipv (\d+)/)
  const nodes = firstNumber(line, /\bnodes (\d+)/)
  const timeMs = firstNumber(line, /\btime (\d+)/)
  const scoreCp = firstNumber(line, /\bscore cp (-?\d+)/)
  const scoreMate = firstNumber(line, /\bscore mate (-?\d+)/)

  if (depth !== undefined) info.depth = depth
  if (multipv !== undefined) info.multipv = multipv
  if (nodes !== undefined) info.nodes = nodes
  if (timeMs !== undefined) info.timeMs = timeMs
  if (scoreCp !== undefined) info.scoreCp = scoreCp
  if (scoreMate !== undefined) info.scoreMate = scoreMate
  return info
}

export function parseBestMove(line: string): { best: string; ponder?: string } | null {
  if (!line.startsWith('bestmove')) return null
  const parts = line.trim().split(/\s+/)
  const best = parts[1]
  if (!best) return null
  const ponderIndex = parts.indexOf('ponder')
  const ponder = ponderIndex >= 0 ? parts[ponderIndex + 1] : undefined
  return ponder ? { best, ponder } : { best }
}

/**
 * Stockfish 19 terminates its own process on a malformed FEN or an illegal
 * move in a `position ... moves` list, announcing it on this line first.
 * If we ever see it the worker is dead and must be recreated.
 */
export function isCriticalError(line: string): boolean {
  return line.includes('CRITICAL ERROR')
}

/**
 * Convert UCI long algebraic notation into a MoveIntent.
 * "e2e4" -> { from: 'e2', to: 'e4' }; "e7e8q" adds promotion: 'q'.
 *
 * This lives here rather than in the controller because it is UCI notation
 * handling, and both the controller and the hint coach need it.
 */
export function uciToIntent(uci: string): MoveIntent | null {
  if (uci.length < 4 || uci === '(none)') return null
  const from = uci.slice(0, 2)
  const to = uci.slice(2, 4)
  const promo = uci.slice(4, 5)
  return {
    from: from as MoveIntent['from'],
    to: to as MoveIntent['to'],
    ...(promo ? { promotion: promo as MoveIntent['promotion'] } : {}),
  }
}
```

- [ ] **Step 4: Run it and watch it pass, then commit**

Run: `npx vitest run src/engine/uci.test.ts` → PASS, 11 tests.

```bash
git add src/engine/uci.ts src/engine/uci.test.ts
git commit -m "feat(engine): pure UCI info and bestmove parsing"
```

---

### Task 12: Stockfish worker client

**Files:**
- Modify: `package.json` (add `stockfish` dependency and a `postinstall` copy script)
- Create: `scripts/copy-engine.mjs`
- Create: `src/engine/client.ts`
- Test: `src/engine/client.test.ts`

**Interfaces:**
- Consumes: `parseBestMove`, `parseInfo`, `isCriticalError` (Task 11); `StrengthProfile` (Task 10).
- Produces:
  - `interface EngineTransport { post(cmd: string): void; onMessage(cb: (line: string) => void): void; terminate(): void }`
  - `class EngineClient` with `waitReady()`, `configure(profile)`, `newGame()`, `setPosition(fen, moves)`, `search({ depth, moveTimeMs, multiPv })` returning `Promise<SearchResult>`, `stop()`, `dispose()`
  - `interface SearchResult { best: string; lines: EngineInfo[] }`
  - `function createWorkerTransport(url?: string): EngineTransport`

**Build choice, with reasons.** Use the `stockfish` npm package (v19,
actively maintained, GPL-3.0) and ship only its
`stockfish-19-lite-single.js` + `.wasm` pair, about 1.75 MB total. That
build is **single-threaded, so it needs no `SharedArrayBuffer` and therefore
no COOP/COEP headers** — which keeps deployment trivial and avoids COEP
breaking every cross-origin resource the page might later load. The
multi-threaded builds are ~94 MB for the full engine and require
cross-origin isolation; they also hit known `WebAssembly.Memory` failures on
iOS Safari. The lite single build is still vastly stronger than any human.

Two further facts that dictate the code below:
- The shipped file is an **Emscripten glue script, not an ES module**, and it
  locates its `.wasm` relative to its own script URL at runtime. So it must
  be loaded as a **classic** `new Worker(url)` — *not* with Vite's `?worker`
  suffix or `{ type: 'module' }`, both of which rewrite asset references and
  break it. Copy the two files verbatim into `public/engine/`.
- `npm install stockfish` unpacks **~205 MB** into `node_modules` because it
  ships all five build flavours. This is expected, not a fault; budget the
  disk and CI cache.

The client is written against an `EngineTransport` interface so the tests
drive a fake transport and never load Stockfish.

- [ ] **Step 1: Add the dependency and the copy script**

```bash
npm install stockfish
```

`scripts/copy-engine.mjs`:
```js
import { copyFileSync, mkdirSync } from 'node:fs'

const FILES = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

mkdirSync('public/engine', { recursive: true })
for (const f of FILES) {
  copyFileSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`)
  console.log(`copied ${f}`)
}
```

Add to `package.json` scripts:
```json
"postinstall": "node scripts/copy-engine.mjs"
```

Add `public/engine/` to `.gitignore` — it is generated from `node_modules`,
not source.

Run: `node scripts/copy-engine.mjs`
Expected: both files appear in `public/engine/`.

If the filenames differ in the installed version, list
`node_modules/stockfish/bin/` and use the `*-lite-single.*` pair you find;
update `FILES` and the default URL in `client.ts` to match.

- [ ] **Step 2: Write the failing test**

`src/engine/client.test.ts`:
```ts
import { describe, expect, test, vi } from 'vitest'
import { EngineClient, type EngineTransport } from './client'
import { profileFor } from './strength'

/** A transport we drive by hand; no Stockfish involved. */
function fakeTransport() {
  const sent: string[] = []
  let handler: ((line: string) => void) | null = null
  const transport: EngineTransport = {
    post: (cmd) => { sent.push(cmd) },
    onMessage: (cb) => { handler = cb },
    terminate: vi.fn(),
  }
  return {
    transport,
    sent,
    emit: (line: string) => handler?.(line),
  }
}

describe('EngineClient', () => {
  test('handshakes with uci then isready and resolves on readyok', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    expect(f.sent).toContain('uci')
    expect(f.sent).toContain('isready')
    const ready = client.waitReady()
    f.emit('uciok')
    f.emit('readyok')
    await expect(ready).resolves.toBeUndefined()
  })

  test('configure sends Skill Level when the profile has no UCI_Elo', () => {
    const f = fakeTransport()
    new EngineClient(f.transport).configure(profileFor(1))
    expect(f.sent).toContain('setoption name Skill Level value 0')
    expect(f.sent.some((c) => c.includes('UCI_Elo'))).toBe(false)
  })

  test('configure sends UCI_LimitStrength and UCI_Elo when the profile has one', () => {
    const f = fakeTransport()
    new EngineClient(f.transport).configure(profileFor(5))
    expect(f.sent).toContain('setoption name UCI_LimitStrength value true')
    expect(f.sent).toContain('setoption name UCI_Elo value 1800')
  })

  test('setPosition sends a fen with the move list appended', () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    client.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4'])
    expect(f.sent).toContain(
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4',
    )
  })

  test('search resolves with the best move and the collected lines', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    expect(f.sent.some((c) => c.startsWith('go '))).toBe(true)
    f.emit('info depth 4 multipv 1 score cp 39 nodes 512 time 4 pv g1f3 d7d5')
    f.emit('bestmove g1f3 ponder d7d5')
    const result = await pending
    expect(result.best).toBe('g1f3')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.scoreCp).toBe(39)
  })

  test('a search always passes an explicit limit, never a bare go', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    void client.search({ depth: 10, moveTimeMs: 500, multiPv: 1 })
    const go = f.sent.find((c) => c.startsWith('go '))
    expect(go).toMatch(/depth \d+/)
    expect(go).toMatch(/movetime \d+/)
    f.emit('bestmove e2e4')
  })

  test('a CRITICAL ERROR rejects the pending search', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const pending = client.search({ depth: 4, moveTimeMs: 100, multiPv: 1 })
    f.emit('info string CRITICAL ERROR: illegal move')
    await expect(pending).rejects.toThrow(/critical/i)
  })

  test('lines from an earlier search do not leak into the next one', async () => {
    const f = fakeTransport()
    const client = new EngineClient(f.transport)
    const first = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('info depth 2 multipv 1 score cp 10 pv e2e4')
    f.emit('bestmove e2e4')
    await first
    const second = client.search({ depth: 2, moveTimeMs: 50, multiPv: 1 })
    f.emit('bestmove d2d4')
    expect((await second).lines).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/engine/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/engine/client.ts`**

```ts
import type { StrengthProfile } from './strength'
import { isCriticalError, parseBestMove, parseInfo, type EngineInfo } from './uci'

export interface EngineTransport {
  post(cmd: string): void
  onMessage(cb: (line: string) => void): void
  terminate(): void
}

export interface SearchResult {
  best: string
  lines: EngineInfo[]
}

export interface SearchLimits {
  depth: number
  moveTimeMs: number
  multiPv: number
}

const DEFAULT_ENGINE_URL = '/engine/stockfish-19-lite-single.js'

/**
 * Load the Emscripten glue script as a CLASSIC worker. It is not an ES
 * module and finds its .wasm relative to its own URL, so Vite's module
 * worker pipeline must not touch it.
 */
export function createWorkerTransport(url: string = DEFAULT_ENGINE_URL): EngineTransport {
  const worker = new Worker(url)
  return {
    post: (cmd) => worker.postMessage(cmd),
    onMessage: (cb) =>
      worker.addEventListener('message', (e: MessageEvent<string>) => {
        if (typeof e.data === 'string') cb(e.data)
      }),
    terminate: () => worker.terminate(),
  }
}

export class EngineClient {
  private readonly transport: EngineTransport
  private readonly readyPromise: Promise<void>
  private resolveReady: (() => void) | null = null
  private pending: {
    resolve: (r: SearchResult) => void
    reject: (e: Error) => void
    lines: EngineInfo[]
  } | null = null

  constructor(transport: EngineTransport) {
    this.transport = transport
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve
    })
    this.transport.onMessage((line) => this.handle(line))
    this.transport.post('uci')
    this.transport.post('isready')
  }

  private handle(line: string): void {
    if (isCriticalError(line)) {
      const p = this.pending
      this.pending = null
      p?.reject(new Error(`engine critical error: ${line}`))
      return
    }

    if (line === 'readyok') {
      this.resolveReady?.()
      this.resolveReady = null
      return
    }

    const best = parseBestMove(line)
    if (best) {
      const p = this.pending
      this.pending = null
      p?.resolve({ best: best.best, lines: p.lines })
      return
    }

    if (this.pending) {
      const info = parseInfo(line)
      if (info) this.pending.lines.push(info)
    }
  }

  waitReady(): Promise<void> {
    return this.readyPromise
  }

  configure(profile: StrengthProfile): void {
    this.transport.post(`setoption name MultiPV value ${Math.max(1, profile.blunderPool)}`)
    if (profile.uciElo !== null) {
      this.transport.post('setoption name UCI_LimitStrength value true')
      this.transport.post(`setoption name UCI_Elo value ${profile.uciElo}`)
    } else {
      this.transport.post('setoption name UCI_LimitStrength value false')
      this.transport.post(`setoption name Skill Level value ${profile.skillLevel}`)
    }
  }

  newGame(): void {
    this.transport.post('ucinewgame')
    this.transport.post('isready')
  }

  /**
   * The caller must have validated the FEN and the moves already. Stockfish
   * 19 kills its own process on malformed input, which would silently take
   * the worker down mid-game.
   */
  setPosition(fen: string, moves: string[] = []): void {
    const suffix = moves.length > 0 ? ` moves ${moves.join(' ')}` : ''
    this.transport.post(`position fen ${fen}${suffix}`)
  }

  search(limits: SearchLimits): Promise<SearchResult> {
    return new Promise<SearchResult>((resolve, reject) => {
      this.pending = { resolve, reject, lines: [] }
      this.transport.post(`setoption name MultiPV value ${Math.max(1, limits.multiPv)}`)
      // Always pass an explicit limit: a bare `go` defaults to depth 245,
      // which never terminates in practice.
      this.transport.post(`go depth ${limits.depth} movetime ${limits.moveTimeMs}`)
    })
  }

  stop(): void {
    this.transport.post('stop')
  }

  dispose(): void {
    this.pending?.reject(new Error('engine disposed'))
    this.pending = null
    this.transport.post('quit')
    this.transport.terminate()
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/engine/client.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Smoke-test the real engine in the browser**

Temporarily add to `src/ui/App.tsx`, run `npm run dev`, and check the console:

```ts
import { EngineClient, createWorkerTransport } from '../engine/client'
import { profileFor } from '../engine/strength'
import { STARTING_FEN } from '../game-core/types'

// TEMPORARY smoke test — remove before committing.
void (async () => {
  const e = new EngineClient(createWorkerTransport())
  await e.waitReady()
  e.configure(profileFor(8))
  e.setPosition(STARTING_FEN, [])
  console.log(await e.search({ depth: 8, moveTimeMs: 300, multiPv: 1 }))
})()
```

Expected: an object with `best` set to a plausible first move such as
`e2e4` or `d2d4`, within a second or two. Then **delete the snippet**.

If the worker 404s, check that `public/engine/` holds both files and that
the filename in `DEFAULT_ENGINE_URL` matches exactly.

- [ ] **Step 7: Commit**

```bash
git add src/engine/client.ts src/engine/client.test.ts scripts package.json .gitignore
git commit -m "feat(engine): Stockfish worker client over a testable transport"
```

---

### Task 13: Match controller

**Files:**
- Create: `src/match/types.ts`, `src/match/controller.ts`
- Test: `src/match/controller.test.ts`

**Interfaces:**
- Consumes: `Game` (Task 4), `Clock`/`TimeControl` (Task 5), `EngineClient` (Task 12), `profileFor`/`StrengthProfile` (Task 10), `Level` (Task 9).
- Produces:
  - `type Seat = { kind: 'human' } | { kind: 'engine'; level: Level }`
  - `interface MatchConfig { white: Seat; black: Seat; timeControl: TimeControl; startFen?: string; engineDelayMs?: number }`
  - `type MatchPhase = { kind: 'idle' } | { kind: 'awaiting-human'; side: Color } | { kind: 'engine-thinking'; side: Color; requestId: number } | { kind: 'paused' } | { kind: 'finished'; status: GameStatus; reason: 'normal' | 'flag' | 'resign' | 'engine-error' }`
  - `interface MatchSnapshot { phase: MatchPhase; game: Game; clock: ClockState; config: MatchConfig }`
  - `class MatchController` with `start(config)`, `submitHumanMove(intent)`, `pause()`, `resume()`, `step()`, `setSpeed(ms)`, `undo()`, `resign(side)`, `subscribe(cb)`, `dispose()`

This is the piece most likely to become tangled, so two rules govern it.

**Rule 1 — every engine request carries a monotonically increasing
`requestId`.** A reply is applied only if its id matches the current phase.
Starting a new game, undoing, or changing mode increments the id, which
invalidates anything still in flight. This single mechanism is the entire
defence against an engine move arriving for a game that no longer exists.

**Rule 2 — only the controller ends a game.** The clock reports a flag and
the position reports checkmate or a draw; the controller alone transitions
to `finished`. Nothing else may.

- [ ] **Step 1: Write the failing test**

`src/match/controller.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController } from './controller'
import type { MatchConfig } from './types'

/** An engine we resolve by hand, so no Stockfish and no waiting. */
function fakeEngine() {
  const calls: Array<{ resolve: (best: string) => void; reject: (e: Error) => void }> = []
  return {
    calls,
    client: {
      waitReady: () => Promise.resolve(),
      configure: vi.fn(),
      newGame: vi.fn(),
      setPosition: vi.fn(),
      search: () =>
        new Promise<{ best: string; lines: [] }>((resolve, reject) => {
          calls.push({
            resolve: (best) => resolve({ best, lines: [] }),
            reject,
          })
        }),
      stop: vi.fn(),
      dispose: vi.fn(),
    },
  }
}

const HUMAN_VS_ENGINE: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'engine', level: 4 },
  timeControl: { kind: 'untimed' },
  engineDelayMs: 0,
}

describe('MatchController', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a human move is applied and the engine is asked to reply', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })

    expect(c.submitHumanMove({ from: 'e2', to: 'e4' }).ok).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().phase.kind).toBe('engine-thinking')

    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a stale engine reply is ignored after a new game starts', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)

    c.start(HUMAN_VS_ENGINE) // new game while the engine is thinking
    e.calls[0]?.resolve('e7e5') // the old reply lands late
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('a human move is refused while the engine is thinking', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    expect(c.submitHumanMove({ from: 'd2', to: 'd4' }).ok).toBe(false)
  })

  test('undo in one-player mode takes back both plies', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e7e5')
    await vi.advanceTimersByTimeAsync(0)

    c.undo()
    expect(c.snapshot().game.moves).toHaveLength(0)
    expect(c.snapshot().phase).toEqual({ kind: 'awaiting-human', side: 'w' })
  })

  test('running out of time finishes the game as a flag loss', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      ...HUMAN_VS_ENGINE,
      timeControl: { kind: 'timed', initialMs: 1_000, incrementMs: 0 },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('flag')
  })

  test('checkmate finishes the game normally', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'human' },
      black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
      startFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    })
    c.submitHumanMove({ from: 'f3', to: 'f7' })
    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') {
      expect(phase.reason).toBe('normal')
      expect(phase.status).toEqual({ kind: 'checkmate', winner: 'w' })
    }
  })

  test('step plays exactly one engine move, then re-pauses', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start({
      white: { kind: 'engine', level: 1 },
      black: { kind: 'engine', level: 1 },
      timeControl: { kind: 'untimed' },
      engineDelayMs: 0,
    })
    c.pause()
    expect(c.snapshot().phase.kind).toBe('paused')

    c.step()
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('e2e4')
    await vi.advanceTimersByTimeAsync(0)

    expect(c.snapshot().game.moves).toHaveLength(1)
    expect(c.snapshot().phase.kind).toBe('paused')
  })

  test('two illegal engine moves finish the game as an engine error', async () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    c.start(HUMAN_VS_ENGINE)
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    await vi.advanceTimersByTimeAsync(0)
    e.calls[0]?.resolve('a1a8') // illegal
    await vi.advanceTimersByTimeAsync(0)
    e.calls[1]?.resolve('a1a8') // illegal again
    await vi.advanceTimersByTimeAsync(0)

    const phase = c.snapshot().phase
    expect(phase.kind).toBe('finished')
    if (phase.kind === 'finished') expect(phase.reason).toBe('engine-error')
    // The position must survive intact for export.
    expect(c.snapshot().game.moves.map((m) => m.san)).toEqual(['e4'])
  })

  test('subscribers are notified on every change', () => {
    const e = fakeEngine()
    const c = new MatchController({ engine: e.client })
    const seen = vi.fn()
    c.subscribe(seen)
    c.start({
      white: { kind: 'human' }, black: { kind: 'human' },
      timeControl: { kind: 'untimed' },
    })
    c.submitHumanMove({ from: 'e2', to: 'e4' })
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/match`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/match/types.ts`**

```ts
import type { ClockState, TimeControl } from '../clock/types'
import type { Game } from '../game-core/game'
import type { Color, GameStatus } from '../game-core/types'
import type { Level } from '../storage/storage'

export type Seat = { kind: 'human' } | { kind: 'engine'; level: Level }

export interface MatchConfig {
  white: Seat
  black: Seat
  timeControl: TimeControl
  startFen?: string
  /** Pause between engine moves in a zero-player game (the speed slider). */
  engineDelayMs?: number
}

export type FinishReason = 'normal' | 'flag' | 'resign' | 'engine-error'

export type MatchPhase =
  | { kind: 'idle' }
  | { kind: 'awaiting-human'; side: Color }
  | { kind: 'engine-thinking'; side: Color; requestId: number }
  | { kind: 'paused' }
  | { kind: 'finished'; status: GameStatus; reason: FinishReason }

export interface MatchSnapshot {
  phase: MatchPhase
  game: Game
  clock: ClockState
  config: MatchConfig
}
```

- [ ] **Step 4: Write `src/match/controller.ts`**

```ts
import { Clock } from '../clock/clock'
import { Game } from '../game-core/game'
import { uciToIntent } from '../engine/uci'
import type { Color, MoveIntent, MoveResult } from '../game-core/types'
import { profileFor, type StrengthProfile } from '../engine/strength'
import type { Level } from '../storage/storage'
import type { MatchConfig, MatchPhase, MatchSnapshot, Seat } from './types'

/** The subset of EngineClient the controller needs; keeps tests trivial. */
export interface EngineLike {
  waitReady(): Promise<void>
  configure(profile: StrengthProfile): void
  newGame(): void
  setPosition(fen: string, moves: string[]): void
  search(limits: { depth: number; moveTimeMs: number; multiPv: number }): Promise<{
    best: string
    lines: unknown[]
  }>
  stop(): void
  dispose(): void
}

const IDLE_CONFIG: MatchConfig = {
  white: { kind: 'human' },
  black: { kind: 'human' },
  timeControl: { kind: 'untimed' },
}

export class MatchController {
  private readonly engine: EngineLike
  private game = new Game()
  private clock = new Clock({ kind: 'untimed' })
  private config: MatchConfig = IDLE_CONFIG
  private phase: MatchPhase = { kind: 'idle' }
  private requestId = 0
  private listeners: Array<(s: MatchSnapshot) => void> = []
  private illegalEngineMoves = 0
  private steppingWhilePaused = false

  constructor(deps: { engine: EngineLike }) {
    this.engine = deps.engine
  }

  // ---- subscription -----------------------------------------------------

  subscribe(cb: (s: MatchSnapshot) => void): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }

  snapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      game: this.game,
      clock: this.clock.getState(),
      config: this.config,
    }
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
  }

  // ---- lifecycle --------------------------------------------------------

  start(config: MatchConfig): void {
    // Invalidate anything the engine still owes us from a previous game.
    this.requestId++
    this.illegalEngineMoves = 0
    this.steppingWhilePaused = false

    this.clock.dispose()
    this.config = config
    this.game = new Game(config.startFen ? { fen: config.startFen } : undefined)
    this.clock = new Clock(config.timeControl)
    this.clock.onFlag((side) => this.finishOnFlag(side))

    this.engine.newGame()

    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal' }
      this.emit()
      return
    }

    const side = this.game.current().turn()
    this.clock.start(side)
    this.toMoveOf(side)
    this.emit()
  }

  dispose(): void {
    this.requestId++
    this.clock.dispose()
    this.listeners = []
  }

  // ---- turn routing -----------------------------------------------------

  private seatFor(side: Color): Seat {
    return side === 'w' ? this.config.white : this.config.black
  }

  /** Set the phase for whoever must move, and kick the engine if it is theirs. */
  private toMoveOf(side: Color): void {
    const seat = this.seatFor(side)
    if (seat.kind === 'human') {
      this.phase = { kind: 'awaiting-human', side }
      return
    }
    const id = ++this.requestId
    this.phase = { kind: 'engine-thinking', side, requestId: id }
    void this.askEngine(side, seat.level, id)
  }

  private async askEngine(side: Color, level: Level, id: number): Promise<void> {
    const profile = profileFor(level)
    const delay = this.config.engineDelayMs ?? 0
    try {
      await this.engine.waitReady()
      if (id !== this.requestId) return

      this.engine.configure(profile)
      // We pass a validated FEN: Stockfish 19 kills its own worker on bad input.
      this.engine.setPosition(this.game.current().fen(), [])

      const multiPv = profile.blunderChance > 0 ? profile.blunderPool : 1
      const result = await this.engine.search({
        depth: profile.depth,
        moveTimeMs: profile.moveTimeMs,
        multiPv,
      })
      if (id !== this.requestId) return // a stale reply; drop it

      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
        if (id !== this.requestId) return
      }

      this.applyEngineMove(result.best, side, level, id)
    } catch {
      if (id !== this.requestId) return
      this.finish('engine-error')
    }
  }

  private applyEngineMove(uci: string, side: Color, level: Level, id: number): void {
    const intent = uciToIntent(uci)
    const result = intent ? this.game.play(intent) : ({ ok: false } as const)
    if (!result.ok) {
      this.illegalEngineMoves++
      if (this.illegalEngineMoves >= 2) {
        // Spec: halt with the position preserved rather than corrupt it.
        this.finish('engine-error')
        return
      }
      // Ask once more with the same id still current.
      void this.askEngine(side, level, id)
      return
    }
    this.illegalEngineMoves = 0
    this.afterMove()
  }

  // ---- moves ------------------------------------------------------------

  submitHumanMove(intent: MoveIntent): MoveResult {
    if (this.phase.kind !== 'awaiting-human') {
      return { ok: false, reason: 'illegal' }
    }
    const result = this.game.play(intent)
    if (!result.ok) return result
    this.afterMove()
    return result
  }

  /** Shared tail for any applied move: check the result, switch the clock. */
  private afterMove(): void {
    const status = this.game.status()
    if (status.kind !== 'in-progress') {
      this.phase = { kind: 'finished', status, reason: 'normal' }
      this.clock.pause()
      this.emit()
      return
    }

    const next = this.game.current().turn()
    this.clock.switchTo(next)

    if (this.steppingWhilePaused) {
      this.steppingWhilePaused = false
      this.phase = { kind: 'paused' }
      this.clock.pause()
      this.emit()
      return
    }

    this.toMoveOf(next)
    this.emit()
  }

  // ---- ending -----------------------------------------------------------

  private finish(reason: 'engine-error' | 'resign' | 'flag'): void {
    this.requestId++
    this.clock.pause()
    this.phase = { kind: 'finished', status: this.game.status(), reason }
    this.emit()
  }

  private finishOnFlag(side: Color): void {
    this.requestId++
    this.phase = {
      kind: 'finished',
      // A flag is not a rules result, so report the winner explicitly.
      status: { kind: 'checkmate', winner: side === 'w' ? 'b' : 'w' },
      reason: 'flag',
    }
    this.emit()
  }

  resign(side: Color): void {
    this.requestId++
    this.clock.pause()
    this.phase = {
      kind: 'finished',
      status: { kind: 'checkmate', winner: side === 'w' ? 'b' : 'w' },
      reason: 'resign',
    }
    this.emit()
  }

  // ---- controls ---------------------------------------------------------

  pause(): void {
    if (this.phase.kind === 'finished' || this.phase.kind === 'idle') return
    this.requestId++ // drop any in-flight engine reply
    this.clock.pause()
    this.phase = { kind: 'paused' }
    this.emit()
  }

  resume(): void {
    if (this.phase.kind !== 'paused') return
    this.clock.resume()
    this.toMoveOf(this.game.current().turn())
    this.emit()
  }

  /** Allow exactly one engine move, then return to paused. */
  step(): void {
    if (this.phase.kind !== 'paused') return
    this.steppingWhilePaused = true
    this.toMoveOf(this.game.current().turn())
    this.emit()
  }

  setSpeed(delayMs: number): void {
    this.config = { ...this.config, engineDelayMs: delayMs }
    this.emit()
  }

  /**
   * Take back a move. Against an engine this must remove BOTH plies, or the
   * engine instantly replays and the undo appears to do nothing.
   */
  undo(): void {
    this.requestId++
    const opponentIsEngine =
      this.config.white.kind === 'engine' || this.config.black.kind === 'engine'
    const bothEngines =
      this.config.white.kind === 'engine' && this.config.black.kind === 'engine'

    this.game.undo()
    if (opponentIsEngine && !bothEngines) this.game.undo()

    const status = this.game.status()
    if (status.kind === 'in-progress') {
      const side = this.game.current().turn()
      if (bothEngines) {
        this.phase = { kind: 'paused' }
      } else {
        this.toMoveOf(side)
      }
    }
    this.emit()
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/match`
Expected: PASS, 9 tests. These are the tests that protect against the whole
class of async races; if one is flaky, fix the controller, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/match
git commit -m "feat(match): controller with request-id race protection"
```

---

### Task 14: Panel logic — move pairs and material

**Files:**
- Create: `src/ui/panels/movePairs.ts`, `src/ui/panels/material.ts`
- Test: `src/ui/panels/movePairs.test.ts`, `src/ui/panels/material.test.ts`

**Interfaces:**
- Consumes: `PlayedMove`, `PieceSymbol` from Task 2.
- Produces:
  - `interface MovePair { number: number; white?: { san: string; ply: number }; black?: { san: string; ply: number } }`
  - `function toMovePairs(moves: readonly PlayedMove[]): MovePair[]`
  - `function capturedPieces(moves: readonly PlayedMove[]): { w: PieceSymbol[]; b: PieceSymbol[] }`
  - `function materialBalance(captured: { w: PieceSymbol[]; b: PieceSymbol[] }): number`

All panel logic is pure and tested without a DOM; the components in Task 15
only render what these return.

- [ ] **Step 1: Write the failing tests**

`src/ui/panels/movePairs.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { toMovePairs } from './movePairs'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('toMovePairs', () => {
  test('pairs white and black moves with move numbers', () => {
    const pairs = toMovePairs([move('e4', 'w'), move('e5', 'b'), move('Nf3', 'w')])
    expect(pairs).toEqual([
      { number: 1, white: { san: 'e4', ply: 1 }, black: { san: 'e5', ply: 2 } },
      { number: 2, white: { san: 'Nf3', ply: 3 } },
    ])
  })

  test('a game starting with Black leaves the first white slot empty', () => {
    const pairs = toMovePairs([move('e5', 'b'), move('Nf3', 'w')])
    expect(pairs[0]).toEqual({ number: 1, black: { san: 'e5', ply: 1 } })
    expect(pairs[1]).toEqual({ number: 2, white: { san: 'Nf3', ply: 2 } })
  })

  test('an empty game has no pairs', () => {
    expect(toMovePairs([])).toEqual([])
  })
})
```

`src/ui/panels/material.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { capturedPieces, materialBalance } from './material'
import type { PlayedMove } from '../../game-core/types'

const cap = (color: 'w' | 'b', captured: 'p' | 'n' | 'b' | 'r' | 'q'): PlayedMove => ({
  san: 'x', color, from: 'e4', to: 'd5', piece: 'p', captured,
  isCapture: true, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('captured pieces', () => {
  test('groups captures by the capturing side', () => {
    const c = capturedPieces([cap('w', 'p'), cap('b', 'n'), cap('w', 'q')])
    expect(c.w).toEqual(['p', 'q'])
    expect(c.b).toEqual(['n'])
  })

  test('counts an en passant capture', () => {
    const ep: PlayedMove = {
      san: 'exd6', color: 'w', from: 'e5', to: 'd6', piece: 'p', captured: 'p',
      isCapture: true, isCastle: false, isEnPassant: true, fenAfter: '',
    }
    expect(capturedPieces([ep]).w).toEqual(['p'])
  })

  test('a promotion does not add a captured piece', () => {
    const promo: PlayedMove = {
      san: 'a8=Q', color: 'w', from: 'a7', to: 'a8', piece: 'p', promotion: 'q',
      isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
    }
    expect(capturedPieces([promo])).toEqual({ w: [], b: [] })
  })
})

describe('materialBalance', () => {
  test('is zero when both sides have taken the same value', () => {
    expect(materialBalance({ w: ['n'], b: ['b'] })).toBe(0)
  })

  test('is positive when White is ahead', () => {
    expect(materialBalance({ w: ['q'], b: ['p'] })).toBe(8)
  })

  test('is negative when Black is ahead', () => {
    expect(materialBalance({ w: [], b: ['r'] })).toBe(-5)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/ui/panels`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the modules**

`src/ui/panels/movePairs.ts`:
```ts
import type { PlayedMove } from '../../game-core/types'

export interface MovePair {
  number: number
  white?: { san: string; ply: number }
  black?: { san: string; ply: number }
}

/**
 * Group the move list into numbered pairs for display.
 *
 * A game loaded from a FEN with Black to move produces a first pair with an
 * empty white slot, which renders as "1... e5". No `startTurn` argument is
 * needed: the first move's own colour already carries that information.
 */
export function toMovePairs(moves: readonly PlayedMove[]): MovePair[] {
  const pairs: MovePair[] = []
  let current: MovePair | null = null
  let number = 1

  moves.forEach((m, index) => {
    const ply = index + 1
    const entry = { san: m.san, ply }
    if (m.color === 'w') {
      current = { number, white: entry }
      pairs.push(current)
      return
    }
    if (current && current.black === undefined) {
      current.black = entry
      number++
      current = null
      return
    }
    // A black move with no white move before it: the game opened with Black.
    current = { number, black: entry }
    pairs.push(current)
    number++
    current = null
  })

  return pairs
}
```

`src/ui/panels/material.ts`:
```ts
import type { PieceSymbol, PlayedMove } from '../../game-core/types'

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function capturedPieces(moves: readonly PlayedMove[]): {
  w: PieceSymbol[]
  b: PieceSymbol[]
} {
  const out: { w: PieceSymbol[]; b: PieceSymbol[] } = { w: [], b: [] }
  for (const m of moves) {
    if (m.captured) out[m.color].push(m.captured)
  }
  return out
}

/** Positive favours White. */
export function materialBalance(captured: {
  w: PieceSymbol[]
  b: PieceSymbol[]
}): number {
  const sum = (ps: PieceSymbol[]) => ps.reduce((t, p) => t + VALUE[p], 0)
  return sum(captured.w) - sum(captured.b)
}
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/ui/panels` → PASS, 9 tests.

```bash
git add src/ui/panels
git commit -m "feat(ui): pure move-pair and material calculations"
```

---

### Task 15: PGN and FEN import/export

**Files:**
- Create: `src/game-core/io.ts`
- Test: `src/game-core/io.test.ts`

**Interfaces:**
- Consumes: `Game` (Task 4), `Position` (Task 2), `chess.js`.
- Produces:
  - `interface PgnHeaders { Event?: string; Site?: string; Date?: string; White?: string; Black?: string; Result?: string; TimeControl?: string }`
  - `function exportPgn(game: Game, headers?: PgnHeaders): string`
  - `function importPgn(text: string): { ok: true; game: Game } | { ok: false; error: string }`
  - `function importFen(text: string): { ok: true; game: Game } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

`src/game-core/io.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { Game } from './game'
import { exportPgn, importFen, importPgn } from './io'

function playedGame(): Game {
  const g = new Game()
  g.play({ from: 'e2', to: 'e4' })
  g.play({ from: 'e7', to: 'e5' })
  g.play({ from: 'g1', to: 'f3' })
  return g
}

describe('PGN', () => {
  test('export includes the moves', () => {
    const pgn = exportPgn(playedGame())
    expect(pgn).toContain('1. e4 e5')
    expect(pgn).toContain('Nf3')
  })

  test('export includes the headers we set', () => {
    const pgn = exportPgn(playedGame(), { White: 'Alice', Black: 'Stockfish' })
    expect(pgn).toContain('[White "Alice"]')
    expect(pgn).toContain('[Black "Stockfish"]')
  })

  test('a game round-trips through export and import', () => {
    const before = playedGame()
    const result = importPgn(exportPgn(before))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.game.moves.map((m) => m.san)).toEqual(
      before.moves.map((m) => m.san),
    )
  })

  test('a malformed PGN reports an error and does not throw', () => {
    const result = importPgn('1. e4 e5 2. Qxz9 ??')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error.length).toBeGreaterThan(0)
  })

  test('empty input is an error, not an empty game', () => {
    expect(importPgn('   ').ok).toBe(false)
  })
})

describe('FEN', () => {
  test('a valid FEN loads', () => {
    const r = importFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.game.current().turn()).toBe('w')
  })

  test('a malformed FEN reports an error', () => {
    const r = importFen('this is not a fen')
    expect(r.ok).toBe(false)
  })

  test('a FEN with too few ranks reports an error', () => {
    expect(importFen('8/8/8 w - - 0 1').ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/game-core/io.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/game-core/io.ts`**

```ts
import { Chess } from 'chess.js'
import { Game } from './game'
import { STARTING_FEN } from './types'

export interface PgnHeaders {
  Event?: string
  Site?: string
  Date?: string
  Round?: string
  White?: string
  Black?: string
  Result?: string
  TimeControl?: string
}

function todayPgnDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`
}

function resultTag(game: Game): string {
  const status = game.status()
  if (status.kind === 'checkmate') return status.winner === 'w' ? '1-0' : '0-1'
  if (status.kind === 'draw') return '1/2-1/2'
  return '*'
}

export function exportPgn(game: Game, headers: PgnHeaders = {}): string {
  const chess = new Chess(game.startFen)
  for (const m of game.moves) {
    chess.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) })
  }

  const all: Record<string, string> = {
    Event: headers.Event ?? 'Casual game',
    Site: headers.Site ?? 'Local',
    Date: headers.Date ?? todayPgnDate(),
    Round: headers.Round ?? '-',
    White: headers.White ?? 'White',
    Black: headers.Black ?? 'Black',
    Result: headers.Result ?? resultTag(game),
  }
  if (headers.TimeControl) all['TimeControl'] = headers.TimeControl
  if (game.startFen !== STARTING_FEN) {
    all['SetUp'] = '1'
    all['FEN'] = game.startFen
  }
  for (const [k, v] of Object.entries(all)) chess.header(k, v)

  return chess.pgn({ maxWidth: 80 })
}

export function importPgn(
  text: string,
): { ok: true; game: Game } | { ok: false; error: string } {
  if (text.trim().length === 0) {
    return { ok: false, error: 'The PGN is empty.' }
  }
  try {
    const chess = new Chess()
    chess.loadPgn(text)
    const headers = chess.getHeaders()
    const startFen = headers['FEN'] ?? STARTING_FEN
    const game = new Game({ fen: startFen })
    for (const m of chess.history({ verbose: true })) {
      const r = game.play({
        from: m.from,
        to: m.to,
        ...(m.promotion ? { promotion: m.promotion } : {}),
      })
      if (!r.ok) return { ok: false, error: `Illegal move in PGN: ${m.san}` }
    }
    if (game.moves.length === 0) {
      return { ok: false, error: 'The PGN contains no moves.' }
    }
    return { ok: true, game }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function importFen(
  text: string,
): { ok: true; game: Game } | { ok: false; error: string } {
  const fen = text.trim()
  try {
    // Constructing a Chess throws on an invalid FEN; let it validate for us.
    new Chess(fen)
    return { ok: true, game: new Game({ fen }) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
```

If `chess.header(k, v)` is unavailable or deprecated in the installed
version, use whatever the installed `chess.js` exposes for setting headers
(check `Object.keys(Chess.prototype)`), and adjust — the tests assert the
output, not the API used to produce it.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/game-core/io.test.ts` → PASS, 8 tests.

```bash
git add src/game-core/io.ts src/game-core/io.test.ts
git commit -m "feat(game-core): PGN and FEN import/export"
```

---

### Task 16: Templated hints

**Files:**
- Create: `src/coach/templated.ts`
- Test: `src/coach/templated.test.ts`

**Interfaces:**
- Consumes: `EngineInfo` and `uciToIntent` (Task 11), `Position` (Task 2).
- Produces: `function templatedHint(lines: EngineInfo[], position: Position): string | null`

**A constraint to honour strictly:** these templates may state only what the
engine output actually supports — the move, its evaluation, and any material
it wins. Do **not** pad them with invented chess commentary ("this pins the
knight and seizes the initiative"); we cannot derive that from a score and a
principal variation, and a confident wrong explanation is worse than a plain
one. Interpretive coaching arrives in Phase 2, from Claude.

- [ ] **Step 1: Write the failing test**

`src/coach/templated.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { templatedHint } from './templated'
import { Position } from '../game-core/position'
import type { EngineInfo } from '../engine/uci'

const info = (over: Partial<EngineInfo>): EngineInfo => ({ pv: ['e2e4'], ...over })

describe('templatedHint', () => {
  test('announces a forced mate with the move and the distance', () => {
    const hint = templatedHint([info({ scoreMate: 3, pv: ['d1h5'] })], new Position())
    expect(hint).toMatch(/mate in 3/i)
    expect(hint).toMatch(/Qh5/)
  })

  test('names the best move in standard notation, not UCI', () => {
    const hint = templatedHint([info({ scoreCp: 30, pv: ['g1f3'] })], new Position())
    expect(hint).toMatch(/Nf3/)
    expect(hint).not.toMatch(/g1f3/)
  })

  test('reports a winning capture', () => {
    const pos = new Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 0 2')
    const hint = templatedHint([info({ scoreCp: 120, pv: ['b8c6'] })], pos)
    expect(hint).not.toBeNull()
  })

  test('returns null when there is nothing to say', () => {
    expect(templatedHint([], new Position())).toBeNull()
    expect(templatedHint([info({ pv: [] })], new Position())).toBeNull()
  })

  test('an unplayable suggestion is rejected rather than shown', () => {
    const hint = templatedHint([info({ scoreCp: 10, pv: ['a1a8'] })], new Position())
    expect(hint).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/coach`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/coach/templated.ts`**

```ts
import { uciToIntent, type EngineInfo } from '../engine/uci'
import type { Position } from '../game-core/position'

const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/**
 * Build a hint from engine output alone.
 *
 * Deliberately limited to what the analysis supports: the move, the
 * evaluation, and material won. No invented positional commentary.
 */
export function templatedHint(lines: EngineInfo[], position: Position): string | null {
  const best = lines.at(-1) ?? lines[0]
  const uci = best?.pv[0]
  if (!best || !uci) return null

  const intent = uciToIntent(uci)
  if (!intent) return null

  // Play it on a copy to get SAN and to confirm it is actually legal.
  const probe = position.clone()
  const played = probe.tryMove(intent)
  if (!played.ok) return null
  const { san, captured } = played.move

  if (best.scoreMate !== undefined && best.scoreMate > 0) {
    return `There is a forced mate in ${best.scoreMate}, starting with ${san}.`
  }
  if (best.scoreMate !== undefined && best.scoreMate < 0) {
    return `The position is lost with best play; ${san} holds out longest.`
  }
  if (captured) {
    return `${san} wins a ${PIECE_NAME[captured] ?? 'piece'}.`
  }
  if (best.scoreCp !== undefined) {
    const pawns = (best.scoreCp / 100).toFixed(1)
    const sign = best.scoreCp > 0 ? '+' : ''
    return `${san} is the engine's choice, evaluated at ${sign}${pawns}.`
  }
  return `${san} is the engine's choice.`
}
```

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/coach` → PASS, 5 tests.

```bash
git add src/coach
git commit -m "feat(coach): templated hints derived strictly from engine output"
```

---

### Task 17: Full interface — all three modes

**Files:**
- Create: `src/ui/useMatch.ts`
- Create: `src/ui/panels/MoveList.tsx`, `Captured.tsx`, `Clocks.tsx`, `Controls.tsx`, `Scoreboard.tsx`, `NewGame.tsx`
- Create: `src/ui/app.css`
- Modify: `src/ui/App.tsx` (replace the Task 8 version)
- Test: `src/ui/App.test.tsx` (extend), `src/ui/panels/MoveList.test.tsx`

**Interfaces:**
- Consumes: `MatchController` (Task 13), `toMovePairs`/`material` (Task 14), `io` (Task 15), `templatedHint` (Task 16), `storage` (Task 9), `TIME_CONTROLS` (Task 5), `LEVELS` (Task 10).
- Produces: `function useMatch(controller: MatchController): MatchSnapshot`, and a complete `<App />`.

`useMatch` replaces the `forceRender` shim from Task 8. Delete that shim
entirely — do not leave both mechanisms in place.

```ts
// src/ui/useMatch.ts
import { useSyncExternalStore } from 'react'
import type { MatchController } from '../match/controller'
import type { MatchSnapshot } from '../match/types'

export function useMatch(controller: MatchController): MatchSnapshot {
  return useSyncExternalStore(
    (onChange) => controller.subscribe(() => onChange()),
    () => controller.snapshot(),
  )
}
```

**Note on snapshot identity:** `useSyncExternalStore` compares snapshots by
reference, and `MatchController.snapshot()` builds a fresh object each call,
so React will re-render on every check. Cache the snapshot in the controller
and return the same object until something actually changes: add a private
`cachedSnapshot` field, rebuild it inside `emit()`, and have `snapshot()`
return the cached value. Make this change as part of this task, and add a
controller test asserting that two consecutive `snapshot()` calls with no
intervening change return the identical object (`toBe`, not `toEqual`).

**Layout:** board centred; left column holds clocks, captured pieces, and
the scoreboard; right column is a tab group over the move list and (in later
phases) the explorer and analysis; controls sit beneath the board. Below
768px it collapses to one column with the panels as tabs under the board.

**Required test hooks** (the Playwright specs in Task 19 depend on these
exact values, so do not rename them):

| Element | Hook |
|---|---|
| Each square | `data-square="e4"` |
| Turn indicator | `data-testid="turn"` |
| Result banner | `data-testid="result"` |
| Move list entry | `data-testid="move-<ply>"` |
| Move count | `data-testid="ply-count"` |
| New-game button | `data-testid="new-game"` |
| Mode select | `data-testid="mode"` with values `two-player`, `one-player`, `zero-player` |
| Level select | `data-testid="level"` |
| Time control select | `data-testid="time-control"` |
| Pause / Step / Speed | `data-testid="pause"`, `data-testid="step"`, `data-testid="speed"` |
| Hint button / output | `data-testid="hint"`, `data-testid="hint-text"` |
| Undo / Redo | `data-testid="undo"`, `data-testid="redo"` |
| Import textarea / submit | `data-testid="import-text"`, `data-testid="import-submit"` |
| Import error message | `data-testid="import-error"` |
| Export PGN button | `data-testid="export-pgn"` |

- [ ] **Step 1: Write the failing MoveList test**

`src/ui/panels/MoveList.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MoveList } from './MoveList'
import type { PlayedMove } from '../../game-core/types'

const move = (san: string, color: 'w' | 'b'): PlayedMove => ({
  san, color, from: 'e2', to: 'e4', piece: 'p',
  isCapture: false, isCastle: false, isEnPassant: false, fenAfter: '',
})

describe('MoveList', () => {
  test('renders numbered pairs', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={2} onJump={vi.fn()} />,
    )
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByTestId('move-1')).toHaveTextContent('e4')
    expect(screen.getByTestId('move-2')).toHaveTextContent('e5')
  })

  test('clicking a move jumps to that ply', () => {
    const onJump = vi.fn()
    render(<MoveList moves={[move('e4', 'w')]} currentPly={1} onJump={onJump} />)
    screen.getByTestId('move-1').click()
    expect(onJump).toHaveBeenCalledWith(1)
  })

  test('marks the current ply', () => {
    render(
      <MoveList moves={[move('e4', 'w'), move('e5', 'b')]} currentPly={1} onJump={vi.fn()} />,
    )
    expect(screen.getByTestId('move-1').className).toContain('current')
    expect(screen.getByTestId('move-2').className).not.toContain('current')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/ui/panels/MoveList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/ui/panels/MoveList.tsx`**

```tsx
import type { PlayedMove } from '../../game-core/types'
import { toMovePairs } from './movePairs'

export function MoveList({
  moves,
  currentPly,
  onJump,
}: {
  moves: readonly PlayedMove[]
  currentPly: number
  onJump: (ply: number) => void
}) {
  const pairs = toMovePairs(moves)
  const entry = (e?: { san: string; ply: number }) =>
    e ? (
      <button
        className={`move ${e.ply === currentPly ? 'current' : ''}`}
        data-testid={`move-${e.ply}`}
        onClick={() => onJump(e.ply)}
      >
        {e.san}
      </button>
    ) : (
      <span className="move empty">…</span>
    )

  return (
    <ol className="move-list" data-testid="move-list">
      <span data-testid="ply-count" hidden>{moves.length}</span>
      {pairs.map((p) => (
        <li key={p.number}>
          <span className="number">{p.number}.</span>
          {entry(p.white)}
          {entry(p.black)}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 4: Write the remaining panels**

Each is small and presentational; they take props and render.

- `Clocks.tsx` — takes `{ clock: ClockState; orientation }`, formats
  milliseconds as `m:ss` (and `m:ss.t` under ten seconds), and marks the
  running side. Format in a pure helper `formatClock(ms: number): string`
  in the same file and unit-test it for `0`, `9_400`, `65_000`, `600_000`.
- `Captured.tsx` — takes `{ moves }`, calls `capturedPieces` and
  `materialBalance`, renders each side's tray and a `+N` badge for whoever
  leads. Render nothing for a balance of zero.
- `Scoreboard.tsx` — takes `{ score: MatchScore }`, renders `W–L–D`.
- `Controls.tsx` — Undo, Redo, Flip board, Resign, Hint, and (when either
  seat is an engine) Pause, Step, and the speed slider. Disable what does not
  apply to the current phase rather than hiding it, so the layout does not
  jump. Redo calls `game.redo()` and is disabled whenever there is nothing
  to redo.
- `NewGame.tsx` — mode, level, time control, and colour selects plus a
  "New game" button; calls `controller.start(config)` and persists the
  chosen settings via `saveSettings`.
- `GameIO.tsx` — the import/export controls:
  - **Export PGN** downloads `exportPgn(game, headers)` as a `.pgn` file via
    a `Blob` and an object URL, named `chess-<YYYY-MM-DD>.pgn`. Revoke the
    object URL after the click, or the blob leaks for the page's lifetime.
  - **Import** opens a textarea plus a file input, because pasting a PGN
    copied from a website is the common case and a file picker alone would
    not serve it. On submit, try `importPgn` first; if that fails and the
    text is a single line, try `importFen`; if both fail, show the parse
    error from whichever was attempted and **leave the current game
    untouched** — this is the spec's stated behaviour and the test below
    asserts it.
  - A successful import calls `controller.start({ ...config, startFen })`
    and then replays the imported moves, so the controller owns the
    resulting game like any other.

- [ ] **Step 5: Rewrite `src/ui/App.tsx`**

`App` owns the `MatchController`, reads it through `useMatch`, and passes
slices down. It must:
- build the controller once, in a `useState` initialiser, with
  `new EngineClient(createWorkerTransport())`
- catch a failure to construct the worker and render the board in
  two-player mode with a visible message that the engine is unavailable and
  the engine modes disabled — per the spec's error table, a missing engine
  must not break the game
- restore settings on mount via `loadSettings()`
- update the scoreboard when the phase becomes `finished`, writing through
  `saveScore`
- save the game to `saveInProgress(exportPgn(game))` after each move and
  offer to restore it on load
- wire the Hint button to run a one-off analysis at a fixed depth
  (say depth 12, 500 ms, MultiPV 1) and render `templatedHint(...)` into
  `data-testid="hint-text"`

- [ ] **Step 6: Extend `src/ui/App.test.tsx`**

Add, alongside the Task 8 tests:
- switching the mode select to `two-player` and playing Scholar's Mate still
  ends the game (the Task 8 assertion, now through the controller)
- undo after one move empties the move list; redo then restores it
- the hint button is present and disabled while it is not the human's turn
- pasting a valid PGN into `import-text` and submitting loads that game's
  moves into the move list
- pasting a valid FEN loads that position
- pasting rubbish shows a message in `import-error` **and leaves the current
  game's move list unchanged** — assert both halves, since only the second
  catches a half-applied import

```tsx
test('a failed import leaves the current game untouched', () => {
  const { container } = render(<App />)
  clickSquare(container, 'e2')
  clickSquare(container, 'e4')

  fireEvent.change(screen.getByTestId('import-text'), {
    target: { value: 'not a chess game at all' },
  })
  screen.getByTestId('import-submit').click()

  expect(screen.getByTestId('import-error')).not.toBeEmptyDOMElement()
  expect(screen.getByTestId('ply-count')).toHaveTextContent('1')
})
```

Engine-dependent behaviour is **not** tested here — that is the controller's
job with a fake engine (Task 13) and Playwright's job with the real one
(Task 19). Do not load Stockfish in a Vitest run.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

- [ ] **Step 8: Play all three modes by hand**

Run `npm run dev` and confirm: a two-player game; a one-player game at level
1 and at level 6 where the engine replies within a second or two; an
engine-vs-engine game where pause, step, and the speed slider all behave.

- [ ] **Step 9: Commit**

```bash
git add src/ui
git commit -m "feat(ui): full interface with all three player modes"
```

---

### Task 18: Persistence and scorekeeping wiring

**Files:**
- Modify: `src/ui/App.tsx`
- Test: `src/ui/persistence.test.tsx`

**Interfaces:**
- Consumes: `storage` (Task 9), `io` (Task 15).
- Produces: no new exports; behaviour only.

- [ ] **Step 1: Write the failing test**

`src/ui/persistence.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { App } from './App'

beforeEach(() => localStorage.clear())

function clickSquare(container: HTMLElement, square: string) {
  ;(container.querySelector(`[data-square="${square}"]`) as HTMLElement).click()
}

describe('persistence', () => {
  test('a played move is saved to localStorage', () => {
    const { container } = render(<App />)
    clickSquare(container, 'e2')
    clickSquare(container, 'e4')
    expect(localStorage.getItem('chess-game:in-progress')).toContain('e4')
  })

  test('settings survive a remount', () => {
    const { unmount } = render(<App />)
    localStorage.setItem(
      'chess-game:settings',
      JSON.stringify({ level: 6, orientation: 'black', timeControlId: 'blitz-5-3', soundEnabled: true, themeId: 'classic' }),
    )
    unmount()
    render(<App />)
    expect((screen.getByTestId('level') as HTMLSelectElement).value).toBe('6')
  })

  test('a finished game updates the score', () => {
    const { container } = render(<App />)
    const mate: Array<[string, string]> = [
      ['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'],
      ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7'],
    ]
    for (const [from, to] of mate) {
      clickSquare(container, from)
      clickSquare(container, to)
    }
    const score = JSON.parse(localStorage.getItem('chess-game:score') ?? '{}')
    expect(score.wins + score.losses + score.draws).toBe(1)
  })
})
```

In two-player mode, count a decisive result as a "win" for the scoreboard's
purposes; the scoreboard's meaning in one-player mode is from the human's
point of view. State this in a comment where the score is updated, since
otherwise the semantics are ambiguous.

- [ ] **Step 2–4: Implement, run, commit**

Wire the three behaviours into `App`, run `npm test` until green, then:

```bash
git add src/ui
git commit -m "feat(ui): persist settings, score, and the in-progress game"
```

---

### Task 19: End-to-end tests

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/two-player.spec.ts`, `one-player.spec.ts`, `zero-player.spec.ts`

**Interfaces:**
- Consumes: the `data-testid` and `data-square` hooks listed in Task 17.
- Produces: `npm run e2e`.

These are the only tests that load the real Stockfish build, which is why
they exist: everything else mocks the engine, so without them nothing
proves the wasm actually loads and answers.

- [ ] **Step 1: Install and configure Playwright**

```bash
npx playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Engine specs are timing-sensitive; run them one at a time.
  workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
})
```

- [ ] **Step 2: Write `tests/e2e/two-player.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('Scholar’s Mate ends in checkmate', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('two-player')
  await page.getByTestId('new-game').click()

  const moves: Array<[string, string]> = [
    ['e2', 'e4'], ['e7', 'e5'],
    ['f1', 'c4'], ['b8', 'c6'],
    ['d1', 'h5'], ['g8', 'f6'],
    ['h5', 'f7'],
  ]
  for (const [from, to] of moves) {
    await page.locator(`[data-square="${from}"]`).click()
    await page.locator(`[data-square="${to}"]`).click()
  }

  await expect(page.getByTestId('result')).toContainText(/checkmate/i)
  await expect(page.getByTestId('result')).toContainText(/white/i)

  // The board must stop accepting input once the game is over.
  await page.locator('[data-square="e8"]').click()
  await page.locator('[data-square="e7"]').click()
  await expect(page.getByTestId('ply-count')).toHaveText('7')
})
```

- [ ] **Step 3: Write `tests/e2e/one-player.spec.ts`**

```ts
import { expect, test } from '@playwright/test'

test('the engine replies to the human’s first move', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('one-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('new-game').click()

  await page.locator('[data-square="e2"]').click()
  await page.locator('[data-square="e4"]').click()

  // Stockfish must load, think, and answer. Generous timeout for a cold
  // wasm fetch on a slow machine.
  await expect(page.getByTestId('ply-count')).toHaveText('2', { timeout: 30_000 })
  await expect(page.getByTestId('turn')).toContainText(/white/i)
})
```

- [ ] **Step 4: Write `tests/e2e/zero-player.spec.ts`**

This is the spec that actually proves the pause and step controls work, so
it earns its flakiness risk.

```ts
import { expect, test } from '@playwright/test'

test('engine vs engine runs, pauses, and steps', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mode').selectOption('zero-player')
  await page.getByTestId('level').selectOption('1')
  await page.getByTestId('speed').fill('0')
  await page.getByTestId('new-game').click()

  const plies = page.getByTestId('ply-count')

  // It should play on its own.
  await expect(plies).toHaveText(/[6-9]|\d\d/, { timeout: 45_000 })

  await page.getByTestId('pause').click()
  const atPause = await plies.textContent()

  // Paused means paused: the count must not move.
  await page.waitForTimeout(2_000)
  await expect(plies).toHaveText(atPause ?? '')

  // One step is exactly one move.
  await page.getByTestId('step').click()
  await expect(plies).toHaveText(String(Number(atPause) + 1), { timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await expect(plies).toHaveText(String(Number(atPause) + 1))
})
```

- [ ] **Step 5: Run them**

Run: `npm run e2e`
Expected: 3 passing specs. If the one-player spec times out, open the app
and check the browser console — a 404 on `/engine/stockfish-19-lite-single.js`
means the `postinstall` copy did not run.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e package.json
git commit -m "test(e2e): Playwright coverage for all three player modes"
```

---

## Definition of Done for Phase 1

- [ ] `npm test` passes, including 18 perft assertions
- [ ] `npm run typecheck` is clean under `strict` + `noUncheckedIndexedAccess`
- [ ] `npm run e2e` passes all three specs
- [ ] All three modes are playable by hand
- [ ] Both input methods work: click-to-move and drag-and-drop
- [ ] Board coordinates are visible and flip with the board
- [ ] Every draw condition displays the correct reason
- [ ] A game exports to PGN and re-imports to the same move list
- [ ] A failed import leaves the current game untouched
- [ ] A game survives a page reload
- [ ] With `public/engine/` deleted, the app still loads and two-player mode
      still works, showing the engine-unavailable message

## Deferred to Phase 2

The Express server and Claude-written hints, the eval bar, opening naming
and the explorer, engine book moves, post-game review, persistent game
history, sounds, and themes. The research for the opening data is already
done: use `lichess-org/chess-openings` (CC0, 3,815 openings, ~389 KB of
TSV), and key the lookup on **EPD** — the FEN's first four fields only.
Keying on the full FEN fails, because the halfmove and fullmove counters
differ between two games that transpose into the same position.
