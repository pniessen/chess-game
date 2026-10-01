// Test fixtures for the trial's unit tests (not a test file itself).
import { Position } from '../../src/game-core/position'
import type { GameRecord } from './types'

/** A minimal finished game from SANs, haiku White and jev Black. */
export function recordOf(sans: string[], over: Partial<GameRecord> = {}): GameRecord {
  const pos = new Position()
  for (const s of sans) if (!pos.trySan(s).ok) throw new Error(`bad test move ${s}`)
  const z = { costUsd: 0, ms: 0, inputTokens: 0, outputTokens: 0, calls: 0, moves: 0, fallbacks: 0, timeouts: 0, rateLimited: 0, illegalReplies: 0 }
  const white = over.white ?? 'haiku'
  const black = over.black ?? 'jev'
  return {
    v: 1,
    trialId: 't',
    gameId: 'g1',
    round: 1,
    white,
    black,
    startedAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:10:00.000Z',
    wallMs: 600_000,
    maxPlies: 160,
    result: '*',
    winner: null,
    termination: 'checkmate',
    plies: sans.length,
    moves: sans.map((san, i) => ({
      ply: i + 1,
      side: i % 2 === 0 ? 'w' : 'b',
      model: i % 2 === 0 ? white : black,
      san,
      fallback: false,
      why: '',
      ms: 1000 * (i + 1),
      costUsd: 0.001,
      inputTokens: 100,
      outputTokens: 10,
      calls: [{ kind: 'ok', ms: 1000 * (i + 1), costUsd: 0.001, inputTokens: 100, outputTokens: 10 }],
    })),
    pgn: '',
    totals: { w: { ...z }, b: { ...z } },
    ...over,
  }
}

