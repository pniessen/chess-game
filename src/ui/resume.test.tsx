import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { planResume } from './resume'

// A scripted stand-in for EngineClient — never real Stockfish. Every search
// answers with the next scripted move (black mates with Qh4# below).
const script: string[] = []
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
      return Promise.resolve({ best: script.shift() ?? '(none)', lines: [] })
    }
    stop() {}
    dispose() {}
    onDead() {
      return () => {}
    }
  },
}))

const { App } = await import('./App')

const ONE_PLAYER_SETUP = {
  white: { kind: 'human' },
  black: { kind: 'engine', level: 1 },
  timeControl: { kind: 'untimed' },
} as const

beforeEach(() => {
  localStorage.clear()
  script.length = 0
})

describe('resume restores the ORIGINAL mode (I4)', () => {
  test('a resumed one-player game stays one-player, and a loss to the engine is scored as a LOSS', async () => {
    // 1.f3 e5 2.g4 — the engine (Black) is to move and mates with Qh4#.
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({ v: 2, pgn: '1. f3 e5 2. g4 *', setup: ONE_PLAYER_SETUP, scored: false }),
    )
    script.push('d8h4')
    render(<App />)
    fireEvent.click(screen.getByTestId('resume-accept'))

    expect(screen.getByTestId('mode')).toHaveValue('one-player')
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i))
    expect(screen.getByTestId('ply-count')).toHaveTextContent('4')

    const score = JSON.parse(localStorage.getItem('chess-game:score') ?? '{}')
    expect(score).toEqual({ wins: 0, losses: 1, draws: 0 })
  })

  test('a resumed game already marked scored is not counted again', async () => {
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({ v: 2, pgn: '1. f3 e5 2. g4 *', setup: ONE_PLAYER_SETUP, scored: true }),
    )
    script.push('d8h4')
    render(<App />)
    fireEvent.click(screen.getByTestId('resume-accept'))
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent(/checkmate/i))
    expect(localStorage.getItem('chess-game:score')).toBeNull()
  })
})

describe('planResume', () => {
  const UNTIMED = { kind: 'untimed' } as const

  test('keeps a one-player setup, deriving the panel state from it', () => {
    const plan = planResume({ ...ONE_PLAYER_SETUP, black: { kind: 'engine', level: 5 } }, true, UNTIMED)
    expect(plan.config.white).toEqual({ kind: 'human' })
    expect(plan.config.black).toEqual({ kind: 'engine', level: 5 })
    expect(plan).toMatchObject({ mode: 'one-player', level: 5, humanColor: 'white', timeControlId: 'untimed', degraded: false })
  })

  test('restores the stored time control', () => {
    const blitz = { kind: 'timed', initialMs: 180_000, incrementMs: 2_000 } as const
    const plan = planResume({ ...ONE_PLAYER_SETUP, timeControl: blitz }, true, UNTIMED)
    expect(plan.config.timeControl).toEqual(blitz)
    expect(plan.timeControlId).toBe('blitz-3-2')
  })

  test('no stored setup (old save) falls back to two-player with the current time control', () => {
    const plan = planResume(null, true, UNTIMED)
    expect(plan.mode).toBe('two-player')
    expect(plan.config.white).toEqual({ kind: 'human' })
    expect(plan.config.black).toEqual({ kind: 'human' })
    expect(plan.degraded).toBe(false)
  })

  test('an engine game with no engine available resumes two-player, flagged degraded (not scored)', () => {
    const plan = planResume(ONE_PLAYER_SETUP, false, UNTIMED)
    expect(plan.mode).toBe('two-player')
    expect(plan.degraded).toBe(true)
  })

  test('zero-player keeps both engine seats and a pace', () => {
    const plan = planResume(
      { white: { kind: 'engine', level: 2 }, black: { kind: 'engine', level: 2 }, timeControl: UNTIMED },
      true,
      UNTIMED,
    )
    expect(plan.mode).toBe('zero-player')
    expect(plan.config.engineDelayMs).toBe(500)
  })
})
