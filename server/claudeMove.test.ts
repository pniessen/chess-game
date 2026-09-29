// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, test } from 'vitest'
import { CLAUDE_MODELS, costUsd, timeoutCostUsd } from '../src/claude/models'
import { requestMove } from './claudeMove'
import type { MessagesClient } from './claude'

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

const USAGE = { input_tokens: 1200, output_tokens: 300 }
const reply = (text: string, over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'x',
  content: [{ type: 'text', text, citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: USAGE,
  ...over,
})
/** Everything the request sends as input text: system, user and the schema. */
const promptCharsOf = (p: Anthropic.MessageCreateParamsNonStreaming) =>
  String(p.system).length +
  p.messages.map((m) => String(m.content)).join('').length +
  JSON.stringify(p.output_config?.format ?? null).length
const json = (move: string, why = 'Claims the centre.') => JSON.stringify({ move, why })

describe('requestMove', () => {
  test('a legal reply is ok, priced from usage, with the reason kept', async () => {
    const { client } = fakeClient(async () => reply(json('e4')))
    const r = await requestMove({ client }, { model: 'sonnet', history: [] })
    expect(r).toMatchObject({ ok: true, san: 'e4', why: 'Claims the centre.', costUsd: costUsd('sonnet', USAGE) })
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  test('the reason is trimmed and cut to 20 words', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
    const { client } = fakeClient(async () => reply(json('e4', `  ${long}  `)))
    const r = await requestMove({ client }, { model: 'haiku', history: [] })
    expect(r.ok && r.why.split(' ')).toHaveLength(20)
  })

  test('a move outside the list is illegal-reply but still costs', async () => {
    const { client } = fakeClient(async () => reply(json('e5')))
    const r = await requestMove({ client }, { model: 'opus', history: [] })
    expect(r).toMatchObject({ ok: false, kind: 'illegal-reply', costUsd: costUsd('opus', USAGE) })
  })

  test('SAN must match exactly (no check-mark or case slack)', async () => {
    const { client } = fakeClient(async () => reply(json('Nf3+')))
    const r = await requestMove({ client }, { model: 'opus', history: [] })
    expect(r).toMatchObject({ ok: false, kind: 'illegal-reply' })
  })

  test('unparseable text is illegal-reply', async () => {
    for (const text of ['e4', '{"move":', '{"why":"x"}', '{"move":4,"why":"x"}', 'null']) {
      const { client } = fakeClient(async () => reply(text))
      const r = await requestMove({ client }, { model: 'sonnet', history: [] })
      expect(r).toMatchObject({ ok: false, kind: 'illegal-reply', costUsd: costUsd('sonnet', USAGE) })
    }
  })

  test('a reply with no text block is illegal-reply', async () => {
    const { client } = fakeClient(async () => reply('', { content: [] }))
    expect(await requestMove({ client }, { model: 'sonnet', history: [] })).toMatchObject({ ok: false, kind: 'illegal-reply' })
  })

  test('max_tokens and refusal stops are illegal-reply even with valid-looking JSON', async () => {
    for (const stop_reason of ['max_tokens', 'refusal']) {
      const { client } = fakeClient(async () => reply(json('e4'), { stop_reason }))
      const r = await requestMove({ client }, { model: 'sonnet', history: [] })
      expect(r).toMatchObject({ ok: false, kind: 'illegal-reply', costUsd: costUsd('sonnet', USAGE) })
    }
  })

  test('an SDK timeout is charged the conservative estimate (the API may still bill it)', async () => {
    const { client, calls } = fakeClient(async () => {
      throw new Anthropic.APIConnectionTimeoutError()
    })
    const r = await requestMove({ client }, { model: 'sonnet', history: [] })
    const p = calls[0]!
    const promptChars = promptCharsOf(p)
    expect(r).toMatchObject({ ok: false, kind: 'timeout', costUsd: timeoutCostUsd('sonnet', promptChars, 8000) })
    // At least the whole output cap at the output price.
    expect(r.costUsd).toBeGreaterThanOrEqual((8000 * CLAUDE_MODELS.sonnet.priceOut) / 1_000_000)
  })

  test('other SDK errors are classified and cost 0', async () => {
    const cases: [unknown, string][] = [
      [new Error('boom'), 'upstream'],
      [new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers()), 'rate-limited'],
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers()), 'auth'],
      [new Anthropic.APIConnectionError({ message: 'reset' }), 'upstream'],
    ]
    for (const [err, kind] of cases) {
      const { client } = fakeClient(async () => {
        throw err
      })
      expect(await requestMove({ client }, { model: 'sonnet', history: [] }), kind).toMatchObject({ ok: false, kind, costUsd: 0 })
    }
  })

  test('illegal or finished history is bad-request and never calls the client', async () => {
    const cases = [
      { history: ['e5'] },
      { history: ['e4', 'e4'] },
      { history: ['f3', 'e5', 'g4', 'Qh4#'] }, // game over
      { history: [], startFen: 'not a fen' },
      { history: [], startFen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }, // stalemate
    ]
    for (const c of cases) {
      const { client, calls } = fakeClient(async () => reply(json('e4')))
      const r = await requestMove({ client }, { model: 'sonnet', ...c })
      expect(r, JSON.stringify(c)).toMatchObject({ ok: false, kind: 'bad-request', costUsd: 0 })
      expect(calls).toHaveLength(0)
    }
  })

  test('the request enum is the server-derived legal list; no thinking; id from the key', async () => {
    const { client, calls } = fakeClient(async () => reply(json('Nf6')))
    await requestMove({ client }, { model: 'opus', history: ['e4'] })
    const p = calls[0]!
    expect(p.model).toBe(CLAUDE_MODELS.opus.id)
    expect('thinking' in p).toBe(false)
    expect(p.max_tokens).toBe(8000)
    const format = p.output_config?.format
    expect(format?.type).toBe('json_schema')
    const props = (format!.schema as { properties: { move: { enum: string[] } } }).properties
    expect(props.move.enum).toHaveLength(20)
    expect(props.move.enum).toContain('Nf6')
    expect(props.move.enum).not.toContain('e4')
    expect(p.output_config?.effort).toBe('low')
    expect(JSON.stringify(p)).not.toContain('thinking')
    // Black to move after 1. e4, and the prompt says so and shows the FEN + numbered history.
    expect(String(p.system)).toContain('Black')
    const user = JSON.stringify(p.messages)
    expect(user).toContain('1. e4')
    expect(user).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq')
  })

  test('the id comes from the key for every model; haiku sends no effort', async () => {
    for (const key of ['fable', 'opus', 'sonnet', 'haiku'] as const) {
      const { client, calls } = fakeClient(async () => reply(json('e4')))
      await requestMove({ client }, { model: key, history: [] })
      expect(calls[0]!.model).toBe(CLAUDE_MODELS[key].id)
    }
    const { client, calls } = fakeClient(async () => reply(json('e4')))
    await requestMove({ client }, { model: 'haiku', history: [] })
    expect(calls[0]!.output_config?.effort).toBeUndefined()
  })

  test('a custom start FEN is used and a Black-first history is numbered from it', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1'
    const { client, calls } = fakeClient(async () => reply(json('e4')))
    const r = await requestMove({ client }, { model: 'sonnet', startFen: fen, history: ['e5'] })
    expect(r.ok).toBe(true)
    expect(JSON.stringify(calls[0]!.messages)).toContain('1... e5')
  })
})
