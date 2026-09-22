import { expect, test } from 'vitest'
import { historyEntryFor, humanSidesOf, seatLabel } from './record'
import { gameFromSan } from '../../game-core/io'
import type { MatchConfig } from '../../match/types'

const TWO: MatchConfig = { white: { kind: 'human' }, black: { kind: 'human' }, timeControl: { kind: 'untimed' } }
const NOW = new Date('2026-09-21T10:00:00.000Z')

function scholar() {
  const r = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
  if (!r.ok) throw new Error(r.error)
  return r.game
}

test('a checkmate becomes a history entry with a PGN carrying the result', () => {
  const game = scholar()
  const e = historyEntryFor({
    phase: { kind: 'finished', status: game.status(), reason: 'normal', winner: 'w' },
    game,
    config: TWO,
    opening: "C23 Bishop's Opening",
    now: NOW,
    id: 'id-1',
  })
  expect(e).toMatchObject({ id: 'id-1', date: '2026-09-21T10:00:00.000Z', result: '1-0', termination: 'normal', accuracy: null })
  expect(e?.pgn).toContain('[Result "1-0"]')
  expect(e?.pgn).toContain('Qxf7#')
})

test('a resignation keeps its termination and winner', () => {
  const r = gameFromSan(['e4'])
  if (!r.ok) throw new Error(r.error)
  const e = historyEntryFor({
    phase: { kind: 'finished', status: r.game.status(), reason: 'resign', winner: 'w' },
    game: r.game,
    config: { ...TWO, black: { kind: 'engine', level: 5 } },
    opening: null,
    now: NOW,
    id: 'id-2',
  })
  expect(e).toMatchObject({ result: '1-0', termination: 'resign', black: 'Stockfish (level 5)' })
  expect(e?.pgn).toContain('[Black "Stockfish (level 5)"]')
})

test('engine errors and empty games are not recorded', () => {
  const game = scholar()
  expect(historyEntryFor({ phase: { kind: 'finished', status: game.status(), reason: 'engine-error', winner: null }, game, config: TWO, opening: null, now: NOW, id: 'x' })).toBeNull()
  const empty = gameFromSan([])
  if (!empty.ok) throw new Error(empty.error)
  expect(historyEntryFor({ phase: { kind: 'finished', status: empty.game.status(), reason: 'resign', winner: 'b' }, game: empty.game, config: TWO, opening: null, now: NOW, id: 'x' })).toBeNull()
})

test('seatLabel', () => {
  expect(seatLabel({ kind: 'human' })).toBe('Human')
  expect(seatLabel({ kind: 'engine', level: 2 })).toBe('Stockfish (level 2)')
})

test('a zero-player (engine-vs-engine) game is still recorded — it is a game', () => {
  const game = scholar()
  const zeroPlayer: MatchConfig = {
    white: { kind: 'engine', level: 1 },
    black: { kind: 'engine', level: 4 },
    timeControl: { kind: 'untimed' },
  }
  const e = historyEntryFor({
    phase: { kind: 'finished', status: game.status(), reason: 'normal', winner: 'w' },
    game,
    config: zeroPlayer,
    opening: null,
    now: NOW,
    id: 'zp-1',
  })
  expect(e).toMatchObject({ white: 'Stockfish (level 1)', black: 'Stockfish (level 4)', result: '1-0' })
})

test('humanSidesOf reads the stored seat labels', () => {
  expect(humanSidesOf({ white: 'Human', black: 'Stockfish (level 3)' })).toEqual(['w'])
  expect(humanSidesOf({ white: 'Stockfish (level 3)', black: 'Human' })).toEqual(['b'])
  expect(humanSidesOf({ white: 'Human', black: 'Human' })).toEqual(['w', 'b'])
  expect(humanSidesOf({ white: 'Stockfish (level 1)', black: 'Stockfish (level 1)' })).toEqual([])
})
