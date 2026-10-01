// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { costUsd, timeoutCostUsd } from '../src/claude/models'
import { GEMINI_THINKING_LEVEL, createVertexClient, requestGeminiMove, vertexEndpoint, type VertexAuth } from './geminiMove'

// A fake bearer: no real credential ever appears in a test.
const TOKEN = 'ya29.test-token-not-real'
const PROJECT = 'test-project'

/** ADC as the client needs it: request headers, or a failure to get them. */
const fakeAuth = (fail = false): VertexAuth & { calls: number } => {
  const auth = {
    calls: 0,
    async getRequestHeaders() {
      auth.calls++
      if (fail) throw new Error(`Could not load the default credentials ${TOKEN}`)
      return new Headers({ authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': PROJECT })
    },
  }
  return auth
}

interface Sent {
  url: string
  init: RequestInit
  body: any
}

function fakeFetch(answer: (body: any) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    sent.push({ url: String(url), init: init ?? {}, body })
    return answer(body)
  }) as typeof fetch
  return { sent, fetchImpl }
}

const usage = { promptTokenCount: 282, candidatesTokenCount: 26, thoughtsTokenCount: 96, totalTokenCount: 404 }

/** A generateContent reply whose one candidate's text is `text`. */
const geminiReply = (text: string, opts: { finishReason?: string; usageMetadata?: unknown; thought?: string } = {}) =>
  Response.json({
    candidates: [
      {
        content: {
          role: 'model',
          parts: [...(opts.thought ? [{ text: opts.thought, thought: true }] : []), { text, thoughtSignature: 'c2ln' }],
        },
        finishReason: opts.finishReason ?? 'STOP',
      },
    ],
    usageMetadata: opts.usageMetadata ?? usage,
    modelVersion: 'gemini-3.8-flash',
  })

const moveJson = (move: string, why = 'Controls the centre.') => JSON.stringify({ move, why })

const client = (fetchImpl: typeof fetch, opts: { fail?: boolean; timeoutMs?: number } = {}) =>
  createVertexClient({ project: PROJECT, auth: fakeAuth(opts.fail), fetch: fetchImpl, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) })

describe('vertexEndpoint', () => {
  // Both models are served from the global location (3.1 Pro Preview only there).
  test('the global generateContent URL of a publisher model', () => {
    expect(vertexEndpoint('poised-runner-159919', 'gemini-3.8-flash')).toBe(
      'https://aiplatform.googleapis.com/v1/projects/poised-runner-159919/locations/global/publishers/google/models/gemini-3.8-flash:generateContent',
    )
  })
})

