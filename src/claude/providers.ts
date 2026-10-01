// Whose API answers each seat, and the names that go with it. Kept out of
// ./models on purpose: models.ts is in every bundle (stored games and history
// parse its keys), while this file is imported only by the server and by UI
// code behind the CLAUDE_GAMES gate, so a public build carries no provider
// name and no key name (vite.config.ts builds; grep dist for "typesafe").
import { CLAUDE_MODELS, type ClaudeModelKey } from './models'

/**
 * Anthropic's Messages API (server/claudeMove.ts), TypeSafe's System One
 * (server/jevMove.ts), or Google's Gemini on Vertex AI (server/geminiMove.ts).
 */
export type ModelProvider = 'anthropic' | 'typesafe' | 'vertex'

const PROVIDERS: Record<ClaudeModelKey, ModelProvider> = {
  fable: 'anthropic',
  opus: 'anthropic',
  sonnet: 'anthropic',
  haiku: 'anthropic',
  jev: 'typesafe',
  'gemini-pro': 'vertex',
  'gemini-flash': 'vertex',
}

export const providerOf = (key: ClaudeModelKey): ModelProvider => PROVIDERS[key]

const NEEDS: Record<ModelProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
  // Vertex AI takes no key here: the server signs in with Application Default Credentials.
  vertex: 'Google ADC',
}

/** What the local server needs to seat this model: an environment variable, or Google ADC for Gemini. */
export const keyNameFor = (key: ClaudeModelKey): string => NEEDS[PROVIDERS[key]]

/** The seat picker's name: the model's label, with its maker when the label does not say ("TypeSafe Jev", but "Gemini 3.6 Flash"). */
export const seatLabel = (key: ClaudeModelKey): string =>
  PROVIDERS[key] === 'typesafe' ? `TypeSafe ${CLAUDE_MODELS[key].label}` : CLAUDE_MODELS[key].label
