// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, test } from 'vitest'
import { COACH_MODEL, createClaude, type MessagesClient } from './claude'

function fakeClient(impl: () => Promise<unknown>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = []
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        calls.push(params)
        return (await impl()) as Anthropic.Message
      },
    },
  }
  return { calls, client }
}

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: COACH_MODEL,
  content: [{ type: 'text', text: '  Develops a piece.  ', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
  ...over,
})

const REQ = { system: 'sys', user: 'usr', maxTokens: 1024 }

describe('createClaude', () => {
  test('sends the model, prompt and limits, and returns the trimmed text', async () => {
    const f = fakeClient(async () => message())
    const r = await createClaude({ client: f.client }).complete(REQ)
    expect(r).toEqual({ ok: true, text: 'Develops a piece.' })
    expect(f.calls[0]).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
    })
  })

  test('a refusal or an empty answer is an upstream failure', async () => {
    expect(await createClaude({ client: fakeClient(async () => message({ stop_reason: 'refusal' })).client }).complete(REQ))
      .toMatchObject({ ok: false, kind: 'upstream' })
    expect(await createClaude({ client: fakeClient(async () => message({ content: [] })).client }).complete(REQ))
      .toMatchObject({ ok: false, kind: 'upstream' })
  })

  test.each([
    ['rate-limited', () => new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers())],
    ['auth', () => new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers())],
    ['timeout', () => new Anthropic.APIConnectionTimeoutError()],
    ['upstream', () => new Error('socket hang up')],
  ])('classifies %s', async (kind, makeError) => {
    const r = await createClaude({ client: fakeClient(async () => { throw makeError() }).client }).complete(REQ)
    expect(r).toMatchObject({ ok: false, kind })
  })

  test('error messages are fixed text: nothing from the SDK error (or the key) leaks through', async () => {
    const r = await createClaude({
      client: fakeClient(async () => { throw new Error('bad key sk-ant-SECRET123') }).client,
    }).complete(REQ)
    expect(JSON.stringify(r)).not.toContain('SECRET123')
  })
})
