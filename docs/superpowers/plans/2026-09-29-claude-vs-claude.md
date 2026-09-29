# Claude vs Claude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner-only zero-player mode on the Netlify site where each seat is a Claude model (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 4.5), paid from a $20/month dollar budget.

**Architecture:** The server owns everything that costs money or decides legality: it replays the SAN history with `game-core`, derives the legal SAN list itself, asks the model for one of them (structured-output enum, with a plain-JSON fallback), charges actual `usage` against a monthly budget, and holds a one-game lock. The browser gets a new `claude` seat kind; `MatchController` asks an injected `ClaudeMover` for Claude turns and keeps owning all state, with a retry → Stockfish-fallback → abandon ladder that never goes through `engine-error`.

**Tech Stack:** TypeScript, React 19, `@anthropic-ai/sdk`, Netlify Functions + Blobs, Express (local dev), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-claude-vs-claude-design.md`

## Global Constraints

- Owner only: every `/api/game/*` call needs `OWNER_TOKEN` (env; Peter sets it; never read into logs, responses, or tests' fixtures other than a fake). Without the env var the endpoints answer 403 and the UI never offers the mode.
- Budget: `$20` per UTC calendar month, in dollars from `usage` × list price. Its own store and keys; never touches `COACH_LIMITS` counters or the coach `no-key` latch.
- Models (allow-list keys → IDs): `fable` → `claude-fable-5-1`, `opus` → `claude-opus-5-5`, `sonnet` → `claude-sonnet-5-5`, `haiku` → `claude-haiku-4-5-20251001`. The browser only ever sends keys.
- Effort: `low` for fable/opus; sonnet/haiku with the lowest cost setting that the API accepts for them (Task 2 decides from the claude-api skill). Untimed games only. One game site-wide (lock TTL 30 min). Draw by adjudication at 160 plies. ≤ 20-word rationale per move.
- Legality: the server derives legal moves itself; the browser re-checks with `game.play()`. Claude failures never increment `illegalEngineMoves` or finish `engine-error`.
- One Stockfish worker; only `EngineLane` talks to it (fallback moves go through `this.lane.move`).
- No test calls a real API. Stage explicit paths; never commit `.claude/`, `.superpowers/`, `.env`.

## Rulings made while planning (recorded, overturnable)

- **Q1 overturned:** no `bot-thinking` rename (37 references in 12 files for no behaviour). A Claude turn uses the existing `engine-thinking` phase; the UI derives *who* is thinking from `config[side]`.
- **Legal moves are server-derived**, not sent by the browser; the request carries `startFen?` and the SAN history, which the server replays (rejecting an illegal history as `bad-request`).
- **Phase 0 runs through the real endpoints** on a draft deploy (Task 10), not a throwaway function. Until then the per-move timeout (45 s) and per-game reservation (from the brainstorm's cost table) are constants in one file, tuned by Task 10.

---

### Task 1: `Position.legalSans()`

**Files:** Modify `src/game-core/position.ts`; Test `src/game-core/position.test.ts`

**Interfaces:** Produces `Position.legalSans(): string[]` — every legal move in SAN, promotions as four entries (`e8=Q`, `e8=R`, `e8=B`, `e8=N`).

- [ ] Test: start position → 20 SANs including `e4`, `Nf3`; a promotion position (`8/4P3/8/8/8/8/k7/7K w - - 0 1`) contains `e8=Q` and `e8=N`; a mated position → `[]`.
- [ ] Run, see it fail; implement `return this.chess.moves()` (chess.js default is SAN, promotions already expanded); run green; commit.

### Task 2: Server move core (`server/claudeMove.ts`)

**Files:** Create `server/claudeModels.ts`, `server/claudeMove.ts`, tests beside them.

**Interfaces:**
- `claudeModels.ts`: `type ClaudeModelKey = 'fable' | 'opus' | 'sonnet' | 'haiku'`; `CLAUDE_MODELS: Record<ClaudeModelKey, { id: string; label: string; priceIn: number; priceOut: number; effort?: 'low' }>` (USD per MTok, from the claude-api skill's pricing, with the date read in a comment); `isClaudeModelKey(v: unknown)`; `costUsd(key, usage: { input_tokens: number; output_tokens: number })`; `MOVE_TIMEOUT_MS = 45_000`; `RESERVE_PER_GAME_USD: Record<ClaudeModelKey, number>` (the brainstorm's per-side estimate × 1.5, for 80 plies — Task 10 retunes).
- `claudeMove.ts`: `requestMove(deps: { client: MessagesClient }, req: { model: ClaudeModelKey; startFen?: string; history: string[] }): Promise<MoveOutcome>` where
  `MoveOutcome = { ok: true; san: string; why: string; costUsd: number; ms: number } | { ok: false; kind: 'bad-request' | 'illegal-reply' | FailureKind; costUsd: number; ms: number }`.
- Reuses `MessagesClient` and `classifyError` from `server/claude.ts`; does **not** reuse `createClaude` (it disables thinking and fixes the coach model).

Behaviour:
1. Replay `history` from `startFen ?? STARTING_FEN` with `Game`; any illegal SAN or finished status → `bad-request` (cost 0).
2. Legal list = `current().legalSans()`. Prompt (system): "You are playing chess as {White|Black}. Choose one move from the list. Reply with the move and a reason of at most 20 words." User: FEN, `numberedMoves(history)` (from `src/review/moveNumber`), the legal list.
3. Request: `model: CLAUDE_MODELS[key].id`, `max_tokens: 8000`, `output_config: { effort, format: { type: 'json_schema', schema: { type: 'object', properties: { move: { type: 'string', enum: legal }, why: { type: 'string' } }, required: ['move', 'why'], additionalProperties: false } } }`, no `thinking` field. Check exact field names against the claude-api skill before writing.
4. Parse the text block as JSON; `move` must be in `legal` (exact string) → ok; anything else (unparseable, not in list, `stop_reason` `refusal`/`max_tokens`) → `illegal-reply`. `why` trimmed and cut to 20 words. `costUsd` always from `response.usage` when a response exists (a failed reply still costs).
5. SDK errors → `classifyError` kind, cost 0.

- [ ] Tests with a fake `MessagesClient`: legal reply → ok with cost = usage × price; reply outside the list → `illegal-reply` with its cost; unparseable → `illegal-reply`; `stop_reason: 'max_tokens'` → `illegal-reply`; SDK timeout error → `timeout`; illegal history → `bad-request` and the client is never called; the request sent has the enum equal to the server-derived list and never contains `thinking`; the model ID comes from the key. Red first, then implement, green, commit.

### Task 3: Game limits and store (`netlify/lib/games.ts`)

**Files:** Create `netlify/lib/games.ts`, `netlify/lib/games.test.ts`

**Interfaces:** A store with the `CoachStore` shape (`get(key, {type:'json'})`, `setJSON`). Functions, all taking `(store, now, env)` explicitly:
- `checkOwner(header: string | null, env): boolean` — constant-time compare (`timingSafeEqual`) against `env.OWNER_TOKEN`; false when the env var is missing or empty.
- `startGame(store, now, env, { white, black }): Promise<{ ok: true; gameId: string; token: string; budgetLeftUsd: number } | { ok: false; kind: 'busy' | 'budget' | 'bad-request' }>` — validates keys; the lock `games/lock` (`{ gameId, until }`) must be absent or expired (30 min); reserves `RESERVE_PER_GAME_USD[white] + [black]` against `games/budget/<YYYY-MM>` (`{ spent, reserved }`, limit `GAMES_MONTHLY_USD = 20`); writes `games/<id>` `{ white, black, reserved, spent: 0, plies: 0, startedAt }`; token = HMAC-SHA256(`OWNER_TOKEN`, gameId).
- `authorizeMove(store, now, env, { gameId, token, side, plies }): Promise<{ ok: true; model: ClaudeModelKey } | { ok: false; kind: 'forbidden' | 'budget' | 'over' }>` — token check, lock still held by this game (refresh `until`), `plies < 160`, game's `spent < reserved`.
- `chargeMove(store, now, gameId, costUsd)` — adds to the game's and the month's `spent`.
- `endGame(store, now, gameId, record)` — releases the lock, returns `reserved - spent` to the month, writes `games/saved/<id>` with the record (PGN, models, cost, fallback counts).
- `budgetLeft(store, now): Promise<number>`.
- [ ] Tests (fake store from `limits.test.ts`): owner check (missing env → false, wrong → false, right → true); start twice → second `busy`; expired lock → start succeeds; budget near $20 → `budget`; move with a bad token → `forbidden`; ply 160 → `over`; spent ≥ reserved → `budget`; end releases the lock and unused reservation; a new month resets. Red, implement, green, commit.

### Task 4: Endpoints (Netlify + Express)

**Files:** Create `netlify/functions/game-start.ts`, `game-move.ts`, `game-end.ts`, `game-budget.ts`; `netlify/lib/gameHandler.ts` + test; modify `netlify/lib/runtime.ts` (a `gamesStore()` named `chess-games`, production vs deploy-scoped like `coachStore`), `server/app.ts` (the same four routes behind `x-owner-token`, using an in-memory store; the local relay stays loopback-only).

**Interfaces:** `handleGame(endpoint: 'start' | 'move' | 'end' | 'budget', request: Request, deps: { store; env; client: MessagesClient | null; now? }): Promise<Response>`.
- All: POST (budget: GET), origin check reused from `isAllowedOrigin`, `x-owner-token` → 403 `{ error: { kind: 'forbidden' } }` when wrong or unset.
- `move` body `{ gameId, token, startFen?, history }`: `authorizeMove` → `requestMove` → `chargeMove(outcome.costUsd)` → `200 { san, why, costUsd, gameSpentUsd }` or `{ error: { kind } }` with 409/402/502 as appropriate.
- `client` from `anthropicConfig()` (Netlify) — null → 503 `no-key`.
- [ ] Handler tests with fake client and store: 403 without token; full start → move → end happy path; `busy`; `budget`; the coach store is never written. Red, implement, green, commit.

### Task 5: Browser `GameClient` and `ClaudeMover`

**Files:** Create `src/claude/gameClient.ts` + test, `src/claude/ownerToken.ts` (localStorage get/set with try/catch, key `chess.ownerToken`).

**Interfaces:**
- `interface ClaudeMover { begin(white: ClaudeModelKey, black: ClaudeModelKey): Promise<BeginResult>; move(req: { startFen?: string; history: string[] }, signal?: AbortSignal): Promise<ClaudeMoveResult>; end(record: GameRecord): Promise<void> }`
- `ClaudeMoveResult = { ok: true; san: string; why: string; costUsd: number; gameSpentUsd: number } | { ok: false; kind: 'retry' | 'budget' | 'fatal' }` — `retry` for `illegal-reply`/`timeout`/`upstream`/`rate-limited`; `budget` for 402/`over`; `fatal` for 403/`no-key`/network.
- `createGameClient({ fetch?, ownerToken: () => string | null })` implements it; `begin` stores gameId/token internally.
- `ClaudeModelKey` is imported from `server/claudeModels.ts` (type-only) so both sides share one list.
- [ ] Tests with a fake fetch for each mapping. Red, implement, green, commit.

### Task 6: Controller — the `claude` seat

**Files:** Modify `src/match/types.ts`, `src/match/controller.ts`; Test `src/match/controller.claude.test.ts`

**Interfaces:**
- `Seat` adds `{ kind: 'claude'; model: ClaudeModelKey }`; `FinishReason` adds `'claude-unavailable'`; export `isBotSeat(seat): boolean` (engine or claude).
- `MatchController` constructor deps add `claude?: ClaudeMover`; `MatchSnapshot` adds `claude: { notes: Record<number, { why: string; fallback: boolean }>; spentUsd: number }` (ply index → note; empty object when unused).
- `toMoveOf`: `seat.kind === 'claude'` → phase `engine-thinking` + `askClaude(side, seat, id)`.
- `askClaude`: if a held reply exists for the current live FEN, use it. Else `claude.move({ startFen, history })`. On a reply whose `id` is stale: if its FEN still equals the live FEN, hold it (Q8), else drop. `ok` → apply via `game.play` from SAN (`Position.trySan` path through `Game.play` intent conversion — add `Game.playSan` if needed, with a game-core test), record note, add cost, `afterMove(id)`. `retry` → one more ask; second failure (or `game.play` refusing the SAN) → fallback: `this.lane.move` at level 8 profile, apply as an engine move, note `{ fallback: true, why: '' }`, count per side; 5 fallbacks on one side → `finish('claude-unavailable')`. `budget`/`fatal` → `finish('claude-unavailable')`.
- Replace literal `kind === 'engine'` checks with `isBotSeat` where they mean "not a human" (`isZeroPlayer`, undo/redo one-player pops); `isOnePlayer` stays human-count based.
- Untimed is enforced by the config builder (Task 8), not here.
- [ ] Tests with a fake `ClaudeMover` and the existing `fakeEngine`: two Claude seats play three moves; a `retry` then ok; two failures → Stockfish fallback marked; 5 fallbacks → `claude-unavailable`; `budget` → `claude-unavailable`; pause during an in-flight move then resume plays the held reply without a second `move` call; undo during an in-flight move drops it; `illegalEngineMoves` never changes. Red, implement, green, commit.

### Task 7: Persistence and resume

**Files:** Modify `src/storage/storage.ts` (+ test), `src/ui/resume.ts` (+ test)

- `StoredSeat` gains the claude variant; `parseSeat` accepts it only with a valid model key, else returns null (the existing "unreadable → two-player" path).
- A resumed Claude game comes back **paused** (never auto-spends); resuming it calls `begin` again.
- [ ] Tests: round-trip a claude seat; unknown model key → null; resume of a Claude game is paused. Red, implement, green, commit.

### Task 8: UI

**Files:** Modify `src/ui/panels/NewGame.tsx`, `src/ui/app/matchConfig.ts`, `src/ui/panels/SettingsPopover.tsx`, `src/ui/panels/Controls.tsx` (`hasEngineSeat` → `isBotSeat`), `src/ui/app/StatusHeader.tsx`, `src/ui/panels/MoveList.tsx`, `src/ui/app/useMatchLifecycle.ts`, `src/ui/App.tsx`, `src/ui/app.css`; tests beside each.

- Settings: an "Owner token" password field (only when coaching is enabled for the build), saved via `ownerToken.ts`; never echoed back into the DOM after save (shows "set" / "not set").
- New game: `Mode` adds `'claude-vs-claude'`, present only with an owner token; two model selects (`claude-white`, `claude-black`); level and time control disabled; the estimate (`RESERVE_PER_GAME_USD` sum / 1.5) and the month's budget left (GET `/api/game/budget`) shown under the selects. `buildConfig` returns two claude seats, untimed, `engineDelayMs: 500`.
- Start: lifecycle calls `mover.begin` before `controller.start`; a failed begin shows its reason (`busy`, `budget`) and starts nothing. Finish/new game/unload → `mover.end(record)`.
- Status: "Opus 5.5 is thinking… 7s" while `engine-thinking` on a claude seat; cost meter "This game: $0.84"; rationale caption under the board for the displayed ply; ⚙ badge on fallback moves in the move list; model labels in the clocks' player names.
- [ ] Component tests for each piece; red, implement, green, commit per component group.

### Task 9: E2E

**Files:** Create `tests/e2e/claude-vs-claude.spec.ts`

- Stub `/api/health` (claude true) and `/api/game/*` (start ok; move returns a scripted legal SAN sequence for a fool's-mate-length game; end 200). Set the owner token through the Settings field. Choose Claude vs Claude, Opus vs Haiku, start; assert the thinking label, a rationale caption, the cost meter, and the game ends in mate with the end card. A second test: a scripted `illegal-reply` twice → a ⚙ move appears. A third: no owner token → the mode is absent.
- [ ] Prove each red by reverting Task 8's mode option; green; run with `PW_PORT=5199`, prove the served tree.

### Task 10: Phase 0 measurement and tuning (needs `OWNER_TOKEN` set by Peter)

- [ ] Draft deploy (`deploy --build`, no `--prod`). With the owner token entered in that browser, play: 3 moves each of fable/opus/sonnet/haiku from the start position via `/api/game/move` (a start/end pair per model), then one full Haiku-vs-Haiku game. Stay under $3 (check `/api/game/budget`).
- [ ] From the responses and the function logs record per model: median/max latency, median/max cost per move, whether the enum was honoured (any `illegal-reply`). Write the table into the spec's Phase 0 section.
- [ ] Retune `MOVE_TIMEOUT_MS` and `RESERVE_PER_GAME_USD`; if structured outputs were rejected by the gateway, switch Task 2's request to plain JSON (validation already covers it) and note it.
- [ ] Commit.

### Task 11: Land

- [ ] Full `npx vitest run` and `PW_PORT=5199 npx playwright test`; both green.
- [ ] Update `docs/next-session-prompt.md` (the mode, the owner token, the budget, where games are saved).
- [ ] Merge to `main`, push, `netlify deploy --build --prod`, then one live Haiku-vs-Haiku game from the owner browser; confirm the saved game and the budget figure.