describe('requestGeminiMove', () => {
  test('posts the Claude prompt with a JSON schema whose move enum is the legal list, at thinking level LOW', async () => {
    const { sent, fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4')))
    await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: ['e4', 'e5', 'Nf3', 'Nc6'] })

    expect(sent).toHaveLength(1)
    const { url, init, body } = sent[0]!
    expect(url).toBe(vertexEndpoint(PROJECT, 'gemini-3.8-flash'))
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('x-goog-user-project')).toBe(PROJECT)
    expect(headers.get('content-type')).toBe('application/json')
    // The credential travels in the header only.
    expect(JSON.stringify(body)).not.toContain(TOKEN)
    expect(url).not.toContain(TOKEN)

    expect(body.systemInstruction.parts[0].text).toBe(
      'You are playing chess as White. Choose one move from the list. Reply with the move and a reason of at most 20 words.',
    )
    const user: string = body.contents[0].parts[0].text
    expect(body.contents[0].role).toBe('user')
    expect(user).toContain('FEN: r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
    expect(user).toContain('Moves so far: 1. e4 e5 2. Nf3 Nc6')
    expect(user).toContain('Legal moves: ')

    const g = body.generationConfig
    expect(g.responseMimeType).toBe('application/json')
    expect(g.responseSchema.type).toBe('OBJECT')
    expect(g.responseSchema.required).toEqual(['move', 'why'])
    expect(g.responseSchema.properties.why.type).toBe('STRING')
    expect(g.responseSchema.properties.move.type).toBe('STRING')
    expect(g.responseSchema.properties.move.enum).toContain('Bb5')
    expect(g.responseSchema.properties.move.enum).toHaveLength(27)
    expect(g.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
    expect(g.maxOutputTokens).toBe(2000)
    // Gemini 3 ignores sampling parameters and rejects some others: none are sent.
    expect(g.temperature).toBeUndefined()
    expect(g.candidateCount).toBeUndefined()
  })

  test('both models use the lowest thinking level they accept, LOW (MINIMAL is refused by both)', () => {
    expect(GEMINI_THINKING_LEVEL).toEqual({ 'gemini-pro': 'LOW', 'gemini-flash': 'LOW' })
  })

  test('3.1 Pro is asked by its own id', async () => {
    const { sent, fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4')))
    await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-pro', history: [] })
    expect(sent[0]!.url).toBe(vertexEndpoint(PROJECT, 'gemini-3.1-pro-preview'))
    expect(sent[0]!.body.contents[0].parts[0].text).toContain('Moves so far: (none)')
  })

  test('answers the move and its reason; thinking tokens are counted and priced as output', async () => {
    const { fetchImpl } = fakeFetch(() => geminiReply(moveJson('Nf3', 'Develops a knight toward the centre and prepares castling on the kingside quickly.')))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-pro', history: [] })
    expect(out).toMatchObject({
      ok: true,
      san: 'Nf3',
      why: 'Develops a knight toward the centre and prepares castling on the kingside quickly.',
      tokens: { inputTokens: 282, outputTokens: 26 + 96 },
    })
    expect(out.costUsd).toBeCloseTo(costUsd('gemini-pro', { input_tokens: 282, output_tokens: 122 }))
    expect(out.costUsd).toBeCloseTo((282 * 2 + 122 * 12) / 1_000_000)
    expect(out.ms).toBeGreaterThanOrEqual(0)
  })

  test('the reason is cut to 20 words; thought parts are not the reply', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
    const { fetchImpl } = fakeFetch(() => geminiReply(moveJson('d4', long), { thought: '{"move":"h4","why":"thinking"}' }))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: true, san: 'd4' })
    if (out.ok) expect(out.why.split(' ')).toHaveLength(20)
  })

  test('without thoughtsTokenCount (no thinking happened) the output is the candidates alone', async () => {
    const { fetchImpl } = fakeFetch(() =>
      geminiReply(moveJson('e4'), { usageMetadata: { promptTokenCount: 282, candidatesTokenCount: 24, totalTokenCount: 306 } }),
    )
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: true, tokens: { inputTokens: 282, outputTokens: 24 } })
  })

  test('a move off the legal list is an illegal reply, still charged', async () => {
    const { fetchImpl } = fakeFetch(() => geminiReply(moveJson('e5')))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'illegal-reply', tokens: { inputTokens: 282, outputTokens: 122 } })
    expect(out.costUsd).toBeGreaterThan(0)
  })

  test.each(['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'])('a %s finish is an illegal reply, charged', async (finishReason) => {
    const { fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4'), { finishReason }))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'illegal-reply' })
    expect(out.costUsd).toBeGreaterThan(0)
  })

  test('a 200 that is not the reply shape is an illegal reply, charged what its usage says', async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ candidates: [], usageMetadata: usage }))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'illegal-reply', tokens: { inputTokens: 282, outputTokens: 122 } })
  })

  test('a 200 without readable usage is still billed by Google: charged the worst case, like a timeout', async () => {
    for (const payload of [{}, { candidates: [] }, { promptFeedback: { blockReason: 'SAFETY' } }, 'not json']) {
      const { fetchImpl } = fakeFetch(() =>
        typeof payload === 'string' ? new Response(payload, { status: 200 }) : Response.json(payload),
      )
      const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
      expect(out).toMatchObject({ ok: false, kind: 'illegal-reply' })
      expect(out.tokens!.inputTokens).toBeGreaterThan(0)
      expect(out.tokens!.outputTokens).toBe(2000)
      expect(out.costUsd).toBeGreaterThan(0.015)
    }
  })

  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limited'],
    [400, 'upstream'],
    [404, 'upstream'],
    [500, 'upstream'],
    [503, 'upstream'],
  ] as const)('HTTP %i is %s, free', async (status, kind) => {
    const { fetchImpl } = fakeFetch(() => Response.json({ error: { code: status, message: 'nope' } }, { status }))
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind, costUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } })
  })

  test('RESOURCE_EXHAUSTED is rate-limited whatever the status says', async () => {
    const { fetchImpl } = fakeFetch(() =>
      Response.json({ error: { code: 400, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, { status: 400 }),
    )
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'rate-limited', costUsd: 0 })
  })

  test('no Application Default Credentials is auth, free, and no request is sent (so no call is counted)', async () => {
    const { sent, fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4')))
    const out = await requestGeminiMove({ vertex: client(fetchImpl, { fail: true }) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'auth', costUsd: 0, tokens: null })
    expect(sent).toHaveLength(0)
    // Nothing from the credentials error is kept.
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  test('a network failure is upstream, free', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const out = await requestGeminiMove({ vertex: client(fetchImpl) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'upstream', costUsd: 0 })
  })

  test('a call past the timeout is aborted and charged the estimated input plus the whole output cap', async () => {
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })) as typeof fetch
    const out = await requestGeminiMove({ vertex: client(fetchImpl, { timeoutMs: 20 }) }, { model: 'gemini-pro', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'timeout' })
    expect(out.tokens!.inputTokens).toBeGreaterThan(0)
    expect(out.tokens!.outputTokens).toBe(2000)
    expect(out.costUsd).toBeCloseTo(timeoutCostUsd('gemini-pro', out.tokens!.inputTokens * 3.5, 2000), 4)
  })

  test('a timeout while the body is still arriving is a timeout too', async () => {
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const out = await requestGeminiMove({ vertex: client(fetchImpl, { timeoutMs: 20 }) }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'timeout' })
    expect(out.costUsd).toBeGreaterThan(0)
  })

  test('an illegal history or a finished game is a bad request: no call', async () => {
    const { sent, fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4')))
    const vertex = client(fetchImpl)
    expect(await requestGeminiMove({ vertex }, { model: 'gemini-flash', history: ['e5'] })).toMatchObject({
      ok: false,
      kind: 'bad-request',
      tokens: null,
    })
    expect(await requestGeminiMove({ vertex }, { model: 'gemini-flash', history: ['f3', 'e5', 'g4', 'Qh4#'] })).toMatchObject({
      ok: false,
      kind: 'bad-request',
    })
    expect(await requestGeminiMove({ vertex }, { model: 'gemini-flash', startFen: 'garbage', history: [] })).toMatchObject({
      ok: false,
      kind: 'bad-request',
    })
    expect(sent).toHaveLength(0)
  })
})

