import express, { type NextFunction, type Request, type Response } from 'express'
import { LIMITS, type CoachErrorResponse, type HealthResponse } from '../src/coach/protocol'
import type { Claude } from './claude'
import { runCoach, type CoachEndpoint } from './coach'

function sendError(res: Response, status: number, error: CoachErrorResponse['error']): void {
  res.status(status).json({ error } satisfies CoachErrorResponse)
}

/**
 * Hostnames this loopback-only relay accepts on the `Host` header. Both the
 * direct Vite dev origin (`localhost:5173`) and the proxied one
 * (`127.0.0.1:8787` — Vite's proxy forwards the browser's own Host unless
 * `changeOrigin` is set, which it isn't) must pass; any port is fine.
 */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Rejects requests whose Host header doesn't resolve to this machine, so a
 * DNS-rebinding page (a domain that resolves to 127.0.0.1) can't drive the
 * unauthenticated relay from the browser of someone who has it running.
 */
function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  try {
    return ALLOWED_HOSTNAMES.has(new URL(`http://${hostHeader}`).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function createApp(deps: { claude: Claude | null; staticDir?: string | null }) {
  const app = express()
  app.disable('x-powered-by')

  app.use('/api', (req, res, next) => {
    if (!isAllowedHost(req.headers.host)) {
      // No echo of the header: it's attacker-controlled input.
      sendError(res, 403, { kind: 'bad-request', message: 'Forbidden host.' })
      return
    }
    next()
  })
  app.use('/api', express.json({ limit: LIMITS.maxBodyBytes }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, claude: deps.claude !== null } satisfies HealthResponse)
  })

  // The pipeline itself lives in ./coach, shared with the Netlify Functions
  // that serve the public site; this is only its Express adapter. No token
  // cap here: on a developer's own machine the prompts' own budget applies.
  const relay =
    (endpoint: CoachEndpoint) =>
    async (req: Request, res: Response): Promise<void> => {
      const outcome = await runCoach(endpoint, req.body, deps.claude)
      res.status(outcome.status).json(outcome.body)
    }

  app.post('/api/hint', relay('hint'))
  app.post('/api/review', relay('review'))

  app.use('/api', (_req, res) => {
    sendError(res, 404, { kind: 'bad-request', message: 'No such endpoint.' })
  })

  // Body-parser failures (malformed JSON, oversized bodies) and anything unexpected.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = (err as { type?: string }).type
    if (type === 'entity.too.large') {
      sendError(res, 413, { kind: 'bad-request', message: 'Request body too large.' })
      return
    }
    if (type === 'entity.parse.failed') {
      sendError(res, 400, { kind: 'bad-request', message: 'Malformed JSON.' })
      return
    }
    sendError(res, 500, { kind: 'upstream', message: 'Internal error.' })
  })

  if (deps.staticDir) app.use(express.static(deps.staticDir))
  return app
}
