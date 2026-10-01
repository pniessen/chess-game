# Claude vs Claude — design

*2026-09-29. Peter's rulings: **owner only**, a **$20** games budget, **all models**. The other
eleven questions take the recommended answers from the background brainstorm; they are marked
(R) below so any of them can be overturned in review.*

## What it is

A zero-player game where each seat is a Claude model the owner picks — Fable 5.1, Opus 5.5,
Sonnet 5.5 or Haiku 4.5 — playing on the live Netlify site, watched with the existing Pause,
Step and Speed controls, with a one-line reason under each move and a running cost.

Not in v1: visitors starting games, Claude vs human, Claude vs Stockfish, medium effort, a
replay gallery, ratings. The design leaves room for each (see "Later").

## Rulings

| # | Question | Ruling |
|---|---|---|
| Q5 | Funding | **$20 per calendar month (UTC)**, counted in real dollars from each response's `usage` × the model's list price, in its own store namespace: the `chess-games` Netlify Blobs store, **one global store across all deploys** (production, drafts, branch deploys and deploy permalinks share one ledger and one lock, unlike the coach's deploy-scoped previews), so the $20 is one cap. A move that times out is charged a conservative estimate (estimated input + the whole output cap), since the API may still bill it. Paid through the Netlify AI Gateway like coaching, so the Netlify account's credit ceiling must allow ~$25/month in total — Peter's setting to change, not the code's. The coach's $5 plan and counters are untouched. |
| Q9 | Who can start a game | **Owner only**: a secret `OWNER_TOKEN` that Peter sets in Netlify's environment (never handled by Claude), entered once in a Settings field and kept in that browser's localStorage. Without it the Claude seat option is hidden and the endpoints answer 403. |
| — | Models | **All four**: `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, all listed by the AI Gateway docs (updated 2026-09-17). The browser sends a model *key* from an allow-list; only the server maps it to an ID. |
| Q1 (R) | Phase | A new `bot-thinking` phase with `by: 'engine' \| 'claude'`, so the UI can say "Opus 5.5 is thinking… 7s". |
| Q2 (R) | Approach | Claude picks the move itself from the FEN, the SAN history and the list of legal moves; the reply is structured output whose `move` is an **enum of the legal SANs**. Stockfish only supplies the spectator eval through the existing analysis path. |
| Q3 (R) | A failed reply | Retry once with a one-line correction; then play Stockfish's best move (via `EngineLane`) marked ⚙ in the move list; after **5** fallbacks by one side the game ends `claude-unavailable`, no winner, position kept. |
| Q4 (R) | Rationale | Yes, ≤ 20 words, shown under the board and saved as a PGN comment. |
| Q6 (R) | Effort | Low for Fable and Opus; adaptive thinking at effort low for Sonnet (the 5.x models reject `thinking: disabled`, Task 2's ruling); Haiku 4.5 does not think and is sent no effort. Medium needs background functions (Netlify's 60 s sync limit) and is later. |
| Q7 (R) | Clock | Untimed only. |
| Q8 (R) | Pause mid-move | Let the paid call finish, hold the reply, play it on resume. |
| Q10 (R) | Caching moves | No answer cache; only the held (game, ply) reply above. |
| Q11 (R) | Concurrency | One Claude game site-wide, a store lock with a 30-minute TTL. |
| Q12 (R) | Long games | Draw by adjudication at 160 plies (`CLAUDE_MAX_PLIES`): the controller finishes the game with the `adjudicated` FinishReason (winner none, PGN `1/2-1/2`, kept in History as a draw, headline "Draw by adjudication — 80 moves") before asking for ply 161; the server's 409 at the cap stays as a backstop. |
| Q13 (R) | Context | Full SAN history in each prompt. |
| Q14 (R) | Thinking summaries | Not shown in v1. |

## Cost

List prices from the brainstorm (estimates until Phase 0 measures them), per side of an
80-ply game: Fable low ~$1.45, Opus low ~$0.58, Sonnet ~$0.07, Haiku ~$0.04. So $20 buys
about 10 Fable-vs-Opus games a month, or hundreds of Sonnet/Haiku ones. The setup dialog
shows the estimate for the chosen pair and the month's remaining budget before Start.

## Phase 0 — measure before building (≤ $3 of the budget)

The brainstorm's latency and token numbers are estimates, and one assumption is unverified:
whether the gateway passes `output_config.format` (the legal-move enum) through. A throwaway
function behind `OWNER_TOKEN`, on a **draft deploy** (never production), asks each of the four
models for three moves from three fixed positions and records, per call: latency, input and
output tokens, whether the enum was honoured, and the dollar cost. Output: a short table in
this spec. If structured outputs do not pass through, the fallback is plain JSON validated
against the legal list, and Q3's retry does the work the enum would have.

Phase 0 decides: the per-move timeout, the per-game reservation, and whether Fable at low
effort fits comfortably inside 60 s.

## Architecture

**Browser.**
- `Seat` (`src/match/types.ts`) gains `{ kind: 'claude'; model: ClaudeModelKey }`.
- `MatchController` gets an injected `claudeMover` alongside `engine`; `toMoveOf` gains an
  `askClaude` branch that reuses the `requestId` stale-drop and pacing, and applies moves
  through `game.play()` — still the final legality check. The controller keeps owning all
  state; Claude only proposes a SAN.
- Claude failures never reach `illegalEngineMoves`/`engine-error`; they follow Q3. A fallback
  move asks Stockfish through `EngineLane`, so the one-worker invariant holds.
- Places that test `kind === 'engine'` switch to an `isBotSeat()` helper
  (`controller.ts` zero-player and undo/redo, `Controls.tsx` `hasEngineSeat`, `resume.ts`,
  `storage.ts` seat parsing — an unknown stored seat degrades to human, `matchConfig.ts`).
- UI: model picker per seat (owner only), thinking indicator with elapsed seconds, rationale
  caption, cost meter, ⚙ marks on fallback moves, model names in the player strips.

**Server (Netlify, plus the local Express app for development).**
- `POST /api/game/start` `{ white, black }`: checks the owner token, takes the one-game lock,
  reserves the worst case (160 plies × the Phase 0 per-move maximum) against the month's
  budget, returns a `gameId` and an HMAC-signed game token.
- `POST /api/game/move` `{ gameId, fen, history, legal }`: checks the game token, the ply cap
  and the reservation, calls the model with its own request builder (no `thinking: disabled`
  on these models; explicit effort; `max_tokens` headroom; a timeout from Phase 0), validates
  the reply against `legal`, and charges the actual cost.
- `POST /api/game/end`: releases the lock and the unused reservation, saves the game (PGN with
  rationales, models, cost, fallbacks) to the store. The lock's TTL covers a closed tab.
- Out of budget answers a distinct `budget` kind that ends the game `claude-unavailable`; it
  never touches the coach's counters or its `no-key` handling.
- Key routing reuses `anthropicConfig()` (`netlify/lib/anthropic.ts`).

**GitHub Pages** has no server: the Claude seat option does not exist there.

## Testing

- Unit: the controller with a fake `claudeMover` (as `EngineLike` is faked), covering the
  retry → fallback → abandon ladder, pause-while-in-flight, and undo across a Claude move;
  the move handler with a fake model client (validation, charging from `usage`, the budget,
  the lock, the ply cap, owner and game tokens). No test calls an API.
- E2E: a stubbed `/api/game/*` plays a short Claude-vs-Claude game to the end through the UI.
- Live: one Haiku-vs-Haiku game on the draft deploy (cents) before the merge.

## Later

A public replay gallery of saved games; Claude vs Stockfish; Claude vs human (needs a visitor
quota); a Stockfish-candidates "assisted" mode; medium effort via background functions; a
ratings table once there are enough games.

## Addendum, 2026-09-29: local-only (supersedes the owner-only design above)

This addendum supersedes every earlier section where they conflict (the owner token, the Netlify
functions and Blobs store, the draft-deploy measurement); those sections are kept as history.
Peter chose a local-only version over hardening a public endpoint. Claude vs Claude exists only
when the app is built for local use; the public builds (Netlify, GitHub Pages) contain no mode, no
owner-token field and no `/api/game/*` functions.

- **Gate:** a build-time flag. The mode exists when `import.meta.env.MODE === 'development'` (the
  `npm run dev` server; not `DEV`, which NODE_ENV=development turns on inside `vite build` too) or
  `VITE_CLAUDE_GAMES=on` (set by `npm run start:claude`, not by plain `npm start`); neither public
  build sets either, and `scripts/publicBuildGuard.ts` (called from `vite.config.ts`) fails any
  Netlify/CI build that has the flag on, or whose mode or NODE_ENV is not `production`, so the
  flag must never go in `.env`. The owner
  token, its Settings field and `x-owner-token` are removed.
- **Server:** only the local Express app (`npm run server`, bound to 127.0.0.1, `Host` checked
  against loopback names) serves `/api/game/*`, with Peter's own `ANTHROPIC_API_KEY` from `.env`.
  Game tokens are HMACs under a random per-process secret. The Netlify game functions,
  `gamesStore` and `gameMessagesClient` are deleted; the games logic moves from `netlify/lib/` to
  `server/`, since nothing on Netlify uses it.
- **Budget and saved games:** the $20/month cap stays, persisted to a local JSON file in
  the home directory, `~/.chess-game/claude-games` (override with `CLAUDE_GAMES_DIR`; outside the
  checkout, so it is shared across worktrees), so a server restart keeps the month's spend. Saved
  games (`games/saved/<id>`) live there too. A restart ends an in-progress game as lost.
- **Unavailable server:** if the local server is not running or has no key, the mode shows why
  (budget request fails) and Start is disabled.
- **Phase 0 (Task 10)** runs locally against Peter's own key.

## Addendum, 2026-09-30: TypeSafe's Jev takes a seat

- **What:** `jev` is a fifth key in `CLAUDE_MODELS` (id `jev-latest`, label "Jev"). It is
  seated, charged, saved, counted in the head-to-head and shown in the usage lines exactly like a
  Claude model; the seat kind stays `claude`. Whose API answers a seat, the key it needs and the
  picker's "TypeSafe Jev" live in `src/claude/providers.ts`, imported only by the server and the
  gated UI, so a public build has no "typesafe" in it at all (models.ts ships in every bundle).
- **The call** (`server/jevMove.ts`): `POST https://api.typesafe.ai/v1/systemone`, bearer
  `TYPESAFE_API_KEY`, `state` = `{fen, side_to_move, board}`, one `choice` question whose criteria
  are the legal moves keyed `m0..mN` and described in words ("Bxf7+: bishop from c4 to f7,
  capturing a pawn, check"). Jev can only pick a listed move; an unknown key is an illegal reply.
  Same 45 s timeout. 401/403 read as no key (503 `no-jev-key`), 429/529 as rate-limited, other
  failures as upstream (the browser retries, then Stockfish falls back as for Claude).
- **No rationale:** Jev returns a probability, not a reason, so a move's note is
  "Jev's pick (p 0.27)". Nothing is invented.
- **Price:** docs.typesafe.ai/models.md (2026-09-30): $0.042 per million input tokens, output
  tokens free. `costUsd` is computed from `usage.input_tokens`; a timeout is charged its estimated
  input. Reserve: $0.02 a side (80 moves x 3,000 tokens is $0.0101; the prompt carries no history,
  so it does not grow).
- **Key:** server-side only. `TYPESAFE_API_KEY` from the environment, else the
  `TYPESAFE_API_KEY=` line of `~/.config/typesafe/env` (`TYPESAFE_ENV_FILE` overrides the path).
  Never logged, never in a response or the browser bundle.
- **Without the key:** `GET /api/game/budget` lists the seatable models in `models`; the UI
  disables the others ("TypeSafe Jev (no TYPESAFE_API_KEY)") and blocks Start if one is seated;
  `start` refuses a Jev seat with 503 `no-jev-key` before reserving anything. With only a TypeSafe
  key, Jev vs Jev plays and Claude seats answer `no-key`.
- **Spike (2026-09-29, 19 positions):** median 169 ms a move, no illegal pick, mean centipawn loss
  215 against random's 414, Stockfish's best move 7 times in 19. Weak, but legal and fast.
- **Live smoke (2026-09-30, Jev vs Jev through the relay, temp ledger, 20 plies):** median 183 ms
  / max 397 ms per `/api/game/move`, no failures, 21,445 input / 4,291 output tokens over 20 calls
  (about 1,070 input a move), $0.0009 for the game.

## Addendum, 2026-10-01: Gemini 3.1 Pro and Gemini 3.8 Flash take seats (Vertex AI)

- **What:** `gemini-pro` (id `gemini-3.1-pro-preview`, "Gemini 3.1 Pro") and `gemini-flash`
  (id `gemini-3.8-flash`, "Gemini 3.8 Flash") are in `CLAUDE_MODELS`, seated, charged, saved,
  counted in the head-to-head and shown in the usage lines like any other model (the month line
  names them "Gemini Pro" / "Gemini Flash"). Provider `vertex` in `src/claude/providers.ts`.
- **Public builds carry none of it.** `models.ts` ships in every bundle, so the two rows (and their
  reserves) sit behind `LOCAL_MODELS`, the CLAUDE_GAMES rule written as direct `import.meta.env`
  reads (plus `import.meta.env === undefined`, which is the server under tsx). Vite folds it to
  `false` in a public build and the rows are dropped: built without the flag (and with
  `NETLIFY=true npm run build`), `dist` has 0 hits for `gemini`, `aiplatform`, `vertex` and
  `googleapis`; the bundle is byte-identical to main's. The Netlify functions import neither
  `server/geminiMove.ts` nor `google-auth-library`.
- **The call** (`server/geminiMove.ts`): `POST https://aiplatform.googleapis.com/v1/projects/<project>
  /locations/global/publishers/google/models/<id>:generateContent`, the Claude prompt (`movePrompt`,
  now shared from `server/claudeMove.ts`: FEN, numbered history, legal SAN list) as
  `systemInstruction` + one user turn, `responseMimeType: application/json` with a
  `responseSchema` whose `move` enum is the legal list, `why` cut to 20 words. The reply is checked
  against the legal list again; thought parts are skipped; any `finishReason` but `STOP` is an
  illegal reply (charged). No temperature or candidate count (Gemini 3 ignores or rejects them).
- **Thinking:** `thinkingConfig.thinkingLevel: 'LOW'` for both, the lowest each accepts (both list
  LOW / MEDIUM / HIGH and reject MINIMAL; defaults are HIGH for 3.1 Pro and MEDIUM for 3.8 Flash;
  thinking cannot be switched off on 3.1 Pro). Source: docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking
  and /models/guides/gemini-3-8-flash (read 2026-10-01). `maxOutputTokens` 2,000 (live calls used
  at most 206, thinking included).
- **Location:** `global` for both: 3.1 Pro Preview is served only there; 3.8 Flash is served from
  global and multi-region. Global is also the cheaper price row.
- **Auth:** Application Default Credentials through `google-auth-library` (a new dependency,
  ^11.1.0), whose `getRequestHeaders()` supplies the bearer and the `x-goog-user-project` header.
  The code never opens the credentials file and never logs a token or header. Project:
  `GOOGLE_CLOUD_PROJECT`, else `poised-runner-159919`. `available()` asks ADC once and remembers a
  success (a 401/403 on a move forgets it); a failure is re-asked after 30 s.
- **Without ADC:** `GET /api/game/budget` leaves both out of `models`, the pickers show
  "Gemini 3.8 Flash (no Google ADC)" disabled and Start is blocked with a hint, `start` refuses a
  Gemini seat with 503 `no-gemini-auth` before reserving, and a refused credential on a move reads
  the same. Claude and Jev games are unaffected. The startup line says
  "Gemini enabled (Vertex AI, project <p>, global)" or "Gemini disabled (no Google Application
  Default Credentials)".
- **Failures:** 401/403 auth (503 `no-gemini-auth`), 429 or `RESOURCE_EXHAUSTED` rate-limited,
  other HTTP errors and network failures upstream; refusals are free ("You're charged only for
  requests that return a 200 response code"). A timeout (the shared 45 s `MOVE_TIMEOUT_MS`) is
  charged the estimated input plus the 2,000-token cap.
- **Price** (cloud.google.com/vertex-ai/generative-ai/pricing, read 2026-10-01, global, <= 200K
  input tokens; output is "Text output (response and reasoning)", so `thoughtsTokenCount` is
  added to `candidatesTokenCount` and billed as output):
  - Gemini 3.1 Pro Preview: $2.00 / M input, $12.00 / M output.
  - Gemini 3.8 Flash: $1.50 / $7.50 standard, from 2027-01-01. Until 2026-12-31 Google charges an
    introductory $0.75 / $3.75; the ledger uses the standard price, so it over-counts Flash 2x
    until then rather than ever under-count. (Non-global locations are 10% dearer.)
- **Reserves:** the Phase 0 rule (80 x dearest opening move x 1.75 x 1.25). Opening moves through
  Vertex at LOW: Pro $0.00174 / $0.00284 (282 in, 98 / 190 out; a third call was rate-limited,
  429), Flash $0.00058 / $0.00073 / $0.00135 (21 / 41 / 123 out). Pro $0.50. Flash would be $0.24,
  but it timed out on 4 of 12 calls in the smoke game; at that rate 80 moves add about
  40 x $0.015, so Flash holds $0.60.
- **Live smoke (2026-10-01, Gemini 3.8 Flash White vs Gemini 3.1 Pro Black, 16 plies through the
  relay, temp `CLAUDE_GAMES_DIR`, cap then 8,000):** 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6
  5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7, every move legal, no illegal reply.
  - Pro: 8 calls, all first-try, 2.7 to 16.0 s a move (median 3.5 s), 3,076 input / 1,169
    output tokens (thinking included, 109 to 206 a move), $0.0202.
  - Flash: 12 calls for 8 moves. Its 8 answers took 2.6 to 28.6 s (median about 4 s, but 3 of
    them 23 to 29 s with only 21 to 90 output tokens: the time is queueing, not thinking), and 4
    calls hit the 45 s timeout (plies 7 and 13 each needed the third try). 4,448 input / 32,695
    output tokens on the ledger, $0.2519, of which about $0.242 is the four timeouts' worst-case
    charge; its 8 answered calls cost about $0.010.
  - Game total on the ledger $0.272 (real Vertex spend about $0.03 plus whatever Google billed for
    the abandoned calls). The cap is now 2,000, which would have charged those timeouts $0.06.

## Addendum, 2026-10-01 (later): the Flash seat is Gemini 3.6 Flash

This supersedes the 3.8 Flash parts of the addendum above (kept as history).

- **Why:** 3.8 Flash from `global` was too slow to play. Measured 2026-10-01 through
  `requestGeminiMove` with a 60 s timeout, 4 chess moves per model:
  - `gemini-3.8-flash`: 4 of 4 timed out (earlier, 8 of 12).
  - `gemini-3.7-flash`: 8.5 to 23 s a move.
  - `gemini-3.6-flash`: 1.3 to 1.5 s a move, every time.
  - The `us` multi-region endpoint was worse: 12 of 12 timeouts, and a trivial prompt took 119 s.
    It stays off; both seats use `global`.
  - Dropping the response schema made no difference.
- **What:** the `gemini-flash` row is id `gemini-3.6-flash`, label "Gemini 3.6 Flash". The seat
  key stays `gemini-flash`, so saved games and the head-to-head stay comparable (their labels now
  read 3.6 Flash, though games before 2026-10-01 were played by 3.8 Flash).
- **Status:** GA (the 3.6 Flash model page lists its launch stage as GA; 3.1 Pro stays Preview).
  Served from Global and multi-region.
- **Thinking:** 3.6 Flash accepts MINIMAL, LOW, MEDIUM and HIGH (default MEDIUM), so it is asked
  for MINIMAL, the lowest. MINIMAL "still requires thought signatures", which only matters when a
  request carries earlier model turns; each move is a single turn, and the live calls succeeded.
  Pro stays at LOW. Source: docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides
  /gemini-3-6-flash and /models/thinking (read 2026-10-01).
- **Price** (cloud.google.com/vertex-ai/generative-ai/pricing, read 2026-10-01, Standard tier,
  global, <= 200K input tokens): $1.50 / M input and $7.50 / M output (response and reasoning)
  standard, from 2027-01-01. Introductory pricing applies until 2026-12-31: $0.75 / $3.75. The
  ledger uses the standard price, as before, so it over-counts Flash 2x until then. Non-global
  is 10% dearer. The same as 3.8 Flash's, so `priceIn` / `priceOut` are unchanged.
- **Reserve:** 12 live moves at MINIMAL (start, ply 6, ply 20, ply 40, three times): all legal,
  none timed out, 1.0 to 2.4 s (median 1.2 s), 282 to 582 input and 25 to 43 output tokens,
  $0.00060 to $0.00114 a move. The dearest opening move was $0.000708, so the Phase 0 rule gives
  80 x 0.000708 x 1.75 x 1.25 = $0.124; with room for two worst-case timeouts (about $0.016
  each) Flash holds **$0.16** a side, down from $0.60. For comparison LOW gave the same moves at
  1.1 to 6.1 s and up to 75 output tokens.

## Addendum, 2026-10-01: an automated round-robin trial (scripts/trial)

Peter's rulings: all 7 seats, 21 pairings x 4 games (colours 2/2), a separate $40 hard cap with
its own ledger, games capped at 160 plies and then adjudicated by Stockfish.

- **Routing:** `server/moveDispatch.ts` (`dispatchMove`) is the one place a seat's provider is
  chosen; `/api/game/move` and the trial both call it. `moveClientsFor(env)` in `server/index.ts`
  builds the provider clients for both.
- **Rules per move, as in the app:** retry once after a retryable failure (timeout, unusable
  reply, upstream); then Stockfish plays the move at `CLAUDE_FALLBACK_LEVEL` (now in
  `src/match/claudeFallback.ts`), counted as a fallback against the model; 5 fallbacks, a missing
  or rejected key, or a bad request end the game with no result (`model-unavailable`). A rate
  limit is backed off (5, 15, 30, 60 s) and asked again before that retry is spent.
- **Endings:** checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient
  material; at `--max-plies` Stockfish (depth 18) scores the final position: |eval| >= 300 cp or
  a forced mate wins for the side ahead, otherwise a draw. The game file records the eval.
- **Budget:** `ledger.jsonl` in the trial directory, never the monthly ledger. A game starts only
  if spend + what running games still hold + both seats' `RESERVE_PER_GAME_USD` fits under the
  cap; games start in schedule order (a cheaper later game never jumps the queue). Before every
  call the worst case (the provider's output cap over a 4,000-token prompt) must still fit, so the
  cap is hard; a game stopped by it is set aside in `aborted/` and replayed on the next run.
- **Pool:** `--concurrency` games at once (default 3), never two for one model; each running game
  leases its own Stockfish instance (the `stockfish` package's lite single WASM, re-required per
  instance; the loader nulls `fetch`, which is restored after each load).
- **Resume:** `games/<id>.json` is written atomically when a game ends; a restart skips those and
  re-reads spend from the ledger. `trial.json` pins the field, games per pair and max plies.
- **Report:** `npm run trial:report`: CPL per move at depth 14 (capped at 1000; blunder >= 300,
  mistake 100-299, inaccuracy 50-99; opening = plies 1-20, endgame = non-pawn material <= 26),
  cached in `analysis/`; per model W/D/L and score overall and per opponent, median and p90 s per
  move, cost, tokens, fallbacks, timeouts, game length, endings, ECO openings (`src/openings`),
  and style signals (captures, checks, pawn moves, castling, early queen trades, CPL ahead / level
  / behind, repetition). One Claude Opus 5.5 call per model writes 3-5 style bullets from those
  numbers and short excerpts only (cached by prompt; charged to the trial ledger as commentary).
- **Pilot (2026-10-01, `pilot-2026-10-01`):** haiku, jev, gemini-flash, 1 game a pairing, 20
  plies, $1 cap. 3 games, all adjudicated at ply 20 (Flash 2-0, Jev 1-1, Haiku 0-2); $0.034 on
  moves and $0.052 on commentary. Flash: median 1.3 s, one 429 backed off; average CPL Flash 10,
  Haiku 151, Jev 262. The report's figures were checked by hand against the game files and ledger.

## Phase 0 results (measured 2026-09-29, local server, Peter's own key)

Three moves per model from the start position (both seats the same model), then one full
Haiku-vs-Haiku game. Latency is client-side wall clock per `/api/game/move`; cost is the
server-charged `costUsd` from `usage` at list price.

| Model | Median / max latency | Cost per move (opening) | Illegal replies / retries |
|---|---|---|---|
| Haiku 4.5 | 2.2 s / 2.3 s | $0.0006–0.0008 | 0 / 0 |
| Sonnet 5.5 (effort low) | 2.4 s / 2.9 s | $0.0015–0.0018 | 0 / 0 |
| Opus 5.5 (effort low) | 3.5 s / 3.7 s | $0.0029–0.0036 | 0 / 0 |
| Fable 5.1 (effort low) | 3.9 s / 4.6 s | $0.0072–0.0086 | 0 / 0 |
| Haiku vs Haiku, full game | 2.2 s / 3.3 s over 102 plies (drawn) | $0.00095 median, $0.00135 max; $0.0945 for the game | 0 / 0 |

- Structured output with the legal-move enum is accepted on all four models; no reply ever left
  the list.
- Per-move cost grows with the history in the prompt (1.7x from the opening to ply ~100 for
  Haiku), so the first estimated reserves were too low for Sonnet and Haiku: a Haiku game would
  have hit its reservation near ply 130. `RESERVE_PER_GAME_USD` is retuned to reach the 160-ply
  cap: fable 1.50, opus 0.63, sonnet 0.32, haiku 0.14 per side.
- `MOVE_TIMEOUT_MS` stays 45 s: the slowest move measured was 4.6 s, but Fable and Opus were only
  measured in the opening, where adaptive thinking is lightest.
- Total spent on Phase 0: $0.134.
