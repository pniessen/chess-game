import { describe, expect, test } from 'vitest'
import { Game } from '../../game-core/game'
import { importPgn } from '../../game-core/io'
import { NO_CLAUDE, type MatchSnapshot } from '../../match/types'
import { claudeRecordOf, isClaudeGame } from './claudeRecord'

function snapshotOf(over: Partial<MatchSnapshot> = {}): MatchSnapshot {
  const game = new Game()
  game.play({ from: 'e2', to: 'e4' })
  game.play({ from: 'e7', to: 'e5' })
  return {
    phase: { kind: 'paused' },
    game,
    clock: { whiteMs: 0, blackMs: 0, running: null, flagged: null },
    config: {
      white: { kind: 'claude', model: 'opus' },
      black: { kind: 'claude', model: 'haiku' },
      timeControl: { kind: 'untimed' },
    },
    claude: {
      notes: { 0: { why: 'Claim the centre.', fallback: false }, 1: { why: '', fallback: true } },
      spentUsd: 0.12,
      fallbacks: { w: 0, b: 1 },
    },
    ...over,
  } as MatchSnapshot
}

describe('claudeRecordOf', () => {
  test('the PGN names both models and carries each rationale as a comment; fallbacks are passed on', () => {
    const r = claudeRecordOf(snapshotOf())
    expect(r.fallbacks).toEqual({ w: 0, b: 1 })
    expect(r.pgn).toContain('[White "Claude Opus 5.5"]')
    expect(r.pgn).toContain('[Black "Claude Haiku 4.5"]')
    expect(r.pgn).toContain('1. e4 {Claim the centre.} e5 {Stockfish fallback}')
    expect(importPgn(r.pgn).ok).toBe(true)
  })

  test('an unfinished game is *; a finished one carries its result', () => {
    expect(claudeRecordOf(snapshotOf()).pgn).toContain('[Result "*"]')
    const won = claudeRecordOf(
      snapshotOf({ phase: { kind: 'finished', status: { kind: 'in-progress', inCheck: false }, reason: 'resign', winner: 'b' } } as Partial<MatchSnapshot>),
    )
    expect(won.pgn).toContain('[Result "0-1"]')
  })

  // The server refuses a PGN over 20,000 characters; the comments are the part to drop.
  test('a PGN that would be too long for the server drops its comments', () => {
    const long = 'x'.repeat(19_500)
    const r = claudeRecordOf(snapshotOf({ claude: { ...NO_CLAUDE, notes: { 0: { why: long, fallback: false } } } }))
    expect(r.pgn.length).toBeLessThan(20_000)
    expect(r.pgn).not.toContain('{')
  })
})

describe('isClaudeGame', () => {
  test('true only with two Claude seats', () => {
    expect(isClaudeGame(snapshotOf().config)).toBe(true)
    expect(isClaudeGame({ white: { kind: 'human' }, black: { kind: 'claude', model: 'opus' }, timeControl: { kind: 'untimed' } })).toBe(false)
    expect(isClaudeGame({ white: { kind: 'engine', level: 1 }, black: { kind: 'engine', level: 1 }, timeControl: { kind: 'untimed' } })).toBe(false)
  })
})
