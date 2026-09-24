/**
 * The only file that touches the Netlify runtime: everything else in
 * `netlify/` takes its store, its clock and its environment as arguments,
 * which is what keeps the pipeline unit-testable.
 */
import { getDeployStore, getStore } from '@netlify/blobs'
import { createClaude, type Claude } from '../../server/claude'
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
 * The Claude client, or null when the site has no key configured — in which
 * case the browser shows "coaching offline" and uses its built-in hints.
 * The key is read from the environment and handed straight to the SDK; it
 * is never logged, echoed or stored.
 *
 * Netlify's AI Gateway injects an `ANTHROPIC_API_KEY` and an
 * `ANTHROPIC_BASE_URL` of its own into every function, which is why
 * coaching works on a fresh site with nothing configured: those calls are
 * proxied and billed to the Netlify account. Setting your own
 * `ANTHROPIC_API_KEY` on the site replaces the gateway's — and then the
 * gateway's base URL must go with it, or your key would be handed to the
 * proxy instead of to Anthropic. That is the only thing the comparison
 * below decides; neither value is read, logged or stored.
 */
export function coachClaude(env: Record<string, string | undefined>): Claude | null {
  const apiKey = env['ANTHROPIC_API_KEY']?.trim()
  if (!apiKey) return null
  const usingGateway = apiKey === env['NETLIFY_AI_GATEWAY_KEY']?.trim()
  const baseURL = usingGateway ? env['ANTHROPIC_BASE_URL'] : undefined
  return createClaude({ apiKey, baseURL })
}
