/**
 * The coaching request pipeline, with no HTTP framework in it.
 *
 * Both front ends go through here so there is exactly one definition of
 * "what a hint request means": the local Express relay (`server/app.ts`,
 * `npm run server`) and the Netlify Functions (`netlify/functions/*`) that
 * serve the public site. Validation, prompt building and the Claude call
 * live in the sibling modules; this file only sequences them and maps the
 * outcome onto a status code and a body in the browser's protocol.
 */
import type { CoachErrorResponse, CoachTextResponse } from '../src/coach/protocol'
import type { Claude, ClaudeRequest } from './claude'
import { hintPrompt, reviewPrompt } from './prompts'
import { parseHintRequest, parseReviewRequest, type Parsed } from './validate'

export type CoachEndpoint = 'hint' | 'review'

export interface CoachOutcome {
  status: number
  body: CoachTextResponse | CoachErrorResponse
}

const ENDPOINTS: {
  [K in CoachEndpoint]: {
    parse: (body: unknown) => Parsed<unknown>
    prompt: (value: never) => ClaudeRequest
  }
} = {
  hint: { parse: parseHintRequest, prompt: hintPrompt as (value: never) => ClaudeRequest },
  review: { parse: parseReviewRequest, prompt: reviewPrompt as (value: never) => ClaudeRequest },
}

export const coachError = (status: number, error: CoachErrorResponse['error']): CoachOutcome => ({
  status,
  body: { error },
})

/**
 * Validate a request body and, if it is sound, ask Claude.
 *
 * `maxTokens` caps the reply length: the public Netlify deployment passes a
 * tight cap because output tokens are what a hint actually costs, while the
 * local server leaves the prompt's own budget alone.
 *
 * `beforeClaude` runs after validation but before any Claude call, and can
 * short-circuit with an outcome of its own. That is the hook the public
 * deployment hangs its cache and its spending cap on: a malformed body is
 * rejected without touching either, and only a request that is really about
 * to cost money is counted.
 */
export async function runCoach(
  endpoint: CoachEndpoint,
  body: unknown,
  claude: Claude | null,
  opts: { maxTokens?: number; beforeClaude?: () => Promise<CoachOutcome | null> } = {},
): Promise<CoachOutcome> {
  const { parse, prompt } = ENDPOINTS[endpoint]
  const parsed = parse(body)
  if (!parsed.ok) return coachError(400, { kind: 'bad-request', message: parsed.error })
  if (!claude) {
    return coachError(503, { kind: 'no-key', message: 'The coach server has no ANTHROPIC_API_KEY.' })
  }

  const short = await opts.beforeClaude?.()
  if (short) return short

  const request = prompt(parsed.value as never)
  const capped =
    opts.maxTokens === undefined ? request : { ...request, maxTokens: Math.min(request.maxTokens, opts.maxTokens) }

  const result = await claude.complete(capped)
  if (!result.ok) return coachError(503, { kind: result.kind, message: result.message })
  return { status: 200, body: { text: result.text } }
}
