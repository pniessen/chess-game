/**
 * Which key the coach uses, and where it sends it. Pure: it takes the
 * environment as an argument and never logs, stores or returns anything but
 * what the SDK needs.
 *
 * Netlify's AI Gateway gives every function two pairs: its own
 * `NETLIFY_AI_GATEWAY_KEY`/`NETLIFY_AI_GATEWAY_URL`, which the docs say are
 * always injected, and `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` for SDKs that
 * read those names. Measured on 2026-09-29 (function logs, booleans only):
 * on a warm instance the Anthropic pair is exactly the gateway pair — same
 * key, same base URL, no path suffix — but a freshly started instance can run
 * for a few seconds with only the gateway pair. Reading the Anthropic pair
 * alone made those instances report "no key", which put the "coaching
 * offline" badge on the first load after a deploy or a quiet spell.
 *
 * Rules:
 *  - Your own `ANTHROPIC_API_KEY` (anything but the gateway's key) goes to
 *    Anthropic directly, never to the gateway's URL.
 *  - The gateway's key only ever goes to the gateway's URL — the injected
 *    `ANTHROPIC_BASE_URL`, or `NETLIFY_AI_GATEWAY_URL` when that is not
 *    there yet. With neither URL there is nowhere safe to send it: null.
 */
export interface AnthropicConfig {
  apiKey: string
  /** Undefined means Anthropic's own API. */
  baseURL: string | undefined
}

export function anthropicConfig(env: Record<string, string | undefined>): AnthropicConfig | null {
  const value = (name: string): string | undefined => env[name]?.trim() || undefined
  const gatewayKey = value('NETLIFY_AI_GATEWAY_KEY')
  const gatewayURL = value('ANTHROPIC_BASE_URL') ?? value('NETLIFY_AI_GATEWAY_URL')
  const apiKey = value('ANTHROPIC_API_KEY')

  if (apiKey && apiKey !== gatewayKey) return { apiKey, baseURL: undefined }
  if (!gatewayKey || !gatewayURL) return null
  return { apiKey: gatewayKey, baseURL: gatewayURL }
}
