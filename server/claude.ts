import Anthropic from '@anthropic-ai/sdk'
import type { CoachErrorKind } from '../src/coach/protocol'

export const COACH_MODEL = 'claude-sonnet-5'
export const CLAUDE_TIMEOUT_MS = 15_000

export interface ClaudeRequest {
  system: string
  user: string
  maxTokens: number
}

export type FailureKind = Exclude<CoachErrorKind, 'bad-request' | 'no-key'>

export type ClaudeResult = { ok: true; text: string } | { ok: false; kind: FailureKind; message: string }

export interface Claude {
  complete(req: ClaudeRequest): Promise<ClaudeResult>
}

/** The one SDK method we use; injectable so tests never touch the network. */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>
  }
}

/** Fixed, key-free texts: SDK error messages are never forwarded. */
const MESSAGES: Record<FailureKind, string> = {
  'rate-limited': 'Claude is rate-limiting requests.',
  timeout: 'Claude did not answer within 15 seconds.',
  auth: 'The server’s Anthropic API key was rejected.',
  upstream: 'Claude could not produce an answer.',
}

export function classifyError(err: unknown): FailureKind {
  // Timeout first: it is a subclass of the connection error family.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (err instanceof Anthropic.RateLimitError) return 'rate-limited'
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'auth'
  return 'upstream'
}

const failure = (kind: FailureKind): ClaudeResult => ({ ok: false, kind, message: MESSAGES[kind] })

export function createClaude(opts: { apiKey?: string; client?: MessagesClient }): Claude {
  const client: MessagesClient =
    opts.client ??
    new Anthropic({
      apiKey: opts.apiKey,
      // TypeScript SDK timeouts are in MILLISECONDS. No retries: 15s is the wall-clock bound.
      timeout: CLAUDE_TIMEOUT_MS,
      maxRetries: 0,
    })

  return {
    async complete(req) {
      try {
        const response = await client.messages.create({
          model: COACH_MODEL,
          max_tokens: req.maxTokens,
          // claude-sonnet-5 runs adaptive thinking when `thinking` is omitted,
          // and thinking tokens count toward max_tokens: a 1024-token hint
          // could be spent entirely on thinking. These are short plain-text
          // answers, so thinking is off and the budget is all visible text.
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        })
        // A refusal has no usable answer; a max_tokens stop is cut off
        // mid-sentence, and truncated coaching is worse than the fallback.
        if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return failure('upstream')
        const text = response.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
          .trim()
        return text ? { ok: true, text } : failure('upstream')
      } catch (err) {
        return failure(classifyError(err))
      }
    },
  }
}
