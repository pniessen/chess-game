import express, { type NextFunction, type Request, type Response } from 'express'
import { LIMITS, type CoachErrorResponse, type HealthResponse } from '../src/coach/protocol'
import type { Claude, ClaudeRequest } from './claude'
import { hintPrompt, reviewPrompt } from './prompts'
import { parseHintRequest, parseReviewRequest, type Parsed } from './validate'

function sendError(res: Response, status: number, error: CoachErrorResponse['error']): void {
  res.status(status).json({ error } satisfies CoachErrorResponse)
}

export function createApp(deps: { claude: Claude | null; staticDir?: string | null }) {
  const app = express()
  app.disable('x-powered-by')
  app.use('/api', express.json({ limit: LIMITS.maxBodyBytes }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, claude: deps.claude !== null } satisfies HealthResponse)
  })

  const relay =
    <T>(parse: (body: unknown) => Parsed<T>, prompt: (value: T) => ClaudeRequest) =>
    async (req: Request, res: Response): Promise<void> => {
      const parsed = parse(req.body)
      if (!parsed.ok) {
        sendError(res, 400, { kind: 'bad-request', message: parsed.error })
        return
      }
      if (!deps.claude) {
        sendError(res, 503, { kind: 'no-key', message: 'The coach server has no ANTHROPIC_API_KEY.' })
        return
      }
      const result = await deps.claude.complete(prompt(parsed.value))
      if (!result.ok) {
        sendError(res, 503, { kind: result.kind, message: result.message })
        return
      }
      res.json({ text: result.text })
    }

  app.post('/api/hint', relay(parseHintRequest, hintPrompt))
  app.post('/api/review', relay(parseReviewRequest, reviewPrompt))

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
