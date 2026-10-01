import type Anthropic from '@anthropic-ai/sdk'
import { Position } from '../src/game-core/position'
import { STARTING_FEN } from '../src/game-core/types'
import { CLAUDE_MODELS, costUsd, timeoutCostUsd, timeoutTokens, type ClaudeModelKey } from '../src/claude/models'
import { numberedMoves } from '../src/review/moveNumber'
import { classifyError, type FailureKind, type MessagesClient } from './claude'

/**
 * The call's tokens for the usage totals: the response's `usage` (output
 * includes thinking); for a timeout the estimate its cost is charged from;
 * zero for any other SDK error. Null when no call was made (a bad request).
 */
export type MoveTokens = { inputTokens: number; outputTokens: number } | null

export type MoveOutcome =
  | { ok: true; san: string; why: string; costUsd: number; ms: number; tokens: MoveTokens }
  | { ok: false; kind: 'bad-request' | 'illegal-reply' | FailureKind; costUsd: number; ms: number; tokens: MoveTokens }

/** Distributes over the union, unlike Omit. */
type WithoutMs<T> = T extends unknown ? Omit<T, 'ms'> : never

export const MAX_WHY_WORDS = 20
// Thinking tokens count toward max_tokens and cannot be switched off on the
// 5.x models, so the cap leaves room for them; the reply itself is tiny.
const MAX_TOKENS = 8000

export const cutWords = (s: string, n: number) => s.trim().split(/\s+/).filter(Boolean).slice(0, n).join(' ')

/** The model's JSON reply -> its move and reason, or null when it is not that shape. */
export function parseReply(text: string): { move: string; why: string } | null {
  try {
    const v: unknown = JSON.parse(text)
    if (typeof v !== 'object' || v === null) return null
    const { move, why } = v as { move?: unknown; why?: unknown }
    if (typeof move !== 'string') return null
    return { move, why: typeof why === 'string' ? why : '' }
  } catch {
    return null
  }
}

/**
 * The prompt every model that answers in JSON is given (Claude here, Gemini in
 * ./geminiMove): who is to move, the FEN, the numbered game so far and the
 * legal SAN list, which the caller's schema also pins the reply to. Null when
 * there is no move to ask for (an illegal history or a finished game).
 */
export function movePrompt(req: { startFen?: string; history: string[] }): { legal: string[]; system: string; user: string } | null {
  const start = Position.fromFen(req.startFen ?? STARTING_FEN)
  if (!start.ok) return null
  const firstMover = start.position.turn()

  const pos = new Position(req.startFen ?? STARTING_FEN)
  for (const san of req.history) {
    if (!pos.trySan(san).ok) return null
  }
  const legal = pos.legalSans()
  // Checkmate, stalemate and other finished positions have no move to ask for.
  if (pos.status().kind !== 'in-progress' || legal.length === 0) return null

  const side = pos.turn() === 'w' ? 'White' : 'Black'
  const system = `You are playing chess as ${side}. Choose one move from the list. Reply with the move and a reason of at most ${MAX_WHY_WORDS} words.`
  const user = [
    `FEN: ${pos.fen()}`,
    `Moves so far: ${req.history.length ? numberedMoves(req.history, firstMover) : '(none)'}`,
    `Legal moves: ${legal.join(', ')}`,
  ].join('\n')
  return { legal, system, user }
}

/**
 * Ask a Claude model for one move. The server derives the legal list itself
 * and the schema's enum pins the reply to it; the reply is checked against
 * the same list again, so a model can never inject an unlisted move.
 */
export async function requestMove(
  deps: { client: MessagesClient },
  req: { model: ClaudeModelKey; startFen?: string; history: string[] },
): Promise<MoveOutcome> {
  const started = Date.now()
  const done = (o: WithoutMs<MoveOutcome>): MoveOutcome => ({ ...o, ms: Date.now() - started }) as MoveOutcome
  const bad = () => done({ ok: false, kind: 'bad-request', costUsd: 0, tokens: null })

  const prompt = movePrompt(req)
  if (!prompt) return bad()
  const { legal, system, user } = prompt
  const model = CLAUDE_MODELS[req.model]

  const format = {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: { move: { type: 'string', enum: legal }, why: { type: 'string' } },
      required: ['move', 'why'],
      additionalProperties: false,
    },
  } as const

  let response: Anthropic.Message
  try {
    response = await deps.client.messages.create({
      model: model.id,
      max_tokens: MAX_TOKENS,
      // No `thinking` field: the 5.x models think adaptively when it is omitted
      // (and 400 on `disabled`); Haiku 4.5 simply does not think.
      output_config: {
        ...(model.effort ? { effort: model.effort } : {}),
        format,
      },
      system,
      messages: [{ role: 'user', content: user }],
    })
  } catch (err) {
    const kind = classifyError(err)
    // A timeout is the one failure the API may still bill: the call was
    // abandoned here, not refused there. Charge the worst case (see
    // timeoutCostUsd) so the monthly cap cannot be overrun by timeouts.
    // Auth, rate-limit and other errors are rejected requests: no charge.
    const promptChars = system.length + user.length + JSON.stringify(format).length
    const cost = kind === 'timeout' ? timeoutCostUsd(req.model, promptChars, MAX_TOKENS) : 0
    // Estimated, not measured: a timeout never returned its usage, so it counts the tokens it is charged for.
    const est = timeoutTokens(promptChars, MAX_TOKENS)
    const tokens =
      kind === 'timeout' ? { inputTokens: est.input_tokens, outputTokens: est.output_tokens } : { inputTokens: 0, outputTokens: 0 }
    return done({ ok: false, kind, costUsd: cost, tokens })
  }

  // A reply that arrived costs money whether or not it is usable.
  const cost = costUsd(req.model, response.usage)
  const tokens = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
  const illegal = () => done({ ok: false, kind: 'illegal-reply', costUsd: cost, tokens })
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return illegal()

  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const parsed = parseReply(text)
  if (!parsed || !legal.includes(parsed.move)) return illegal()
  return done({ ok: true, san: parsed.move, why: cutWords(parsed.why, MAX_WHY_WORDS), costUsd: cost, tokens })
}
