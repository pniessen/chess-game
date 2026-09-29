import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchController } from '../../match/controller'
import type { MatchConfig } from '../../match/types'
import { DEFAULT_SETTINGS } from '../../storage/storage'
import { useMatchLifecycle } from './useMatchLifecycle'
import { useClaudeSession } from './useClaudeSession'
import { fakeMover, silentEngine, type FakeMover } from './claudeTestKit'

const HUMANS: MatchConfig = { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }

function harness(mover: FakeMover, opts: { pendingResume?: unknown; engineAvailable?: boolean } = {}) {
  const controller = new MatchController({ engine: silentEngine(), claude: mover })
  controller.start(HUMANS)
  const records = {
    pendingResume: opts.pendingResume ?? null,
    setResumeChoice: vi.fn(),
    scoredRef: { current: false },
    recordedRef: { current: false },
    historyRef: { current: null },
  }
  const hook = renderHook(() => {
    const claude = useClaudeSession(controller, mover)
    const lifecycle = useMatchLifecycle({
      controller,
      settings: DEFAULT_SETTINGS,
      updateSettings: vi.fn(),
      engineAvailable: opts.engineAvailable ?? true,
      records: records as Parameters<typeof useMatchLifecycle>[0]['records'],
      resetInput: vi.fn(),
      onMatchReset: vi.fn(),
      onShowMoves: vi.fn(),
      claude,
    })
    return { claude, lifecycle }
  })
  return { controller, ...hook }
}

/** Let the begin() promise and its continuation settle. */
const settle = () => act(async () => {})

async function startClaudeGame(h: ReturnType<typeof harness>) {
  act(() => {
    h.result.current.lifecycle.choices.setMode('claude-vs-claude')
    h.result.current.lifecycle.choices.setClaudeWhite('opus')
    h.result.current.lifecycle.choices.setClaudeBlack('haiku')
  })
  act(() => h.result.current.lifecycle.handleNewGame())
  await settle()
}

beforeEach(() => localStorage.clear())

describe('New game in Claude vs Claude', () => {
  test('begins with the two models, and only then starts the match', async () => {
    const mover = fakeMover({ autoBegin: null })
    const h = harness(mover)
    act(() => h.result.current.lifecycle.choices.setMode('claude-vs-claude'))
    act(() => h.result.current.lifecycle.choices.setClaudeWhite('fable'))
    act(() => h.result.current.lifecycle.handleNewGame())
    expect(mover.begin).toHaveBeenCalledWith('fable', 'haiku')
    // Nothing has started while begin() is outstanding: still the human game.
    expect(h.controller.snapshot().config.white.kind).toBe('human')
    expect(mover.move).not.toHaveBeenCalled()
    await act(async () => mover.begins[0]!({ ok: true, budgetLeftUsd: 19 }))
    expect(h.controller.snapshot().config.white).toEqual({ kind: 'claude', model: 'fable' })
    expect(mover.log.indexOf('begin')).toBeLessThan(mover.log.indexOf('move'))
  })

  test.each(['busy', 'budget', 'forbidden', 'unavailable'] as const)(
    'a failed begin (%s) starts nothing and reports why',
    async (kind) => {
      const mover = fakeMover({ autoBegin: { ok: false, kind } })
      const h = harness(mover)
      await startClaudeGame(h)
      expect(h.controller.snapshot().config.white.kind).toBe('human')
      expect(mover.move).not.toHaveBeenCalled()
      expect(h.result.current.claude.error).toBe(kind)
      act(() => h.result.current.claude.dismissError())
      expect(h.result.current.claude.error).toBeNull()
    },
  )

  // Red if a second Claude game is begun over an open session without end().
  test('a new Claude game replacing a running one ends the first with its record', async () => {
    const mover = fakeMover()
    const h = harness(mover)
    await startClaudeGame(h)
    mover.log.length = 0
    mover.ends.length = 0
    act(() => h.result.current.lifecycle.handleNewGame())
    await settle()
    expect(mover.log.slice(0, 2)).toEqual(['end', 'begin'])
    expect(mover.ends[0]!.pgn).toContain('[White "Claude Opus 5.5"]')
  })

  test('a human game replacing a Claude game ends the Claude session', async () => {
    const mover = fakeMover()
    const h = harness(mover)
    await startClaudeGame(h)
    const endsBefore = mover.ends.length
    act(() => h.result.current.lifecycle.choices.setMode('two-player'))
    act(() => h.result.current.lifecycle.handleNewGame())
    expect(mover.ends.length).toBe(endsBefore + 1)
    expect(h.controller.snapshot().config.white.kind).toBe('human')
  })

  test('a begin overtaken by a human game is ended when it lands, and starts nothing', async () => {
    const mover = fakeMover({ autoBegin: null })
    const h = harness(mover)
    act(() => h.result.current.lifecycle.choices.setMode('claude-vs-claude'))
    act(() => h.result.current.lifecycle.handleNewGame())
    act(() => h.result.current.lifecycle.choices.setMode('two-player'))
    act(() => h.result.current.lifecycle.handleNewGame())
    const endsBefore = mover.ends.length
    await act(async () => mover.begins[0]!({ ok: true, budgetLeftUsd: 5 }))
    expect(h.controller.snapshot().config.white.kind).toBe('human')
    expect(mover.ends.length).toBe(endsBefore + 1)
    expect(mover.move).not.toHaveBeenCalled()
  })
})

