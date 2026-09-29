// The Claude-vs-Claude model allow-list. Dependency-free on purpose: the
// browser sends only these keys, and both the server and the UI import this file.

export type ClaudeModelKey = 'fable' | 'opus' | 'sonnet' | 'haiku'

export interface ClaudeModel {
  id: string
  label: string
  /** USD per million input tokens. */
  priceIn: number
  /** USD per million output tokens. */
  priceOut: number
  /**
   * The lowest `output_config.effort` the model accepts. Absent for Haiku 4.5:
   * the claude-api skill says `effort` errors on it, so the field is not sent.
   */
  effort?: 'low'
}

// List prices are the claude-api skill's cached table (cached 2026-09-25,
// read 2026-09-29), first-party API, standard (non-fast, non-cached) rates.
// Haiku 4.5's $1 / $5 is the skill's `claude-haiku-4-5` row; the dated id
// `claude-haiku-4-5-20251001` is the same model.
export const CLAUDE_MODELS: Record<ClaudeModelKey, ClaudeModel> = {
  fable: { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', priceIn: 10, priceOut: 50, effort: 'low' },
  opus: { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', priceIn: 4, priceOut: 20, effort: 'low' },
  sonnet: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', priceIn: 2, priceOut: 10, effort: 'low' },
  haiku: { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', priceIn: 1, priceOut: 5 },
}

export function isClaudeModelKey(v: unknown): v is ClaudeModelKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CLAUDE_MODELS, v)
}

/** Dollars for one response, from its `usage` and the list price. */
export function costUsd(key: ClaudeModelKey, usage: { input_tokens: number; output_tokens: number }): number {
  const m = CLAUDE_MODELS[key]
  return (usage.input_tokens * m.priceIn + usage.output_tokens * m.priceOut) / 1_000_000
}

/** Wall-clock bound for one move request (the SDK timeout, in ms). */
export const MOVE_TIMEOUT_MS = 45_000

/**
 * Dollars held back per side for one 80-ply game (40 moves each). Source: the
 * Claude-vs-Claude brainstorm (2026-09-29), which estimated a side at list
 * prices (skill pricing cached 2026-09-25) as fable ~$1.45, opus ~$0.58,
 * sonnet ~$0.07, haiku ~$0.04; each is x1.5, rounded up to the cent. These are
 * estimates, not measurements: Task 10 retunes them from real `usage`.
 */
export const RESERVE_PER_GAME_USD: Record<ClaudeModelKey, number> = {
  fable: 2.18,
  opus: 0.87,
  sonnet: 0.11,
  haiku: 0.06,
}
