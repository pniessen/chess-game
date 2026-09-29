/** The two build-time values the gate reads; `import.meta.env` has both. */
export interface ClaudeGamesEnv {
  MODE?: string
  VITE_CLAUDE_GAMES?: string
}

/**
 * Whether this build offers Claude vs Claude. It runs only against the local
 * relay (`npm run server`), so it exists under the dev server (`npm run dev`,
 * mode 'development') and in the local production build `npm run
 * start:claude` makes (VITE_CLAUDE_GAMES=on).
 *
 * It reads MODE, not DEV: NODE_ENV=development (in the shell, `.env` or the
 * Netlify UI) makes DEV true inside `vite build` too, while the mode of a
 * build stays 'production' unless `--mode` says otherwise.
 * Plain `npm start` and the public builds (Netlify, GitHub Pages) set
 * neither, so they contain no Claude-vs-Claude UI and no /api/game calls;
 * vite.config.ts refuses a deploy build with the flag on (see
 * scripts/publicBuildGuard.ts). Shared plumbing (result texts, the
 * controller's Claude seat) is still in every bundle, unreachable.
 */
export function claudeGamesEnabled(env: ClaudeGamesEnv = import.meta.env): boolean {
  return env.MODE === 'development' || env.VITE_CLAUDE_GAMES === 'on'
}

/**
 * The gate as a build-time constant, for the UI to branch on. Written out
 * with direct `import.meta.env.X` reads rather than as `claudeGamesEnabled()`
 * so Vite substitutes each read with a literal at build time: in a public
 * build this is `'production' === 'development' || undefined === 'on'`, which the minifier
 * folds to `false`, and every `CLAUDE_GAMES && …` branch that imports it —
 * the mode option, the model selects, the budget fetch, the game client — is
 * dropped from the bundle. The unit test pins the two to the same rule.
 */
export const CLAUDE_GAMES: boolean =
  import.meta.env.MODE === 'development' || import.meta.env.VITE_CLAUDE_GAMES === 'on'
