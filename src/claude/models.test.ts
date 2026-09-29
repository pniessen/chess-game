import { describe, expect, test } from 'vitest'
import { CLAUDE_MODELS, costUsd, isClaudeModelKey, MOVE_TIMEOUT_MS, RESERVE_PER_GAME_USD } from './models'

describe('claude models', () => {
  test('keys map to the exact model ids', () => {
    expect(Object.fromEntries(Object.entries(CLAUDE_MODELS).map(([k, v]) => [k, v.id]))).toEqual({
      fable: 'claude-fable-5-1',
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-4-5-20251001',
    })
  })

  test('isClaudeModelKey accepts only the four keys', () => {
    for (const k of ['fable', 'opus', 'sonnet', 'haiku']) expect(isClaudeModelKey(k)).toBe(true)
    for (const v of ['claude-opus-5-5', 'toString', '__proto__', '', 1, null, undefined, {}]) {
      expect(isClaudeModelKey(v)).toBe(false)
    }
  })

  test('costUsd is usage x list price per million tokens', () => {
    const { priceIn, priceOut } = CLAUDE_MODELS.sonnet
    expect(costUsd('sonnet', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(priceIn + priceOut)
    expect(costUsd('sonnet', { input_tokens: 0, output_tokens: 0 })).toBe(0)
    expect(costUsd('fable', { input_tokens: 2000, output_tokens: 500 })).toBeCloseTo(0.02 + 0.025)
  })

  test('every model has a positive per-game reserve; the timeout is 45s', () => {
    for (const k of Object.keys(CLAUDE_MODELS) as (keyof typeof CLAUDE_MODELS)[]) {
      expect(RESERVE_PER_GAME_USD[k]).toBeGreaterThan(0)
    }
    expect(MOVE_TIMEOUT_MS).toBe(45_000)
  })
})
