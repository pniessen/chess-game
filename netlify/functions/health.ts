/**
 * GET /api/health — what `CoachClient` probes on page load.
 *
 * It answers `{ ok: true, claude: <whether a key is configured> }`. With no
 * key the browser shows the "coaching offline" badge and uses its built-in
 * hints; nothing about the key's value is ever in the response.
 */
import type { Config } from '@netlify/functions'
import { handleHealth } from '../lib/handler'
import { netlifyEnv } from '../lib/runtime'

export default async (): Promise<Response> => handleHealth(netlifyEnv())

export const config: Config = { path: '/api/health' }
