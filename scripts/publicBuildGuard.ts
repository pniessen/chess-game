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

/**
 * The refusal message when a deploy build would carry the Claude UI, else null.
 * `claudeGamesFlag` is the resolved VITE_CLAUDE_GAMES (loadEnv: process env,
 * `.env`, `.env.local`); `env` is the build process's own environment.
 */
export function publicBuildRefusal(
  claudeGamesFlag: string | undefined,
  env: Record<string, string | undefined>,
): string | null {
  return claudeGamesFlag === 'on' && isDeployBuild(env) ? PUBLIC_BUILD_REFUSAL : null
}