describe('ending the session', () => {
  test('a finished Claude game is ended once, with its PGN and fallbacks', async () => {
    const mover = fakeMover()
    const h = harness(mover)
    await startClaudeGame(h)
    const endsBefore = mover.ends.length
    act(() => h.controller.finishAs('resign', 'b'))
    act(() => h.controller.finishAs('resign', 'b'))
    expect(mover.ends.length).toBe(endsBefore + 1)
    expect(mover.ends.at(-1)).toEqual({ pgn: expect.stringContaining('[Result "0-1"]'), fallbacks: { w: 0, b: 0 } })
  })

  test('pagehide ends an open session', async () => {
    const mover = fakeMover()
    const h = harness(mover)
    await startClaudeGame(h)
    const endsBefore = mover.ends.length
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(mover.ends.length).toBe(endsBefore + 1)
  })

  test('pagehide with no open session sends nothing', () => {
    const mover = fakeMover()
    harness(mover)
    window.dispatchEvent(new Event('pagehide'))
    expect(mover.end).not.toHaveBeenCalled()
  })
})

describe('Rematch of a Claude game', () => {
  async function finishedClaudeGame(mover: FakeMover) {
    const h = harness(mover)
    await startClaudeGame(h)
    act(() => h.controller.finishAs('resign', 'w'))
    mover.log.length = 0
    return h
  }

  // Red if the rematch starts (and so asks Claude to move) before begin() is ok.
  test('begins the same two models before starting, and never moves first', async () => {
    const mover = fakeMover({ autoBegin: null })
    const h = harness(mover)
    act(() => h.result.current.lifecycle.choices.setMode('claude-vs-claude'))
    act(() => h.result.current.lifecycle.handleNewGame())
    await act(async () => mover.begins[0]!({ ok: true, budgetLeftUsd: 5 }))
    act(() => h.controller.finishAs('resign', 'w'))
    mover.log.length = 0
    act(() => h.result.current.lifecycle.handleRematch())
    // begin() first lets the finished game's end() settle, so it is sent a tick later.
    await settle()
    expect(mover.log).toEqual(['begin'])
    expect(h.controller.snapshot().phase.kind).toBe('finished')
    await act(async () => mover.begins[1]!({ ok: true, budgetLeftUsd: 5 }))
    expect(mover.begin).toHaveBeenLastCalledWith('haiku', 'haiku')
    expect(h.controller.snapshot().phase.kind).toBe('engine-thinking')
    expect(mover.log).toEqual(['begin', 'move'])
  })

  test('a failed rematch begin starts nothing and says why', async () => {
    const mover = fakeMover()
    const h = await finishedClaudeGame(mover)
    ;(mover.begin as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, kind: 'budget' })
    act(() => h.result.current.lifecycle.handleRematch())
    await settle()
    expect(h.controller.snapshot().phase.kind).toBe('finished')
    expect(mover.move).toHaveBeenCalledTimes(1) // only the first game's opening ask
    expect(h.result.current.claude.error).toBe('budget')
  })

  test('the panel shows the rematched models', async () => {
    const mover = fakeMover()
    const h = await finishedClaudeGame(mover)
    act(() => h.result.current.lifecycle.choices.setClaudeWhite('fable'))
    act(() => h.result.current.lifecycle.handleRematch())
    await settle()
    expect(h.result.current.lifecycle.choices.claudeWhite).toBe('opus')
    expect(h.result.current.lifecycle.choices.mode).toBe('claude-vs-claude')
  })
})

