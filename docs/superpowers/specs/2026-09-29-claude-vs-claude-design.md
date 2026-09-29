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
