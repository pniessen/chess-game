/**
 * POST /api/review — Claude writes the post-game review.
 *
 * The pipeline (origin check, rate limit, cache, daily budget, validation,
 * Claude) is in ../lib/handler; this file only supplies the runtime.
 */
import type { Config, Context } from '@netlify/functions'
import { handleCoach } from '../lib/handler'
import { coachClaude, coachStore, netlifyEnv } from '../lib/runtime'

export default async (request: Request, context: Context): Promise<Response> => {
  const env = netlifyEnv()
  return handleCoach('review', request, {
    store: coachStore(env),
    claude: coachClaude(env),
    env,
    ip: context.ip,
  })
}

export const config: Config = { path: '/api/review' }
