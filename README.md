# Chess

A browser chess game: zero-, one-, or two-player, full rules (chess.js), a
Stockfish opponent at ten levels, opening names as you play, rated puzzles,
post-game review, and progress saved in the browser. Claude writes the hints
and the review when a coach server is reachable — the local one in `server/`
or the Netlify Functions in `netlify/` — and without one the app falls back
to built-in coaching.

See `docs/superpowers/specs/` for the design and `NOTICE.md` for the
third-party asset licences.

## Play it online

It is published twice, from the same source.

**https://chess-with-claude.netlify.app** — the full experience. Netlify
runs serverless functions alongside the static site, so the third press of
the hint button and the post-game review are written by Claude.

**https://pniessen.github.io/chess-game/** — the same game with its
built-in coaching. GitHub Pages serves files and nothing else, so there is
nowhere for an API key to live; the app notices, shows a `coaching offline`
badge, and uses its own templated hints and review. That build also sets
`VITE_COACH=off` (see `.github/workflows/pages.yml`), so the browser never
even asks a server that isn't there.

Everything else is identical and identical on both: local play against the
engine or another human, the opening explorer, the puzzles, the review, and
your saved settings, ratings and history all stay in your browser.

## Run it locally

```sh
npm install          # postinstall copies the Stockfish worker into public/engine
npm run dev          # http://localhost:5173
```

### Working in a git worktree

`public/engine/` is gitignored and produced by `npm install`'s postinstall
step, so `git worktree add` gives you the tracked tree **without** the
engine — even when `node_modules` is already populated.

`npm run dev` and `npm run build` now heal that themselves (`predev` and
`prebuild` both run `scripts/copy-engine.mjs`, which is idempotent), so in
the common case you do not have to think about it. The one path neither
hook covers is running tests against an already-running server, or
`npx vitest run` on its own; `scripts/copy-engine.test.ts` fails loudly
and by name if the engine is missing there, rather than letting you read
it as a broken diff.

If you ever need it by hand:

```sh
node scripts/copy-engine.mjs   # or: npm install
```

Why it is worth a section: without the engine the app runs in two-player
mode behind a "chess engine is unavailable" banner, every Stockfish, hint
and eval test fails for environmental reasons, and that extra banner
shifts the header enough to corrupt layout measurements. A green suite is
impossible in that state and a red one is meaningless — it has cost more
than one session an afternoon and a wrong diagnosis.

Running suites in more than one worktree at once? Give each its own port,
because `reuseExistingServer` will otherwise bind your tests to whichever
dev server answers first, regardless of which checkout it belongs to:

```sh
PW_PORT=5199 npx playwright test
```

For Claude coaching, add your key and run the coach server alongside it
(Vite proxies `/api` to it, so the key never reaches the browser):

```sh
cp .env.example .env # then fill in ANTHROPIC_API_KEY
npm run server       # http://127.0.0.1:8787, loopback only
```

`npm start` builds the app and serves it from that same server.

Claude vs Claude (local only: `npm run dev`, or `npm run start:claude`) can
also seat TypeSafe's **Jev**. The server takes `TYPESAFE_API_KEY` from its
environment (a sourced shell or `.env`); when that is unset it reads the
`TYPESAFE_API_KEY=` line of `~/.config/typesafe/env` (or of the file
`TYPESAFE_ENV_FILE` names). The key stays on the server and is never logged.
Without it the Jev option is disabled and Claude-only games are unaffected;
with only a TypeSafe key, Jev vs Jev still plays.

It can also seat Google's **Gemini 3.1 Pro** and **Gemini 3.8 Flash** through
Vertex AI. The server signs in with Application Default Credentials
(`gcloud auth application-default login`, with Vertex AI enabled on the
project) and bills the project in `GOOGLE_CLOUD_PROJECT` (default
`poised-runner-159919`), location `global`. No key goes in `.env`. Without
working credentials the Gemini options are disabled and other games are
unaffected; the server's startup line says which providers are enabled.

## Checks

```sh
npm run typecheck
npm test             # unit tests (vitest)
npm run e2e          # browser tests (Playwright)
```

## Deploying

### GitHub Pages — the game, with built-in coaching

`.github/workflows/pages.yml` builds on every push to `main` and publishes
to GitHub Pages. A project page lives under `/chess-game/`, so the build
sets `BASE_PATH=/chess-game/`; everything that builds a URL at runtime goes
through `import.meta.env.BASE_URL` (see `src/assetUrl.ts`). The default base
is `/`, so dev, preview and `npm start` are unaffected. No secrets are
involved — the deploy never touches `.env`.

