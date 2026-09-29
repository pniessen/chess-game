/**
 * POST /api/game/end — owner-only Claude-vs-Claude games.
 *
 * The pipeline is in ../lib/gameHandler; this file only supplies the runtime.
 */
import type { Config } from '@netlify/functions'
import { handleGame } from '../lib/gameHandler'
import { gameMessagesClient, gamesStore, netlifyEnv } from '../lib/runtime'

export default async (request: Request): Promise<Response> => {
  const env = netlifyEnv()
  return handleGame('end', request, { store: gamesStore(), env, client: gameMessagesClient(env) })
}

export const config: Config = { path: '/api/game/end' }
