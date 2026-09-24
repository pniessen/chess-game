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
 *
 * `enabled: false` (see `useCoachClient`) skips every method's network call
 * outright, for a build with no coach server behind it.
 */
export class CoachClient {
  private snap: CoachSnapshot = { status: 'unknown', notice: null }
  private noticeShown = false
  private badRequestWarned = false
  private readonly listeners = new Set<() => void>()
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly enabled: boolean
  // Monotonic counter assigned when a request STARTS (checkHealth or post), so
  // that a status update from a request that resolves out of order — e.g. a
  // slow health check that started before a hint but resolves after it — can
  // be recognized as stale and dropped instead of clobbering a fresher result.
  private requestSeq = 0
  private lastAppliedSeq = 0

  constructor(opts: { fetch?: typeof fetch; timeoutMs?: number; enabled?: boolean } = {}) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
    // Slightly above the server's 15s Claude timeout, so the server answers first.
    this.timeoutMs = opts.timeoutMs ?? 20_000
    // False for a build with no coach server behind it (e.g. GitHub Pages):
    // every method below then short-circuits before touching `fetchImpl`.
    this.enabled = opts.enabled ?? true
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
    const seq = ++this.requestSeq
    if (!this.enabled) {
      this.setStatus(seq, 'offline')
      return
    }
    try {
      const res = await this.fetchImpl('/api/health', { signal: AbortSignal.timeout(5_000) })
      const body: unknown = res.ok ? await res.json() : null
      if (!isRecord(body) || body['ok'] !== true) {
        this.setStatus(seq, 'offline')
        return
      }
      this.setStatus(seq, body['claude'] === true ? 'online' : 'no-key')
    } catch {
      this.setStatus(seq, 'offline')
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

  /**
   * Apply a status change only if it comes from the newest request seen so
   * far. A result from an older request that resolves late (e.g. a slow
   * health check racing a hint) is dropped rather than overwriting whatever
   * a newer, already-applied request decided — in either direction: an old
   * failure must not clobber a newer success, and an old success must not
   * paper over a newer failure.
   */
  private setStatus(seq: number, status: CoachStatus, extra?: Partial<CoachSnapshot>): void {
    if (seq <= this.lastAppliedSeq) return
    this.lastAppliedSeq = seq
    this.update({ status, ...extra })
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<string | null> {
    if (!this.enabled) return null
    if (this.snap.status === 'no-key') return null
    if (signal?.aborted) return null
    const seq = ++this.requestSeq

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
      this.setStatus(seq, 'offline')
      return null
    }

    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      // Not our JSON: e.g. the dev proxy's error page while the server is down.
    }

    if (res.ok && isRecord(payload) && typeof payload['text'] === 'string' && payload['text'].trim()) {
      this.setStatus(seq, 'online')
      return payload['text'].trim()
    }

    const kind = errorKindOf(payload)
    if (kind === null) {
      this.setStatus(seq, 'offline')
      return null
    }
    if (kind === 'no-key') {
      this.setStatus(seq, 'no-key')
      return null
    }
    if (kind === 'bad-request') {
      // Our bug, not a server/Claude outage: never touches status, and is
      // only worth telling a developer about once per session (mirrors
      // noticeShown below) — not on every subsequent bad request.
      if (!this.badRequestWarned) {
        this.badRequestWarned = true
        console.warn(`coach server rejected ${path}:`, payload)
      }
      return null
    }
    // A Claude-side failure: the server itself is fine. Only flip noticeShown
    // when this result is actually going to be applied — a stale result that
    // setStatus would drop anyway must not silently burn the "shown once"
    // slot for a notice nobody ever saw.
    if (seq > this.lastAppliedSeq && !this.noticeShown) {
      this.noticeShown = true
      this.setStatus(seq, 'online', { notice: NOTICE[kind] })
    } else {
      this.setStatus(seq, 'online')
    }
    return null
  }
}
