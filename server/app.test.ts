// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import http, { type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CoachErrorResponse } from '../src/coach/protocol'
import { createApp } from './app'
import type { Claude, ClaudeRequest, ClaudeResult } from './claude'

let server: Server | null = null

async function start(claude: Claude | null, staticDir: string | null = null): Promise<string> {
  const app = createApp({ claude, staticDir })
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

function fakeClaude(result: ClaudeResult) {
  const calls: ClaudeRequest[] = []
  return { calls, claude: { complete: async (r: ClaudeRequest) => (calls.push(r), result) } }
}

const post = (base: string, path: string, body: unknown, raw?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })

// `fetch` treats Host as a forbidden header and silently sends the real
// connection host instead, so a DNS-rebinding Host header can only be
// simulated with a raw http.request (still hitting 127.0.0.1 — only the
// header lies, exactly as a rebound domain would).
function postWithHost(base: string, path: string, host: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const url = new URL(base + path)
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), host },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined })
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const HINT = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  bestMoveSan: 'e4',
  line: ['e4', 'e5'],
  evaluation: '+0.3',
}
const REVIEW = {
  moves: ['e4', 'e5'],
  firstMover: 'w',
  result: '*',
  opening: null,
  accuracy: { w: 100, b: 100 },
  flagged: [],
  humanSide: 'w',
}

describe('coach server', () => {
  test('health reports whether Claude is configured', async () => {
    let base = await start(null)
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, claude: false })
    await new Promise<void>((r) => server!.close(() => r()))
    base = await start(fakeClaude({ ok: true, text: 'x' }).claude)
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, claude: true })
  })

  test('a valid hint is relayed to Claude and its text returned', async () => {
    const f = fakeClaude({ ok: true, text: 'Take the centre.' })
    const base = await start(f.claude)
    const res = await post(base, '/api/hint', HINT)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'Take the centre.' })
    expect(f.calls[0]?.user).toContain(HINT.fen)
  })

  test('a valid review is relayed too', async () => {
    const f = fakeClaude({ ok: true, text: 'Good game.' })
    const base = await start(f.claude)
    const res = await post(base, '/api/review', REVIEW)
    expect(await res.json()).toEqual({ text: 'Good game.' })
  })

  test('invalid input is rejected before Claude is called', async () => {
    const f = fakeClaude({ ok: true, text: 'x' })
    const base = await start(f.claude)
    const res = await post(base, '/api/hint', { ...HINT, fen: 'nope' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as CoachErrorResponse).error.kind).toBe('bad-request')
    expect(f.calls).toHaveLength(0)
  })

  test('malformed JSON is a 400 and an oversized body a 413', async () => {
    const base = await start(fakeClaude({ ok: true, text: 'x' }).claude)
    expect((await post(base, '/api/hint', null, '{"fen":')).status).toBe(400)
    const huge = JSON.stringify({ ...HINT, padding: 'x'.repeat(40 * 1024) })
    expect((await post(base, '/api/hint', null, huge)).status).toBe(413)
  })

  test('no key: 503 no-key', async () => {
    const base = await start(null)
    const res = await post(base, '/api/hint', HINT)
    expect(res.status).toBe(503)
    expect(((await res.json()) as CoachErrorResponse).error.kind).toBe('no-key')
  })

  test('a Claude failure is a 503 carrying its kind', async () => {
    const base = await start(fakeClaude({ ok: false, kind: 'rate-limited', message: 'Claude is rate-limiting requests.' }).claude)
    const res = await post(base, '/api/review', REVIEW)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: { kind: 'rate-limited', message: 'Claude is rate-limiting requests.' } })
  })

  test('unknown API routes are JSON 404s; the built app is served when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chess-dist-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Chess</title>')
    const base = await start(null, dir)
    expect((await fetch(`${base}/api/nope`)).status).toBe(404)
    const page = await fetch(`${base}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>Chess</title>')
  })

  describe('Host header check (DNS rebinding)', () => {
    test('an attacker-controlled Host is rejected before Claude is called, with no echo of it', async () => {
      const f = fakeClaude({ ok: true, text: 'x' })
      const base = await start(f.claude)
      const res = await postWithHost(base, '/api/hint', 'attacker.example', HINT)
      expect(res.status).toBe(403)
      expect(res.json).toEqual({ error: { kind: 'bad-request', message: 'Forbidden host.' } })
      expect(JSON.stringify(res.json)).not.toContain('attacker.example')
      expect(f.calls).toHaveLength(0)
    })

    test('an attacker Host that embeds a real hostname (rebinding trick) is still rejected', async () => {
      const f = fakeClaude({ ok: true, text: 'x' })
      const base = await start(f.claude)
      const res = await postWithHost(base, '/api/hint', 'localhost.attacker.example', HINT)
      expect(res.status).toBe(403)
      expect(f.calls).toHaveLength(0)
    })

    test('the direct Vite dev origin (localhost:5173) passes', async () => {
      const f = fakeClaude({ ok: true, text: 'ok' })
      const base = await start(f.claude)
      const res = await postWithHost(base, '/api/hint', 'localhost:5173', HINT)
      expect(res.status).toBe(200)
      expect(res.json).toEqual({ text: 'ok' })
    })

    test('the proxied origin (127.0.0.1:8787, as sent when changeOrigin is set) passes', async () => {
      const f = fakeClaude({ ok: true, text: 'ok' })
      const base = await start(f.claude)
      const res = await postWithHost(base, '/api/hint', '127.0.0.1:8787', HINT)
      expect(res.status).toBe(200)
      expect(res.json).toEqual({ text: 'ok' })
    })

    test('an IPv6 loopback Host passes', async () => {
      const f = fakeClaude({ ok: true, text: 'ok' })
      const base = await start(f.claude)
      const res = await postWithHost(base, '/api/hint', '[::1]:8787', HINT)
      expect(res.status).toBe(200)
      expect(res.json).toEqual({ text: 'ok' })
    })
  })
})
