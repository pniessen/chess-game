/**
 * Which API answers a seat's move, in one place: the local server's
 * `/api/game/move` (./gameHandler) and the round-robin trial runner
 * (scripts/trial) both ask through here, so a trial game is routed exactly
 * as a game in the app is.
 */
import { costUsd, type ClaudeModelKey } from '../src/claude/models'
import { providerOf, type ModelProvider } from '../src/claude/providers'
import type { MessagesClient } from './claude'
import { CLAUDE_MOVE_MAX_TOKENS, requestMove, type MoveOutcome } from './claudeMove'
import { requestJevMove, type JevClient } from './jevMove'
import { GEMINI_MOVE_MAX_TOKENS, requestGeminiMove, type VertexClient } from './geminiMove'

/** The provider clients a process has; null or absent when its key (or ADC) is not configured. */
export interface MoveClients {
  client: MessagesClient | null
  jev?: JevClient | null
  vertex?: VertexClient | null
}

export interface MoveRequest {
  model: ClaudeModelKey
  startFen?: string
  history: string[]
}

/** The refusal for a seat whose provider has no client. */
export type MissingKey = 'no-key' | 'no-jev-key' | 'no-gemini-auth'

const NO_KEY: Record<ModelProvider, MissingKey> = { anthropic: 'no-key', typesafe: 'no-jev-key', vertex: 'no-gemini-auth' }

/** The refusal for a seat whose provider has no key. */
export const noKeyKind = (model: ClaudeModelKey): MissingKey => NO_KEY[providerOf(model)]

/** Ask the seat's provider for one move; `missing` (and no call) when that provider has no client. */
export async function dispatchMove(clients: MoveClients, req: MoveRequest): Promise<{ outcome: MoveOutcome } | { missing: MissingKey }> {
  const provider = providerOf(req.model)
  if (provider === 'typesafe') {
    if (!clients.jev) return { missing: 'no-jev-key' }
    return { outcome: await requestJevMove({ jev: clients.jev }, req) }
  }
  if (provider === 'vertex') {
    if (!clients.vertex) return { missing: 'no-gemini-auth' }
    return { outcome: await requestGeminiMove({ vertex: clients.vertex }, req) }
  }
  if (!clients.client) return { missing: 'no-key' }
  return { outcome: await requestMove({ client: clients.client }, req) }
}

/** Each provider's output cap per move call: what a timed-out call is charged for. Jev's output is free. */
const OUTPUT_CAP: Record<ModelProvider, number> = {
  anthropic: CLAUDE_MOVE_MAX_TOKENS,
  typesafe: 0,
  vertex: GEMINI_MOVE_MAX_TOKENS,
}

/**
 * An upper bound on what one move call can be charged: the provider's whole
 * output cap over a 4,000-token prompt (a 160-ply history with the legal list
 * is under 2,000). A hard spending cap checks this before every call.
 */
export function worstCaseCallUsd(model: ClaudeModelKey): number {
  return costUsd(model, { input_tokens: 4000, output_tokens: OUTPUT_CAP[providerOf(model)] })
}