describe('createVertexClient().available', () => {
  test('true when ADC yields an authorization header; remembered, so ADC is asked once', async () => {
    const auth = fakeAuth()
    const vertex = createVertexClient({ project: PROJECT, auth, fetch: fakeFetch(() => geminiReply('')).fetchImpl })
    expect(await vertex.available()).toBe(true)
    expect(await vertex.available()).toBe(true)
    expect(auth.calls).toBe(1)
  })

  test('false without ADC, and asked again only after a pause', async () => {
    const auth = fakeAuth(true)
    let now = 1_000_000
    const vertex = createVertexClient({ project: PROJECT, auth, now: () => now })
    expect(await vertex.available()).toBe(false)
    expect(await vertex.available()).toBe(false)
    expect(auth.calls).toBe(1)
    now += 60_000
    expect(await vertex.available()).toBe(false)
    expect(auth.calls).toBe(2)
  })

  test('a move Google refuses (401/403: API off, no IAM role, wrong project) makes it unavailable for a while', async () => {
    for (const status of [401, 403]) {
      const auth = fakeAuth()
      let now = 1_000_000
      const { fetchImpl } = fakeFetch(() => Response.json({ error: { code: status } }, { status }))
      const vertex = createVertexClient({ project: PROJECT, auth, fetch: fetchImpl, now: () => now })
      expect(await vertex.available()).toBe(true)
      await requestGeminiMove({ vertex }, { model: 'gemini-flash', history: [] })
      // ADC still yields headers, but Google said no: the budget must not offer Gemini again at once.
      expect(await vertex.available()).toBe(false)
      now += 60_000
      expect(await vertex.available()).toBe(true)
    }
  })

  test('ADC that never answers is bounded by the timeout: auth on a move, unavailable on a check', async () => {
    const hanging: VertexAuth = { getRequestHeaders: () => new Promise<Headers>(() => {}) }
    const { sent, fetchImpl } = fakeFetch(() => geminiReply(moveJson('e4')))
    const vertex = createVertexClient({ project: PROJECT, auth: hanging, fetch: fetchImpl, timeoutMs: 20 })
    expect(await vertex.available()).toBe(false)
    const out = await requestGeminiMove({ vertex }, { model: 'gemini-flash', history: [] })
    expect(out).toMatchObject({ ok: false, kind: 'auth', costUsd: 0 })
    expect(sent).toHaveLength(0)
  })

  test('concurrent checks share one ADC lookup', async () => {
    const auth = fakeAuth()
    const vertex = createVertexClient({ project: PROJECT, auth })
    expect(await Promise.all([vertex.available(), vertex.available(), vertex.available()])).toEqual([true, true, true])
    expect(auth.calls).toBe(1)
  })
})
