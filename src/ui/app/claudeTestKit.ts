// Test helpers for the Claude-vs-Claude UI: a scriptable ClaudeMover and a
// fake engine, so a real MatchController runs with no network and no worker.
import { vi } from 'vitest'
import type { BeginResult, ClaudeMover, ClaudeMoveResult, GameRecord } from '../../claude/gameClient'
import type { EngineLike } from '../../match/controller'

type MoveReq = { startFen?: string; history: string[] }

export interface FakeMover extends ClaudeMover {
  /** Every call in order, e.g. ['end', 'begin', 'move']. */
  log: string[]
  ends: GameRecord[]
  /** Pending begin() calls, resolved by hand when `autoBegin` is off. */
  begins: Array<(r: BeginResult) => void>
  moves: Array<{ req: MoveReq; resolve: (r: ClaudeMoveResult) => void }>
}

export function fakeMover(opts: { autoBegin?: BeginResult | null } = {}): FakeMover {
  const auto = opts.autoBegin === undefined ? ({ ok: true, budgetLeftUsd: 20 } as const) : opts.autoBegin
  const m: FakeMover = {
    log: [],
    ends: [],
    begins: [],
    moves: [],
    begin: vi.fn((): Promise<BeginResult> => {
      m.log.push('begin')
      return new Promise((resolve) => {
        if (auto) resolve(auto)
        else m.begins.push(resolve)
      })
    }),
    move: vi.fn((req: MoveReq): Promise<ClaudeMoveResult> => {
      m.log.push('move')
      return new Promise((resolve) => m.moves.push({ req, resolve }))
    }),
    end: vi.fn((record: GameRecord): Promise<void> => {
      m.log.push('end')
      m.ends.push(record)
      return Promise.resolve()
    }),
  }
  return m
}

/** An engine that never answers (Claude's fallback is not exercised here). */
export function silentEngine(): EngineLike {
  return {
    waitReady: () => Promise.resolve(),
    configure: () => {},
    newGame: () => {},
    setPosition: () => {},
    search: () => new Promise(() => {}),
    stop: () => {},
    dispose: () => {},
  }
}
