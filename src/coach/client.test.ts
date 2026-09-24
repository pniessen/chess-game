// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { CoachClient } from './client'
import type { HintRequest, ReviewRequest } from './protocol'

const HINT: HintRequest = { fen: 'x', bestMoveSan: 'e4', line: ['e4'], evaluation: '+0.3' }
const REVIEW: ReviewRequest = {
  moves: ['e4', 'e5'],
  firstMover: 'w',
  result: '*',
  opening: null,
  accuracy: { w: null, b: null },
  flagged: [],
  humanSide: 'w',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A promise this test controls the resolution of, to pin down arrival order. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('CoachClient', () => {
  test('health: online, no-key, offline', async () => {
    const online = new CoachClient({ fetch: async () => json(200, { ok: true, claude: true }) })
    await online.checkHealth()
    expect(online.getSnapshot().status).toBe('online')

    const noKey = new CoachClient({ fetch: async () => json(200, { ok: true, claude: false }) })
    await noKey.checkHealth()
    expect(noKey.getSnapshot().status).toBe('no-key')

    const down = new CoachClient({ fetch: async () => { throw new TypeError('fetch failed') } })
    await down.checkHealth()
    expect(down.getSnapshot().status).toBe('offline')
  })

  test('a hint returns Claude text and marks the coach online', async () => {
    const fetch = vi.fn(async () => json(200, { text: ' Take the centre. ' }))
    const c = new CoachClient({ fetch })
    expect(await c.hint(HINT)).toBe('Take the centre.')
    expect(c.getSnapshot()).toEqual({ status: 'online', notice: null })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/hint')
    expect(JSON.parse(String(init.body))).toEqual(HINT)
  })

  test('network failure or a proxy error page: null, offline, no notice', async () => {
    const down = new CoachClient({ fetch: async () => { throw new TypeError('fetch failed') } })
    expect(await down.hint(HINT)).toBeNull()
    expect(down.getSnapshot()).toEqual({ status: 'offline', notice: null })

    const proxy = new CoachClient({ fetch: async () => new Response('Internal Server Error', { status: 500 }) })
    expect(await proxy.hint(HINT)).toBeNull()
    expect(proxy.getSnapshot().status).toBe('offline')
  })

  test('a Claude error is surfaced once per session, not per request', async () => {
    const c = new CoachClient({
      fetch: async () => json(503, { error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } }),
    })
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().status).toBe('online')
    expect(c.getSnapshot().notice).toMatch(/rate-limiting/)
    c.dismissNotice()
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().notice).toBeNull()
  })

  test('no-key: calls are skipped entirely', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, claude: false }))
    const c = new CoachClient({ fetch })
    await c.checkHealth()
    expect(await c.hint(HINT)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1) // only the health check
  })

  test("a caller's abort returns null without changing status", async () => {
    const c = new CoachClient({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
    })
    const ctrl = new AbortController()
    const p = c.hint(HINT, ctrl.signal)
    ctrl.abort()
    expect(await p).toBeNull()
    expect(c.getSnapshot().status).toBe('unknown')
  })

  test('subscribers are told about changes', async () => {
    const c = new CoachClient({ fetch: async () => json(200, { ok: true, claude: true }) })
    const cb = vi.fn()
    const off = c.subscribe(cb)
    await c.checkHealth()
    expect(cb).toHaveBeenCalled()
    off()
  })

  test('a bad-request response is warned about once per session, not per request', async () => {
    const fetch = vi.fn(async () => json(400, { error: { kind: 'bad-request', message: 'malformed fen' } }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = new CoachClient({ fetch })
    expect(await c.hint(HINT)).toBeNull()
    expect(await c.hint(HINT)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  test('the one-time notice stays suppressed across different Claude error kinds', async () => {
    let kind: 'rate-limited' | 'auth' = 'rate-limited'
    const fetch = vi.fn(async () => json(503, { error: { kind, message: 'first failure' } }))
    const c = new CoachClient({ fetch })
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().notice).toMatch(/rate-limiting/)
    c.dismissNotice()

    kind = 'auth'
    expect(await c.hint(HINT)).toBeNull()
    expect(c.getSnapshot().notice).toBeNull() // suppressed even though the error kind changed
  })

  test('enabled: false skips every network call outright', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, claude: true }))
    const c = new CoachClient({ fetch, enabled: false })

    await c.checkHealth()
    expect(c.getSnapshot().status).toBe('offline')

    expect(await c.hint(HINT)).toBeNull()
    expect(await c.review(REVIEW)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('enabled defaults to true: behaviour is unchanged from before the flag existed', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true, claude: true }))
    const c = new CoachClient({ fetch })
    await c.checkHealth()
    expect(c.getSnapshot().status).toBe('online')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a health check started before a hint, but resolving after it succeeds, must not flip status offline', async () => {
    const health = deferred<Response>()
    const hint = deferred<Response>()
    const fetch = vi.fn((input: RequestInfo | URL) => (String(input).includes('/api/health') ? health.promise : hint.promise))
    const c = new CoachClient({ fetch })

    const healthPromise = c.checkHealth() // older request, started first
    const hintPromise = c.hint(HINT) // newer request, started second

    hint.resolve(json(200, { text: 'Take the centre.' }))
    await hintPromise
    expect(c.getSnapshot().status).toBe('online')

    health.resolve(new Response('Internal Server Error', { status: 500 })) // the stale, older result: a failure
    await healthPromise
    expect(c.getSnapshot().status).toBe('online') // must not be clobbered by the older, now-stale failure
  })

  test('a stale success must not overwrite a fresher failure', async () => {
    const health = deferred<Response>()
    const hint = deferred<Response>()
    const fetch = vi.fn((input: RequestInfo | URL) => (String(input).includes('/api/health') ? health.promise : hint.promise))
    const c = new CoachClient({ fetch })

    const hintPromise = c.hint(HINT) // older request, started first
    const healthPromise = c.checkHealth() // newer request, started second

    health.resolve(new Response('Internal Server Error', { status: 500 })) // the newer result: a failure
    await healthPromise
    expect(c.getSnapshot().status).toBe('offline')

    hint.resolve(json(200, { text: 'Take the centre.' })) // the stale, older result: a success
    await hintPromise
    expect(c.getSnapshot().status).toBe('offline') // must not be clobbered by the older, now-stale success
  })
})
