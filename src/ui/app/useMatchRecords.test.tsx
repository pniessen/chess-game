import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { gameFromSan } from '../../game-core/io'
import type { MatchConfig, MatchSnapshot } from '../../match/types'
import { loadHistory, loadInProgress, loadScore } from '../../storage/storage'
import { useMatchRecords } from './useMatchRecords'

const SCHOLARS_MATE = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']
const human = { kind: 'human' } as const
const engine = { kind: 'engine', level: 3 } as const
const clock = { whiteMs: 0, blackMs: 0, running: null, flagged: null }

function snapshotOf(sans: string[], config: MatchConfig, finished: boolean): MatchSnapshot {
  const built = gameFromSan(sans)
  if (!built.ok) throw new Error(built.error)
  const game = built.game
  const phase: MatchSnapshot['phase'] = finished
    ? { kind: 'finished', status: game.status(), reason: 'normal', winner: 'w' }
    : { kind: 'awaiting-human', side: game.current().turn() }
  return { phase, game, clock, config }
}

beforeEach(() => localStorage.clear())

describe('useMatchRecords', () => {
  test('an unfinished game is saved as in progress, with its seats', () => {
    const cfg: MatchConfig = { white: human, black: engine, timeControl: { kind: 'untimed' } }
    renderHook(() => useMatchRecords(snapshotOf(['e4', 'e5'], cfg, false), null))
    const saved = loadInProgress()
    expect(saved?.pgn).toContain('1. e4 e5')
    expect(saved?.setup).not.toBeNull()
  })

  // Breaks if the score is taken from the winner's colour instead of the human's point of view.
  test('a one-player finish is scored once from the human side, recorded once, and clears the save', () => {
    const cfg: MatchConfig = { white: engine, black: human, timeControl: { kind: 'untimed' } }
    const snap = snapshotOf(SCHOLARS_MATE, cfg, true)
    const { rerender, result } = renderHook(({ s }) => useMatchRecords(s, 'C20 King’s Pawn Game'), {
      initialProps: { s: snap },
    })
    // A re-render with a fresh-but-equal finished phase must not count it again.
    rerender({ s: { ...snap, phase: { ...snap.phase } } })
    expect(loadScore()).toEqual({ wins: 0, losses: 1, draws: 0 })
    expect(loadHistory()).toHaveLength(1)
    expect(loadHistory()[0]?.opening).toBe('C20 King’s Pawn Game')
    expect(loadInProgress()).toBeNull()
    expect(result.current.historyRef.current?.id).toBe(loadHistory()[0]?.id)
  })

  test('a zero-player finish is recorded but never scored', () => {
    const cfg: MatchConfig = { white: engine, black: engine, timeControl: { kind: 'untimed' } }
    renderHook(() => useMatchRecords(snapshotOf(SCHOLARS_MATE, cfg, true), null))
    expect(loadScore()).toEqual({ wins: 0, losses: 0, draws: 0 })
    expect(loadHistory()).toHaveLength(1)
  })

  // Breaks if the in-progress save runs before the resume banner is answered (it would overwrite the offer).
  test('nothing is saved while a resume offer is pending', () => {
    localStorage.setItem('chess-game:in-progress', JSON.stringify('1. d4 d5 *'))
    const cfg: MatchConfig = { white: human, black: human, timeControl: { kind: 'untimed' } }
    const { result } = renderHook(() => useMatchRecords(snapshotOf(['e4'], cfg, false), null))
    expect(result.current.resumeChoice).toBe('pending')
    expect(loadInProgress()?.pgn).toBe('1. d4 d5 *')
  })

  // Review round 1 (Task 14), Important finding: the scoring effect's
  // clearInProgress() was NOT gated by resumeChoice the way the autosave
  // effect (immediately above) already is — so a DIFFERENT match finishing
  // (a share-accept, or simply ignoring the banner and starting a new game)
  // silently wiped the still-unresolved saved game out of storage. Scoring
  // and history recording are about the match that ACTUALLY finished, not
  // the stale offer, so they still happen; only the clear is deferred.
  test('a different match finishing while a resume offer is unresolved still scores, but does not clear the saved game', () => {
    localStorage.setItem(
      'chess-game:in-progress',
      JSON.stringify({
        v: 2,
        pgn: '1. d4 d5 *',
        setup: { white: human, black: human, timeControl: { kind: 'untimed' } },
        scored: false,
        recorded: false,
      }),
    )
    const cfg: MatchConfig = { white: engine, black: human, timeControl: { kind: 'untimed' } }
    const { result } = renderHook(() => useMatchRecords(snapshotOf(SCHOLARS_MATE, cfg, true), null))

    expect(result.current.resumeChoice).toBe('pending')
    // The finished match is still scored and recorded...
    expect(loadScore()).toEqual({ wins: 0, losses: 1, draws: 0 })
    expect(loadHistory()).toHaveLength(1)
    // ...but the UNRELATED saved game the resume banner is still offering
    // survives, exactly as the banner promises.
    expect(loadInProgress()?.pgn).toBe('1. d4 d5 *')
  })
})
