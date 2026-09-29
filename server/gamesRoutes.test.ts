// @vitest-environment node
import http, { type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { createApp } from './app'
import type { MessagesClient } from './claude'
import { memoryStore } from './memoryStore'

let server: Server | null = null
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

const client: MessagesClient = {
  messages: {
    create: async () =>
      ({
        content: [{ type: 'text', text: JSON.stringify({ move: 'e4', why: 'Centre.' }) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 100 },
      }) as unknown as Anthropic.Message,
  },
}

async function start(withGames = true): Promise<string> {
  const app = createApp({
    claude: null,
    games: withGames ? { client, store: memoryStore(), secret: Buffer.from('fake-process-secret') } : undefined,
  })
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function send(base: string, method: string, path: string, body?: unknown, host?: string, origin = 'http://localhost:5173') {
  const url = new URL(base + path)
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          origin,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(host ? { host } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const t = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, json: t ? JSON.parse(t) : undefined })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

describe('the game routes on the local relay', () => {
  test('start, move, budget and end are wired', async () => {
    const base = await start()
    const s = await send(base, 'POST', '/api/game/start', { white: 'haiku', black: 'haiku' })
    expect(s.status).toBe(200)
    const { gameId, token } = s.json
    const m = await send(base, 'POST', '/api/game/move', { gameId, token, history: [] })
    expect(m.status).toBe(200)
    expect(m.json.san).toBe('e4')
    const b = await send(base, 'GET', '/api/game/budget')
    expect(b.status).toBe(200)
    expect(b.json.budgetLeftUsd).toBeLessThan(20)
    const e = await send(base, 'POST', '/api/game/end', { gameId, token, pgn: '1. e4 *', fallbacks: { w: 0, b: 0 } })
    expect(e.status).toBe(200)
  })

  test('a non-loopback Origin is refused', async () => {
    const base = await start()
    const r = await send(base, 'POST', '/api/game/start', { white: 'haiku', black: 'haiku' }, undefined, 'https://evil.example')
    expect(r.status).toBe(403)
  })

  test('a non-loopback Host is refused before the handler', async () => {
    const base = await start()
    const r = await send(base, 'GET', '/api/game/budget', undefined, 'attacker.example')
    expect(r.status).toBe(403)
    expect(r.json.error.message).toBe('Forbidden host.')
  })

  test('without games configured the routes are 404 like any unknown /api path', async () => {
    const base = await start(false)
    const r = await send(base, 'GET', '/api/game/budget')
    expect(r.status).toBe(404)
  })
})
