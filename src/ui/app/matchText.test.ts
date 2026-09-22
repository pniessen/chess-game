import { describe, expect, test } from 'vitest'
import type { MatchConfig, MatchPhase } from '../../match/types'
import { describeResult, resignableSide } from './matchText'

const inProgress = { kind: 'in-progress', inCheck: false } as const
const human = { kind: 'human' } as const
const engine = { kind: 'engine', level: 3 } as const
const untimed = { kind: 'untimed' } as const

describe('describeResult', () => {
  // Breaks if the banner is derived from status.kind instead of phase.reason/winner.
  test('a resignation reads from phase.winner even though the rules status is in-progress', () => {
    const phase: MatchPhase = { kind: 'finished', status: inProgress, reason: 'resign', winner: 'b' }
    expect(describeResult(phase, inProgress)).toBe('White resigns — Black wins')
  })

  test('checkmate, draws, flags and engine errors', () => {
    const mate: MatchPhase = { kind: 'finished', status: { kind: 'checkmate', winner: 'w' }, reason: 'normal', winner: 'w' }
    expect(describeResult(mate, inProgress)).toBe('Checkmate — White wins')
    const stale: MatchPhase = {
      kind: 'finished',
      status: { kind: 'draw', reason: 'stalemate' },
      reason: 'normal',
      winner: null,
    }
    expect(describeResult(stale, inProgress)).toBe('Draw — stalemate')
    expect(describeResult({ kind: 'finished', status: inProgress, reason: 'flag', winner: 'b' }, inProgress)).toBe(
      'Black wins on time',
    )
    expect(describeResult({ kind: 'finished', status: inProgress, reason: 'flag', winner: null }, inProgress)).toBe(
      'Draw on time',
    )
    expect(
      describeResult({ kind: 'finished', status: inProgress, reason: 'engine-error', winner: null }, inProgress),
    ).toBe('Game halted — engine error')
  })

  // Breaks if a finished banner starts following the browsed (displayed) position.
  test('only an unfinished game shows the displayed position’s check', () => {
    expect(describeResult({ kind: 'awaiting-human', side: 'w' }, { kind: 'in-progress', inCheck: true })).toBe('Check')
    expect(describeResult({ kind: 'awaiting-human', side: 'w' }, inProgress)).toBe('')
  })
})

describe('resignableSide', () => {
  const cfg = (white: MatchConfig['white'], black: MatchConfig['black']): MatchConfig => ({
    white,
    black,
    timeControl: untimed,
  })

  test('hotseat: only the side to move, and only while awaiting a human', () => {
    expect(resignableSide(cfg(human, human), { kind: 'awaiting-human', side: 'b' })).toBe('b')
    expect(resignableSide(cfg(human, human), { kind: 'paused' })).toBeNull()
  })

  test('one-player: the human seat, whoever is to move', () => {
    expect(resignableSide(cfg(engine, human), { kind: 'engine-thinking', side: 'w', requestId: 1 })).toBe('b')
    expect(resignableSide(cfg(human, engine), { kind: 'idle' })).toBe('w')
  })

  test('zero-player: nobody', () => {
    expect(resignableSide(cfg(engine, engine), { kind: 'awaiting-human', side: 'w' })).toBeNull()
  })
})