describe('resuming a paused Claude game', () => {
  const SAVED = {
    pgn: '1. e4 e5 *',
    setup: { white: { kind: 'claude', model: 'sonnet' }, black: { kind: 'claude', model: 'fable' }, timeControl: { kind: 'untimed' } },
    scored: false,
    recorded: false,
  }

  function resumed(mover: FakeMover) {
    const h = harness(mover, { pendingResume: SAVED })
    act(() => h.result.current.lifecycle.handleResumeAccept())
    mover.log.length = 0
    return h
  }

  test('loads paused, in its own mode, with its models, orientation white', () => {
    const mover = fakeMover()
    const h = resumed(mover)
    expect(h.controller.snapshot().phase.kind).toBe('paused')
    expect(h.result.current.lifecycle.choices.mode).toBe('claude-vs-claude')
    expect(h.result.current.lifecycle.choices.claudeWhite).toBe('sonnet')
    expect(h.result.current.lifecycle.choices.claudeBlack).toBe('fable')
    expect(h.result.current.lifecycle.orientation).toBe('white')
    expect(mover.begin).not.toHaveBeenCalled()
  })

  test.each(['resume', 'step'] as const)('the first %s begins, then plays', async (action) => {
    const mover = fakeMover({ autoBegin: null })
    const h = resumed(mover)
    const run = vi.fn(() => (action === 'resume' ? h.controller.resume() : h.controller.step()))
    act(() => h.result.current.lifecycle.withClaudeSession(run))
    expect(mover.begin).toHaveBeenCalledWith('sonnet', 'fable')
    expect(run).not.toHaveBeenCalled()
    await act(async () => mover.begins[0]!({ ok: true, budgetLeftUsd: 5 }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(mover.log).toEqual(['begin', 'move'])
  })

  test('a failed begin stays paused and says why', async () => {
    const mover = fakeMover({ autoBegin: { ok: false, kind: 'busy' } })
    const h = resumed(mover)
    const run = vi.fn()
    act(() => h.result.current.lifecycle.withClaudeSession(run))
    await settle()
    expect(run).not.toHaveBeenCalled()
    expect(h.controller.snapshot().phase.kind).toBe('paused')
    expect(h.result.current.claude.error).toBe('busy')
  })

  test('with the session already open, Resume does not begin again', async () => {
    const mover = fakeMover()
    const h = resumed(mover)
    act(() => h.result.current.lifecycle.withClaudeSession(() => h.controller.resume()))
    await settle()
    act(() => h.controller.pause())
    mover.log.length = 0
    const run = vi.fn()
    act(() => h.result.current.lifecycle.withClaudeSession(run))
    expect(run).toHaveBeenCalledTimes(1)
    expect(mover.log).toEqual([])
  })

  test('a session idle past the lock limit reads closed: Resume ends it, begins again, then plays', async () => {
    const mover = fakeMover()
    const h = resumed(mover)
    act(() => h.result.current.lifecycle.withClaudeSession(() => h.controller.resume()))
    await settle()
    expect(h.result.current.claude.isOpen()).toBe(true)
    await act(async () => mover.moves[0]!.resolve({ ok: true, san: 'Nf3', why: 'x', costUsd: 0.4, gameSpentUsd: 0.4 }))
    act(() => h.controller.pause())
    expect(h.controller.snapshot().claude.spentUsd).toBeCloseTo(0.4)
    mover.fresh = false
    expect(h.result.current.claude.isOpen()).toBe(false)
    mover.log.length = 0
    const run = vi.fn(() => h.controller.resume())
    act(() => h.result.current.lifecycle.withClaudeSession(run))
    await settle()
    expect(mover.log.slice(0, 2)).toEqual(['end', 'begin'])
    expect(run).toHaveBeenCalledTimes(1)
    // The new server game's spend starts from zero: the meter is reset, not max(old, new).
    expect(h.controller.snapshot().claude.spentUsd).toBe(0)
  })

  // Red if a human or engine game's Resume stops being synchronous.
  test('a game with no Claude seat runs at once, without begin', () => {
    const mover = fakeMover()
    const h = harness(mover)
    const run = vi.fn()
    act(() => h.result.current.lifecycle.withClaudeSession(run))
    expect(run).toHaveBeenCalledTimes(1)
    expect(mover.begin).not.toHaveBeenCalled()
  })
})

describe('the server lock: end() must land before the next begin()', () => {
  /**
   * Like the server: begin answers busy while a game is open, and only a
   * completed end releases it. Each end resolves by hand, so the race the
   * real network allows is under the test's control.
   */
  function lockedMover(): FakeMover & { pendingEnds: Array<() => void> } {
    const m = fakeMover() as FakeMover & { pendingEnds: Array<() => void> }
    let locked = false
    m.pendingEnds = []
    m.begin = vi.fn(async () => {
      m.log.push('begin')
      if (locked) return { ok: false as const, kind: 'busy' as const }
      locked = true
      return { ok: true as const, budgetLeftUsd: 10 }
    })
    m.end = vi.fn((record) => {
      m.log.push('end')
      m.ends.push(record)
      return new Promise<void>((resolve) =>
        m.pendingEnds.push(() => {
          locked = false
          resolve()
        }),
      )
    })
    return m
  }

  // Red if begin() is sent while the old game's end is still on its way.
  test('replacing a running Claude game begins the new one and never shows busy', async () => {
    const mover = lockedMover()
    const h = harness(mover)
    await startClaudeGame(h)
    const first = h.controller.snapshot().game
    act(() => h.result.current.lifecycle.choices.setClaudeWhite('fable'))
    act(() => h.result.current.lifecycle.handleNewGame())
    await settle()
    // The end is out; begin waits for it.
    expect(mover.log.slice(-1)).toEqual(['end'])
    await act(async () => mover.pendingEnds.shift()!())
    await settle()
    expect(h.result.current.claude.error).toBeNull()
    expect(h.controller.snapshot().game).not.toBe(first)
    expect(h.controller.snapshot().config.white).toEqual({ kind: 'claude', model: 'fable' })
  })

  test('a begin right after a finish waits for the finish end too', async () => {
    const mover = lockedMover()
    const h = harness(mover)
    await startClaudeGame(h)
    act(() => h.controller.finishAs('resign', 'w'))
    act(() => h.result.current.lifecycle.handleRematch())
    await settle()
    expect(mover.log.at(-1)).toBe('end')
    await act(async () => mover.pendingEnds.shift()!())
    await settle()
    expect(h.result.current.claude.error).toBeNull()
    expect(h.controller.snapshot().phase.kind).toBe('engine-thinking')
  })
})
