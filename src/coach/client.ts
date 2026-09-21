import type { CoachErrorKind, HintRequest, ReviewRequest } from './protocol'

export type CoachStatus = 'unknown' | 'online' | 'offline' | 'no-key'

export interface CoachSnapshot {
  status: CoachStatus
  /** A one-time message about a Claude failure; null once dismissed. */
  notice: string | null
}

const NOTICE: Record<'rate-limited' | 'timeout' | 'auth' | 'upstream', string> = {
  'rate-limited': 'Claude is rate-limiting requests — using built-in coaching for now.',
  timeout: 'Claude took too long to answer — using built-in coaching for now.',
  auth: 'The coaching server’s API key was rejected — using built-in coaching.',
  upstream: 'Claude could not answer — using built-in coaching for now.',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function errorKindOf(payload: unknown): CoachErrorKind | null {
  if (!isRecord(payload) || !isRecord(payload['error'])) return null
  const kind = payload['error']['kind']
  return typeof kind === 'string' ? (kind as CoachErrorKind) : null
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

/**
 * The browser's only door to the coach server. Every failure resolves to
 * `null` ("use the templated fallback") — never a thrown error — so callers
 * have exactly one code path. Status feeds the "coaching offline" badge; a
 * Claude-side failure is surfaced ONCE per session through `notice`.
 */
export class CoachClient {
  private snap: CoachSnapshot = { status: 'unknown', notice: null }
  private noticeShown = false
  private readonly listeners = new Set<() => void>()
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    // Slightly above the server's 15s Claude timeout, so the server answers first.
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  readonly getSnapshot = (): CoachSnapshot => this.snap

  dismissNotice(): void {
    if (this.snap.notice !== null) this.update({ notice: null })
  }

  async checkHealth(): Promise<void> {
    try {
      const res = await this.fetchImpl('/api/health', { signal: AbortSignal.timeout(5_000) })
      const body: unknown = res.ok ? await res.json() : null
      if (!isRecord(body) || body['ok'] !== true) {
        this.update({ status: 'offline' })
        return
      }
      this.update({ status: body['claude'] === true ? 'online' : 'no-key' })
    } catch {
      this.update({ status: 'offline' })
    }
  }

  hint(req: HintRequest, signal?: AbortSignal): Promise<string | null> {
    return this.post('/api/hint', req, signal)
  }

  review(req: ReviewRequest, signal?: AbortSignal): Promise<string | null> {
    return this.post('/api/review', req, signal)
  }

  private update(patch: Partial<CoachSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const l of this.listeners) l()
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<string | null> {
    if (this.snap.status === 'no-key') return null
    if (signal?.aborted) return null

    let res: Response
    try {
      res = await this.fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: withTimeout(signal, this.timeoutMs),
      })
    } catch {
      if (signal?.aborted) return null // the caller moved on; says nothing about the server
      this.update({ status: 'offline' })
      return null
    }

    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      // Not our JSON: e.g. the dev proxy's error page while the server is down.
    }

    if (res.ok && isRecord(payload) && typeof payload['text'] === 'string' && payload['text'].trim()) {
      this.update({ status: 'online' })
      return payload['text'].trim()
    }

    const kind = errorKindOf(payload)
    if (kind === null) {
      this.update({ status: 'offline' })
      return null
    }
    if (kind === 'no-key') {
      this.update({ status: 'no-key' })
      return null
    }
    if (kind === 'bad-request') {
      console.warn(`coach server rejected ${path}:`, payload)
      return null
    }
    // A Claude-side failure: the server itself is fine.
    if (!this.noticeShown) {
      this.noticeShown = true
      this.update({ status: 'online', notice: NOTICE[kind] })
    } else {
      this.update({ status: 'online' })
    }
    return null
  }
}
