/**
 * The only file that touches the Netlify runtime: everything else in
 * `netlify/` takes its store, its clock and its environment as arguments,
 * which is what keeps the pipeline unit-testable.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getDeployStore, getStore } from '@netlify/blobs'
import { MOVE_TIMEOUT_MS } from '../../src/claude/models'
import { createClaude, type Claude, type MessagesClient } from '../../server/claude'
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

/**
 * Owner-only Claude games: their own store, kept apart from the coach's
 * counters. Same production/deploy-scoped split as `coachStore`.
 */
export function gamesStore(requestUrl: string | undefined): CoachStore {
  const options = { name: 'chess-games', consistency: 'strong' } as const
  const store = isProductionHost(requestUrl) ? getStore(options) : getDeployStore(options)
  return store as unknown as CoachStore
}

/**
 * The client that plays the moves, or null with no usable key. One attempt
 * with a bounded wait: a failed move is retried by the browser, which can
 * see the clock, not by the SDK.
 */
export function gameMessagesClient(env: Record<string, string | undefined>): MessagesClient | null {
  const config = anthropicConfig(env)
  if (!config) return null
  return new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: MOVE_TIMEOUT_MS, maxRetries: 0 })
}
