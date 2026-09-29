import express, { type NextFunction, type Request, type Response } from 'express'
import { LIMITS, type CoachErrorResponse, type HealthResponse } from '../src/coach/protocol'
import type { Claude } from './claude'
import { runCoach, type CoachEndpoint } from './coach'
import type { MessagesClient } from './claude'
import { handleGame, type GameEndpoint } from '../netlify/lib/gameHandler'
import type { CoachStore } from '../netlify/lib/limits'

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

export interface GamesDeps {
  client: MessagesClient | null
  store: CoachStore
  /** Read for OWNER_TOKEN and the origin allow-list; never echoed. */
  env: Record<string, string | undefined>
}

export function createApp(deps: { claude: Claude | null; staticDir?: string | null; games?: GamesDeps }) {
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

  // Owner-only Claude games. The rules and the HTTP mapping are the Netlify
  // handler's (../netlify/lib/gameHandler); this only turns an Express request
  // into a fetch `Request` and the `Response` back.
  const games = deps.games
  if (games) {
    const game =
      (endpoint: GameEndpoint) =>
      async (req: Request, res: Response): Promise<void> => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(name, value)
        }
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
        const request = new globalThis.Request(`http://${req.headers.host ?? 'localhost'}${req.originalUrl}`, {
          method: req.method,
          headers,
          body: hasBody ? JSON.stringify(req.body ?? null) : undefined,
        })
        const response = await handleGame(endpoint, request, games)
        res
          .status(response.status)
          .type(response.headers.get('content-type') ?? 'application/json')
          .set('cache-control', 'no-store')
          .send(await response.text())
      }
    app.post('/api/game/start', game('start'))
    app.post('/api/game/move', game('move'))
    app.post('/api/game/end', game('end'))
    app.get('/api/game/budget', game('budget'))
    // Wrong method on a known path: the handler's own 405, not the generic 404.
    app.all(['/api/game/start', '/api/game/move', '/api/game/end'], game('start'))
    app.all('/api/game/budget', game('budget'))
  }

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
