/**
 * The only file that touches the Netlify runtime: everything else in
 * `netlify/` takes its store, its clock and its environment as arguments,
 * which is what keeps the pipeline unit-testable.
 */
import { getDeployStore, getStore } from '@netlify/blobs'
import { createClaude, type Claude } from '../../server/claude'
import type { CoachStore } from './limits'

/** Netlify's environment, including the deploy URLs the origin check reads. */
export const netlifyEnv = (): Record<string, string | undefined> => Netlify.env.toObject()

/**
 * The counters and the answer cache.
 *
 * Production gets the global store, so the budget is one budget for the
 * live site. Deploy previews and branch deploys get their own deploy-scoped
 * store: testing a preview cannot spend the production day's units, and the
 * data disappears with the deploy.
 */
export function coachStore(env: Record<string, string | undefined>): CoachStore {
  const options = { name: 'chess-coach', consistency: 'strong' } as const
  // Strong consistency: a budget that reads a 60-second-stale total is not a budget.
  const store = env['CONTEXT'] === 'production' ? getStore(options) : getDeployStore(options)
  // A Netlify Store does everything CoachStore asks for and more; the cast
  // is only about setJSON reporting a write result this code ignores.
  return store as unknown as CoachStore
}

/**
 * The Claude client, or null when the site has no key configured — in which
 * case the browser shows "coaching offline" and uses its built-in hints.
 * The key is read from the environment and handed straight to the SDK; it
 * is never logged, echoed or stored.
 */
export function coachClaude(env: Record<string, string | undefined>): Claude | null {
  const apiKey = env['ANTHROPIC_API_KEY']?.trim()
  return apiKey ? createClaude({ apiKey }) : null
}
