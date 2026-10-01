// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { MessagesClient } from './claude'
import type { JevClient } from './jevMove'
import type { VertexClient } from './geminiMove'
import { dispatchMove, worstCaseCallUsd } from './moveDispatch'
import { costUsd } from '../src/claude/models'

const message = (text: string): Anthropic.Message =>
  ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } }) as unknown as Anthropic.Message

function fakes() {
  const seen: string[] = []
  const client: MessagesClient = {
    messages: {
      create: async (p) => {
        seen.push(`anthropic:${p.model}`)
        return message(JSON.stringify({ move: 'e4', why: 'Centre.' }))
      },
    },
  }
  const jev: JevClient = {
    systemone: async () => {
      seen.push('typesafe')
      return Response.json({ answers: { move: { choice: 'm0', probabilities: { m0: 0.5 } } }, usage: { input_tokens: 900, output_tokens: 10 } })
    },
  }
  const vertex: VertexClient = {
    available: async () => true,
    generateContent: async (id) => {
      seen.push(`vertex:${id}`)
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ move: 'd4', why: 'Centre.' }) }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 282, candidatesTokenCount: 20 },
      })
    },
  }
  return { seen, client, jev, vertex }
}

describe('dispatchMove', () => {
  test('routes each seat to its provider, as the server does', async () => {
    const { seen, client, jev, vertex } = fakes()
    for (const model of ['haiku', 'jev', 'gemini-flash', 'opus'] as const) {
      const r = await dispatchMove({ client, jev, vertex }, { model, history: [] })
      expect('outcome' in r && r.outcome.ok).toBe(true)
    }
    expect(seen).toEqual(['anthropic:claude-haiku-4-5-20251001', 'typesafe', 'vertex:gemini-3.6-flash', 'anthropic:claude-opus-5-5'])
  })

  test('a seat whose provider has no client is missing its key, and nothing is called', async () => {
    const { seen } = fakes()
    expect(await dispatchMove({ client: null }, { model: 'sonnet', history: [] })).toEqual({ missing: 'no-key' })
    expect(await dispatchMove({ client: null, jev: null }, { model: 'jev', history: [] })).toEqual({ missing: 'no-jev-key' })
    expect(await dispatchMove({ client: null }, { model: 'gemini-pro', history: [] })).toEqual({ missing: 'no-gemini-auth' })
    expect(seen).toEqual([])
  })
})

describe('worstCaseCallUsd', () => {
  test('a timed-out call at its provider\'s output cap, over a generous prompt', () => {
    expect(worstCaseCallUsd('opus')).toBeCloseTo(costUsd('opus', { input_tokens: 4000, output_tokens: 8000 }))
    expect(worstCaseCallUsd('gemini-flash')).toBeCloseTo(costUsd('gemini-flash', { input_tokens: 4000, output_tokens: 2000 }))
    expect(worstCaseCallUsd('jev')).toBeCloseTo(costUsd('jev', { input_tokens: 4000, output_tokens: 0 }))
  })
})
