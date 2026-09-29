// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { anthropicConfig } from './anthropic'

const GATEWAY = { NETLIFY_AI_GATEWAY_KEY: 'gw-key', NETLIFY_AI_GATEWAY_URL: 'https://gw.example/ai' }

describe('anthropicConfig', () => {
  test("the gateway's injected pair is used as-is", () => {
    expect(
      anthropicConfig({ ...GATEWAY, ANTHROPIC_API_KEY: 'gw-key', ANTHROPIC_BASE_URL: 'https://gw.example/ai' }),
    ).toEqual({ apiKey: 'gw-key', baseURL: 'https://gw.example/ai' })
  })

  // Breaks if a fresh instance goes back to reporting no key. Measured on
  // 2026-09-29 (function logs): a newly started instance had
  // NETLIFY_AI_GATEWAY_KEY/URL but not yet ANTHROPIC_API_KEY/BASE_URL, and
  // on a warm one the Anthropic pair was EXACTLY the gateway pair (key
  // equal, base URL equal, no path suffix) — so the gateway pair is the
  // same credential, available sooner.
  test('a fresh instance without the Anthropic pair uses the gateway pair it already has', () => {
    expect(anthropicConfig(GATEWAY)).toEqual({ apiKey: 'gw-key', baseURL: 'https://gw.example/ai' })
  })

  test('the gateway key with only a missing base URL still goes to the gateway, never to Anthropic', () => {
    expect(anthropicConfig({ ...GATEWAY, ANTHROPIC_API_KEY: 'gw-key' })).toEqual({
      apiKey: 'gw-key',
      baseURL: 'https://gw.example/ai',
    })
  })

  test('your own key goes straight to Anthropic, never to the gateway', () => {
    expect(
      anthropicConfig({ ...GATEWAY, ANTHROPIC_API_KEY: 'sk-own', ANTHROPIC_BASE_URL: 'https://gw.example/ai' }),
    ).toEqual({ apiKey: 'sk-own', baseURL: undefined })
    expect(anthropicConfig({ ANTHROPIC_API_KEY: 'sk-own' })).toEqual({ apiKey: 'sk-own', baseURL: undefined })
  })

  test('a gateway key with no gateway URL is not used: there is nowhere safe to send it', () => {
    expect(anthropicConfig({ NETLIFY_AI_GATEWAY_KEY: 'gw-key' })).toBeNull()
  })

  test('nothing configured, or only whitespace, is null', () => {
    expect(anthropicConfig({})).toBeNull()
    expect(anthropicConfig({ ANTHROPIC_API_KEY: '  ', NETLIFY_AI_GATEWAY_KEY: ' ', NETLIFY_AI_GATEWAY_URL: 'x' })).toBeNull()
  })
})
