// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { costUsd } from '../src/claude/models'
import { JEV_ENDPOINT, createJevClient, describeMove, requestJevMove } from './jevMove'

const KEY = 'test-key-not-real-0123456789'

interface Sent {
  url: string
  init: RequestInit
  body: any
}

/** A fetch that records each request and answers with `answer(body)`. */
function fakeFetch(answer: (body: any) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    sent.push({ url: String(url), init: init ?? {}, body })
    return answer(body)
  }) as typeof fetch
  return { sent, fetchImpl }
}

/** Jev's answer picking criterion `choice` with probability `p`. */
const jevReply = (choice: string, p = 0.27, usage = { input_tokens: 1000, output_tokens: 200 }) =>
  Response.json({
    model: 'jev-1.13.0',
    answers: { move: { type: 'choice', choice, probabilities: { [choice]: p }, confidence: 0.4 } },
    usage,
  })

/** The criterion key whose description starts with `san`. */
const keyOf = (body: any, san: string): string =>
  Object.entries(body.questions.move.criteria as Record<string, string>).find(([, d]) => d.startsWith(`${san}:`))![0]

describe('requestJevMove', () => {
  test('posts one choice question over the legal moves to System One, with the key as a bearer', async () => {
    const { sent, fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'e4')))
    const jev = createJevClient({ apiKey: KEY, fetch: fetchImpl })
    await requestJevMove({ jev }, { model: 'jev', history: [] })

    expect(sent).toHaveLength(1)
    const { url, init, body } = sent[0]!
    expect(url).toBe(JEV_ENDPOINT)
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(body.model).toBe('jev-latest')
    expect(body.state.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(body.state.side_to_move).toBe('White')
    expect(body.state.board).toContain('r  n  b  q  k  b  n  r')
    expect(Object.keys(body.questions)).toEqual(['move'])
    expect(body.questions.move.type).toBe('choice')
    const criteria = body.questions.move.criteria as Record<string, string>
    // The 20 opening moves, keyed m0..m19.
    expect(Object.keys(criteria)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`))
    expect(Object.values(criteria)).toContain('Nf3: knight from g1 to f3')
    // The key travels in the header only.
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  test('answers the picked move with an honest note, its cost from the input tokens and its usage', async () => {
    const { fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'Nf3'), 0.2649, { input_tokens: 1234, output_tokens: 99 }))
    const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(out).toMatchObject({
      ok: true,
      san: 'Nf3',
      why: "Jev's pick (p 0.26)",
      tokens: { inputTokens: 1234, outputTokens: 99 },
    })
    expect(out.costUsd).toBeCloseTo(costUsd('jev', { input_tokens: 1234, output_tokens: 99 }))
    expect(out.costUsd).toBeCloseTo((1234 * 0.042) / 1_000_000)
    expect(out.ms).toBeGreaterThanOrEqual(0)
  })

  test('replays the history from a startFen: Black to move after it', async () => {
    const { sent, fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'e5')))
    const out = await requestJevMove(
      { jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) },
      { model: 'jev', history: ['e4'] },
    )
    expect(out).toMatchObject({ ok: true, san: 'e5' })
    expect(sent[0]!.body.state.side_to_move).toBe('Black')
    expect(sent[0]!.body.questions.move.instructions).toContain('Black')
  })

  test('sends the game so far as numbered moves, and the instructions point at it', async () => {
    const { sent, fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'Bb5')))
    await requestJevMove(
      { jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) },
      { model: 'jev', history: ['e4', 'e5', 'Nf3', 'Nc6'] },
    )
    expect(sent[0]!.body.state.moves_so_far).toBe('1. e4 e5 2. Nf3 Nc6')
    expect(sent[0]!.body.state.start_fen).toBeUndefined()
    expect(sent[0]!.body.questions.move.instructions).toContain('`moves_so_far`')
  })

  test('the first move of a game says there are no moves yet', async () => {
    const { sent, fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'e4')))
    await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(sent[0]!.body.state.moves_so_far).toBe('(none yet)')
  })

  test('from a set-up position the moves are numbered from it, and the start is sent', async () => {
    const startFen = 'r3k3/8/8/8/3N4/8/8/4K3 b q - 0 7'
    const { sent, fetchImpl } = fakeFetch((body) => jevReply(keyOf(body, 'Ke7')))
    await requestJevMove(
      { jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) },
      { model: 'jev', startFen, history: ['Kd7', 'Nb5'] },
    )
    expect(sent[0]!.body.state.moves_so_far).toBe('7... Kd7 8. Nb5')
    expect(sent[0]!.body.state.start_fen).toBe(startFen)
  })

  test('a choice that is not one of the criteria is an illegal reply, still charged', async () => {
    const { fetchImpl } = fakeFetch(() => jevReply('m999'))
    const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'illegal-reply', tokens: { inputTokens: 1000, outputTokens: 200 } })
    expect(out.costUsd).toBeGreaterThan(0)
  })

  test('a 200 that is not the answer shape is an illegal reply, charged what its usage says', async () => {
    for (const payload of [{}, { answers: {} }, { answers: { move: { choice: 7 } } }, 'not json']) {
      const { fetchImpl } = fakeFetch(() =>
        typeof payload === 'string' ? new Response(payload, { status: 200 }) : Response.json(payload),
      )
      const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
      expect(out).toMatchObject({ ok: false, kind: 'illegal-reply', costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })
    }
  })

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limited'],
    [529, 'rate-limited'],
    [422, 'upstream'],
    [500, 'upstream'],
  ] as const)('HTTP %i is %s, free', async (status, kind) => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: { message: 'nope' } }, { status }))
    const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(out).toMatchObject({ ok: false, kind, costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })
  })

  test('a network failure is upstream, free', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'upstream', costUsd: 0 })
  })

  test('a call past the timeout is aborted and charged its estimated input', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })) as typeof fetch
    const out = await requestJevMove(
      { jev: createJevClient({ apiKey: KEY, fetch: fetchImpl, timeoutMs: 20 }) },
      { model: 'jev', history: [] },
    )
    expect(out).toMatchObject({ ok: false, kind: 'timeout' })
    expect(out.tokens!.inputTokens).toBeGreaterThan(0)
    expect(out.tokens!.outputTokens).toBe(0)
    expect(out.costUsd).toBeCloseTo(costUsd('jev', { input_tokens: out.tokens!.inputTokens, output_tokens: 0 }))
  })

  test('a timeout while the body is still arriving is a timeout too, charged its estimated input', async () => {
    // Headers arrive at once; the body never finishes before the signal fires.
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const out = await requestJevMove(
      { jev: createJevClient({ apiKey: KEY, fetch: fetchImpl, timeoutMs: 20 }) },
      { model: 'jev', history: [] },
    )
    expect(out).toMatchObject({ ok: false, kind: 'timeout' })
    expect(out.tokens!.inputTokens).toBeGreaterThan(0)
    expect(out.costUsd).toBeGreaterThan(0)
  })

  test('an illegal history or a finished game is a bad request: no call', async () => {
    const { sent, fetchImpl } = fakeFetch(() => jevReply('m0'))
    const jev = createJevClient({ apiKey: KEY, fetch: fetchImpl })
    expect(await requestJevMove({ jev }, { model: 'jev', history: ['e5'] })).toMatchObject({ ok: false, kind: 'bad-request', tokens: null })
    expect(await requestJevMove({ jev }, { model: 'jev', history: ['f3', 'e5', 'g4', 'Qh4#'] })).toMatchObject({
      ok: false,
      kind: 'bad-request',
    })
    expect(await requestJevMove({ jev }, { model: 'jev', startFen: 'garbage', history: [] })).toMatchObject({
      ok: false,
      kind: 'bad-request',
    })
    expect(sent).toHaveLength(0)
  })

  test('the key is never in an outcome', async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: { message: `bad key ${KEY}` } }, { status: 401 }))
    const out = await requestJevMove({ jev: createJevClient({ apiKey: KEY, fetch: fetchImpl }) }, { model: 'jev', history: [] })
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(JSON.stringify(createJevClient({ apiKey: KEY, fetch: fetchImpl }))).not.toContain(KEY)
  })
})

describe('describeMove', () => {
  test('captures, promotions, checks and mates in words', () => {
    expect(describeMove({ san: 'Nf3', piece: 'n', from: 'g1', to: 'f3' })).toBe('Nf3: knight from g1 to f3')
    expect(describeMove({ san: 'Bxf7+', piece: 'b', from: 'c4', to: 'f7', captured: 'p' })).toBe(
      'Bxf7+: bishop from c4 to f7, capturing a pawn, check',
    )
    expect(describeMove({ san: 'e8=Q#', piece: 'p', from: 'e7', to: 'e8', promotion: 'q' })).toBe(
      'e8=Q#: pawn from e7 to e8, promoting to queen, checkmate',
    )
    expect(describeMove({ san: 'O-O', piece: 'k', from: 'e1', to: 'g1' })).toBe('O-O: king from e1 to g1, castling')
  })
})
