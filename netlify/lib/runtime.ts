/**
 * The only file that touches the Netlify runtime: everything else in
 * `netlify/` takes its store, its clock and its environment as arguments,
 * which is what keeps the pipeline unit-testable.
 */
import { getDeployStore, getStore } from '@netlify/blobs'
import { createClaude, type Claude } from '../../server/claude'
import { anthropicConfig } from './anthropic'
import { isProductionHost, type CoachStore } from './limits'

/** Netlify's environment, including the deploy URLs the origin check reads. */
export const netlifyEnv = (): Record<string, string | undefined> => Netlify.env.toObject()

/**
 * The counters and the answer cache.
 *
 * The live site gets the global store, so the budget is one budget that
 * every visitor draws on and that survives a redeploy. Previews and branch
 * deploys get their own deploy-scoped store: trying a preview cannot spend
 * the live day's units, and its data disappears with the deploy.
 */
export function coachStore(requestUrl: string | undefined): CoachStore {
  const options = { name: 'chess-coach', consistency: 'strong' } as const
  // Strong consistency: a budget that reads a 60-second-stale total is not a budget.
  const store = isProductionHost(requestUrl) ? getStore(options) : getDeployStore(options)
  // A Netlify Store does everything CoachStore asks for and more; the cast
  // is only about setJSON reporting a write result this code ignores.
  return store as unknown as CoachStore
}

/**
 * The Claude client, or null when the site has no usable key — in which
 * case the browser shows "coaching offline" and uses its built-in hints.
 * Which key and which base URL is `anthropicConfig`'s decision (see
 * ./anthropic.ts); the key is handed straight to the SDK and never logged,
 * echoed or stored.
 */
export function coachClaude(env: Record<string, string | undefined>): Claude | null {
  const config = anthropicConfig(env)
  return config ? createClaude(config) : null
}
