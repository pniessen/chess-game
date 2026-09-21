// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { CoachClient } from './client'
import type { HintRequest } from './protocol'

const HINT: HintRequest = { fen: 'x', bestMoveSan: 'e4', line: ['e4'], evaluation: '+0.3' }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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
})
