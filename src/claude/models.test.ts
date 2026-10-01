import { describe, expect, test } from 'vitest'
import { CLAUDE_MODELS, costUsd, estimateInputTokens, isClaudeModelKey, timeoutCostUsd, MOVE_TIMEOUT_MS, RESERVE_PER_GAME_USD } from './models'

describe('claude models', () => {
  test('keys map to the exact model ids', () => {
    expect(Object.fromEntries(Object.entries(CLAUDE_MODELS).map(([k, v]) => [k, v.id]))).toEqual({
      fable: 'claude-fable-5-1',
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-4-5-20251001',
      jev: 'jev-latest',
      'gemini-pro': 'gemini-3.1-pro-preview',
      'gemini-flash': 'gemini-3.8-flash',
    })
  })

  test('isClaudeModelKey accepts only the seven keys', () => {
    for (const k of ['fable', 'opus', 'sonnet', 'haiku', 'jev', 'gemini-pro', 'gemini-flash']) expect(isClaudeModelKey(k)).toBe(true)
    for (const v of ['claude-opus-5-5', 'jev-latest', 'gemini-3.8-flash', 'gemini', 'toString', '__proto__', '', 1, null, undefined, {}]) {
      expect(isClaudeModelKey(v)).toBe(false)
    }
  })

  test('costUsd is usage x list price per million tokens', () => {
    const { priceIn, priceOut } = CLAUDE_MODELS.sonnet
    expect(costUsd('sonnet', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(priceIn + priceOut)
    expect(costUsd('sonnet', { input_tokens: 0, output_tokens: 0 })).toBe(0)
    expect(costUsd('fable', { input_tokens: 2000, output_tokens: 500 })).toBeCloseTo(0.02 + 0.025)
  })

  test('input tokens are estimated as characters / 3.5, rounded up', () => {
    expect(estimateInputTokens(0)).toBe(0)
    expect(estimateInputTokens(7)).toBe(2)
    expect(estimateInputTokens(8)).toBe(3)
    expect(estimateInputTokens(3500)).toBe(1000)
  })

  test('timeoutCostUsd charges the estimated input plus the whole output cap', () => {
    expect(timeoutCostUsd('opus', 3500, 8000)).toBeCloseTo(costUsd('opus', { input_tokens: 1000, output_tokens: 8000 }))
    expect(timeoutCostUsd('fable', 0, 8000)).toBeCloseTo(0.4)
  })

  test('every model has a positive per-game reserve; the timeout is 45s', () => {
    for (const k of Object.keys(CLAUDE_MODELS) as (keyof typeof CLAUDE_MODELS)[]) {
      expect(RESERVE_PER_GAME_USD[k]).toBeGreaterThan(0)
    }
    expect(MOVE_TIMEOUT_MS).toBe(45_000)
  })
})

describe('shortModelLabel', () => {
  test('the label without "Claude "', async () => {
    const { shortModelLabel } = await import('./models')
    expect(shortModelLabel('opus')).toBe('Opus 5.5')
    expect(shortModelLabel('haiku')).toBe('Haiku 4.5')
    expect(shortModelLabel('jev')).toBe('Jev')
    expect(shortModelLabel('gemini-pro')).toBe('Gemini 3.1 Pro')
    expect(shortModelLabel('gemini-flash')).toBe('Gemini 3.8 Flash')
  })
})

describe('Jev (TypeSafe)', () => {
  // No maker in the label: this table is in every bundle, and public builds must not name TypeSafe.
  test('is labelled plain "Jev"', () => {
    expect(CLAUDE_MODELS.jev.label).toBe('Jev')
    expect(JSON.stringify(CLAUDE_MODELS).toLowerCase()).not.toContain('typesafe')
  })

  // docs.typesafe.ai/models.md (read 2026-09-30): $0.042 per million input tokens; output tokens are free.
  test('costs $0.042 per million input tokens and nothing for output', () => {
    expect(costUsd('jev', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(0.042)
    expect(costUsd('jev', { input_tokens: 0, output_tokens: 1_000_000 })).toBe(0)
  })

  test('its reserve covers 80 moves of a 3,000-token prompt', () => {
    expect(RESERVE_PER_GAME_USD.jev).toBeGreaterThanOrEqual(costUsd('jev', { input_tokens: 80 * 3000, output_tokens: 0 }))
    expect(RESERVE_PER_GAME_USD.jev).toBeLessThanOrEqual(0.05)
  })
})

describe('Gemini (Vertex AI)', () => {
  test('two seats, labelled by Google\'s own names', () => {
    expect(CLAUDE_MODELS['gemini-pro'].label).toBe('Gemini 3.1 Pro')
    expect(CLAUDE_MODELS['gemini-flash'].label).toBe('Gemini 3.8 Flash')
  })

  // cloud.google.com/vertex-ai/generative-ai/pricing (read 2026-10-01), global endpoint, <= 200K input:
  // 3.1 Pro Preview $2 in / $12 out; 3.8 Flash $1.50 / $7.50 standard (introductory $0.75 / $3.75
  // through 2026-12-31: the ledger charges the standard price, so it never under-counts).
  // "Text output (response and reasoning)": thinking tokens are billed as output.
  test('list prices per million tokens', () => {
    expect(costUsd('gemini-pro', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(2)
    expect(costUsd('gemini-pro', { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(12)
    expect(costUsd('gemini-flash', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(1.5)
    expect(costUsd('gemini-flash', { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(7.5)
  })

  test('the gate that keeps them out of public builds is the CLAUDE_GAMES rule, plus the server', async () => {
    const { localModelsIncluded } = await import('./models')
    expect(localModelsIncluded({ MODE: 'development' })).toBe(true)
    expect(localModelsIncluded({ MODE: 'production', VITE_CLAUDE_GAMES: 'on' })).toBe(true)
    expect(localModelsIncluded({ MODE: 'production' })).toBe(false)
    expect(localModelsIncluded({ MODE: 'production', VITE_CLAUDE_GAMES: 'off' })).toBe(false)
    // The local server runs under tsx, where import.meta.env does not exist.
    expect(localModelsIncluded(undefined)).toBe(true)
  })
})
