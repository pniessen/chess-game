// Whose API answers each seat, and the names that go with it. Kept out of
// ./models on purpose: models.ts is in every bundle (stored games and history
// parse its keys), while this file is imported only by the server and by UI
// code behind the CLAUDE_GAMES gate, so a public build carries no provider
// name and no key name (vite.config.ts builds; grep dist for "typesafe").
import { CLAUDE_MODELS, type ClaudeModelKey } from './models'

/** Anthropic's Messages API (server/claudeMove.ts), or TypeSafe's System One (server/jevMove.ts). */
export type ModelProvider = 'anthropic' | 'typesafe'

const PROVIDERS: Record<ClaudeModelKey, ModelProvider> = {
  fable: 'anthropic',
  opus: 'anthropic',
  sonnet: 'anthropic',
  haiku: 'anthropic',
  jev: 'typesafe',
}

export const providerOf = (key: ClaudeModelKey): ModelProvider => PROVIDERS[key]

/** The environment variable the local server needs to seat this model. */
export const keyNameFor = (key: ClaudeModelKey): string =>
  PROVIDERS[key] === 'typesafe' ? 'TYPESAFE_API_KEY' : 'ANTHROPIC_API_KEY'

/** The seat picker's name: the model's label, with its maker when the label does not say ("TypeSafe Jev"). */
export const seatLabel = (key: ClaudeModelKey): string =>
  PROVIDERS[key] === 'typesafe' ? `TypeSafe ${CLAUDE_MODELS[key].label}` : CLAUDE_MODELS[key].label
