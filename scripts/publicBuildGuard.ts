/**
 * Claude vs Claude runs only against the local relay, so VITE_CLAUDE_GAMES=on
 * belongs to `npm run start:claude` alone. Put in `.env`, though, it would be
 * read by every local `vite build`, including the one `netlify deploy --build`
 * runs on this machine, and the Claude UI would ship to the public site.
 * vite.config.ts calls this for every build and throws on a refusal.
 */
export const PUBLIC_BUILD_REFUSAL =
  'VITE_CLAUDE_GAMES=on must never reach a public build; remove it from .env (use npm run start:claude locally).'

/**
 * A deploy build must be a plain production build. NODE_ENV=development (in
 * the shell, `.env` or the Netlify UI) makes Vite's `import.meta.env.DEV`
 * true inside `vite build`, and `--mode` changes MODE; either could put
 * dev-only UI (Claude vs Claude among it) in the public bundle.
 */
export const NON_PRODUCTION_REFUSAL =
  'A deploy build must be a production build: build without --mode and with NODE_ENV unset or set to production (check the shell, .env files and the Netlify UI).'

/**
 * Whether this build is a deploy build:
 *  - Netlify CI sets NETLIFY=true.
 *  - netlify-cli (`deploy --build`) sets NETLIFY_LOCAL=true, CONTEXT and
 *    DEPLOY_URL, but not NETLIFY. That comes from @netlify/config's
 *    env/main.js, which says CLI builds set NETLIFY_LOCAL instead.
 *  - GitHub Pages builds in GitHub Actions (GITHUB_ACTIONS=true).
 */
function isDeployBuild(env: Record<string, string | undefined>): boolean {
  return (
    env['NETLIFY'] === 'true' ||
    env['NETLIFY_LOCAL'] === 'true' ||
    Boolean(env['CONTEXT']) ||
    Boolean(env['DEPLOY_URL']) ||
    env['GITHUB_ACTIONS'] === 'true'
  )
}

/** What vite.config.ts knows about the build being made. */
export interface BuildInputs {
  /** The resolved VITE_CLAUDE_GAMES (loadEnv: process env, `.env`, `.env.local`, mode files). */
  claudeGamesFlag?: string | undefined
  /** Vite's mode (`vite build` defaults to 'production'). */
  mode: string
  /**
   * Every NODE_ENV the build could pick up: the process's own, the one loadEnv
   * resolves, and the one Vite adopts from a `.env` file (VITE_USER_NODE_ENV).
   * Unset or empty entries are ignored.
   */
  nodeEnvs: ReadonlyArray<string | undefined>
}

/**
 * The refusal message when a deploy build would carry the Claude UI or is not
 * a production build, else null. `env` is the build process's own environment.
 * Local builds (no deploy markers) are never refused.
 */
export function publicBuildRefusal(build: BuildInputs, env: Record<string, string | undefined>): string | null {
  if (!isDeployBuild(env)) return null
  if (build.claudeGamesFlag === 'on') return PUBLIC_BUILD_REFUSAL
  const badNodeEnv = build.nodeEnvs.some((v) => Boolean(v) && v !== 'production')
  if (build.mode !== 'production' || badNodeEnv) return NON_PRODUCTION_REFUSAL
  return null
}
