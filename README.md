# Chess

A browser chess game: zero-, one-, or two-player, full rules (chess.js), a
Stockfish opponent at ten levels, opening names as you play, rated puzzles,
post-game review, and progress saved in the browser. Claude writes the hints
and the review when the coach server is running; without it the app falls
back to built-in coaching.

See `docs/superpowers/specs/` for the design and `NOTICE.md` for the
third-party asset licences.

## Play it online

**https://pniessen.github.io/chess-game/**

That is the whole game — local play against the engine or another human,
the opening explorer, the puzzles, the review, and your saved settings,
ratings and history. Nothing is installed and nothing leaves the browser.

The one thing missing there is Claude coaching: hints and post-game review
need the Express server in `server/` and your own Anthropic API key, neither
of which exists on a static host. The app notices, shows a `coaching
offline` badge, and uses its built-in hints instead. That build also sets
`VITE_COACH=off` (see `.github/workflows/pages.yml`), so the browser never
even asks a server that isn't there.

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

`.github/workflows/pages.yml` builds on every push to `main` and publishes
to GitHub Pages. A project page lives under `/chess-game/`, so the build
sets `BASE_PATH=/chess-game/`; everything that builds a URL at runtime goes
through `import.meta.env.BASE_URL` (see `src/assetUrl.ts`). The default base
is `/`, so dev, preview and `npm start` are unaffected. No secrets are
involved — the deploy never touches `.env`.