### Netlify — the game, with Claude coaching

`netlify.toml` builds the same app (`npm run build`, published from `dist`,
no `BASE_PATH`, so the base stays `/`) and deploys `netlify/functions/`
alongside it. Three functions answer at the exact paths the browser already
calls, through each function's own `config.path`:

| Path | Function | What it does |
| --- | --- | --- |
| `GET /api/health` | `netlify/functions/health.ts` | Says whether a key is configured. Never anything about its value. |
| `POST /api/hint` | `netlify/functions/hint.ts` | Claude explains the engine's move. |
| `POST /api/review` | `netlify/functions/review.ts` | Claude writes the post-game review. |

They share the request pipeline in `server/coach.ts` with the local Express
relay — same validation, same prompts, same error kinds — so there is only
one definition of what a coaching request means. `netlify/lib/runtime.ts`
is the only file that touches the Netlify runtime; the pipeline itself
(`netlify/lib/handler.ts`) takes its store, clock and environment as
arguments, which is how it is unit-tested without a key or a network.

To deploy from a local build:

```sh
npm run build
npx netlify-cli deploy --prod --dir=dist --functions=netlify/functions
```

There are deliberately no redirect rules: a catch-all would be able to
shadow the function routes.

#### The API key, and what it costs

A fresh Netlify site already answers with Claude, because **Netlify's AI
Gateway** injects an `ANTHROPIC_API_KEY` and an `ANTHROPIC_BASE_URL` into
every function. Those calls are proxied by Netlify and billed to the
Netlify account's AI credits, not to an Anthropic account. Nothing has to
be configured for coaching to work.

To spend your own Anthropic credits instead, set both variables on the
site — the key, and a base URL that sends it to Anthropic rather than to
the gateway proxy:

```sh
npx netlify-cli env:set ANTHROPIC_API_KEY  "sk-ant-..." --secret
npx netlify-cli env:set ANTHROPIC_BASE_URL "https://api.anthropic.com"
npx netlify-cli deploy --prod --dir=dist --functions=netlify/functions
```

or in the UI: **Project configuration → Environment variables → Add a
variable**, marking the key as a secret. The key is read from the
environment and handed straight to the SDK; it is never logged, echoed in a
response, or sent to the browser. `GET /api/health` reports only whether
one is configured.

A hard ceiling on what any of this can cost belongs in the Anthropic
Console, not in this repository: **console.anthropic.com → Settings →
Billing → Usage limits**, where you can set a monthly spend cap and an
alert threshold for the organization or workspace.

#### The limits in front of Claude

The endpoints are public, so four gates sit in front of every Claude call.
Counts live in Netlify Blobs (store `chess-coach`), so they survive across
invocations; the live site uses the global store and previews get their own
deploy-scoped one. All of it is in `netlify/lib/limits.ts`.

| Limit | Value | Why |
| --- | --- | --- |
| Origin allow-list | this deployment's own page, the site's `URL` / `DEPLOY_PRIME_URL` / `DEPLOY_URL`, `localhost`, `127.0.0.1`, plus anything in `COACH_ALLOWED_ORIGINS` | Another site cannot embed a script that spends the key. A POST with no `Origin` is refused too. |
| Per-visitor burst | 12 requests per 10 minutes | Checked before the cache, so nothing can be fetched in a tight loop. |
| Per-visitor day | 20 units | One person cannot drain the day. |
| Site-wide day | 50 units | The spending ceiling. Resets at 00:00 UTC. |
| Unit cost | hint = 1, review = 4 | A review's prompt and answer are several times a hint's. |
| Answer cache | keyed on endpoint + the exact request body, kept 30 days | An identical position is paid for once, ever. A cache hit costs no units. |
| `max_tokens` | 200 for a hint, 400 for a review | Output tokens are what a hint actually costs. |
| Claude timeout | 15 s, no retries | Same as the local server. |
| Request body | 32 KB | Rejected before anything else happens. |

At `claude-sonnet-5`'s $2/MTok in and $10/MTok out, one unit is worth at
most about $0.003, so 50 units is roughly **$0.14 a day, or about $4 a
month** at a flat-out worst case — and the cache makes the real figure
lower. Visitors are counted by a SHA-256 of their IP; the address itself is
never stored.

When any limit is hit the endpoint answers `503` with the error kind
`no-key`. That is deliberate: `CoachClient` treats that one kind as "stop
asking for this session", so the page quietly shows the `coaching offline`
badge and falls back to its built-in hints — no banner, no retry loop. A
`rate-limited` kind would have done the opposite.
