import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The Score card of a Claude game, through the whole App. Vitest runs in
// mode 'test', where the build gate is off: it is opened here, and every
// /api call is answered by a stubbed fetch (nothing leaves the process).
vi.mock('../claude/enabled', () => ({ CLAUDE_GAMES: true, claudeGamesEnabled: () => true }))
vi.mock('../engine/client', () => ({
  createWorkerTransport: () => ({}),
  EngineClient: class {
    waitReady() {
      return Promise.resolve()
    }
    configure() {}
    newGame() {}
    setPosition() {}
    search() {
      return new Promise(() => {})
    }
    stop() {}
    dispose() {}
    onDead() {
      return () => {}
    }
  },
}))

const { App } = await import('./App')

const rec = (whiteModelWins: number, blackModelWins: number, draws: number) => ({
  games: whiteModelWins + blackModelWins + draws,
  whiteModelWins,
  blackModelWins,
  draws,
  whiteWins: whiteModelWins,
  blackWins: blackModelWins,
})

let ended = false
const recordUrls: string[] = []
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  localStorage.clear()
  ended = false
  recordUrls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/game/record')) {
        recordUrls.push(url)
        return json(ended ? rec(1, 2, 0) : rec(1, 1, 0))
      }
      if (url === '/api/game/start') return json({ gameId: 'g1', token: 't1', budgetLeftUsd: 10 })
      if (url === '/api/game/move') {
        return json({ san: 'Qh4#', why: 'Mate.', costUsd: 0.01, gameSpentUsd: 0.01 })
      }
      if (url === '/api/game/end') {
        ended = true
        return json({ ok: true })
      }
      if (url === '/api/game/budget') return json({ budgetLeftUsd: 10, monthlyUsd: 20 })
      return json({ error: { kind: 'bad-request', message: 'x' } }, 404)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** 1.f3 e5 2.g4, Black (Haiku) to move: its one scripted reply mates. */
function saveClaudeGameInProgress() {
  localStorage.setItem(
    'chess-game:in-progress',
    JSON.stringify({
      v: 2,
      pgn: '1. f3 e5 2. g4 *',
      setup: {
        white: { kind: 'claude', model: 'sonnet' },
        black: { kind: 'claude', model: 'haiku' },
        timeControl: { kind: 'untimed' },
        engineDelayMs: 0,
      },
      scored: false,
    }),
  )
}

describe('the Score card', () => {
  test('a normal game shows the human W–L–D and never asks for a record', () => {
    render(<App />)
    expect(screen.getByTestId('scoreboard')).toHaveTextContent(/^Score0–0–0$/)
    expect(screen.queryByTestId('claude-record')).toBeNull()
    expect(recordUrls).toEqual([])
  })

  test('a Claude game shows the head-to-head, and refreshes once the finished game has ended', async () => {
    saveClaudeGameInProgress()
    render(<App />)
    fireEvent.click(screen.getByTestId('resume-accept'))
    expect(screen.getByText('Head to head')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('claude-record')).toHaveTextContent('Sonnet 5.5 1 – 1 Haiku 4.5 · 0 draws'))
    expect(recordUrls).toEqual(['/api/game/record?white=sonnet&black=haiku'])

    // Resume begins a session; Haiku mates; the end lands; the record is read again.
    fireEvent.click(screen.getByTestId('pause'))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i))
    await waitFor(() => expect(screen.getByTestId('claude-record')).toHaveTextContent('Sonnet 5.5 1 – 2 Haiku 4.5 · 0 draws'))
    expect(recordUrls.length).toBeGreaterThanOrEqual(2)
    // The human score is untouched by a Claude game.
    expect(localStorage.getItem('chess-game:score')).toBeNull()
  })
})
