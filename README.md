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

For Claude coaching, add your key and run the coach server alongside it
(Vite proxies `/api` to it, so the key never reaches the browser):

```sh
cp .env.example .env # then fill in ANTHROPIC_API_KEY
npm run server       # http://127.0.0.1:8787, loopback only
```

`npm start` builds the app and serves it from that same server.

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
