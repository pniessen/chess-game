import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Game } from '../../game-core/game'
import { gameFromSan } from '../../game-core/io'
import type { Square } from '../../game-core/types'
import type { MatchConfig, MatchSnapshot } from '../../match/types'
import { useEndCard } from './useEndCard'

/**
 * Task 6: the game-end card fires for a game that ends LIVE and for nothing
 * else. Each test below names the change that turns it red.
 */

const human = { kind: 'human' } as const
const config: MatchConfig = { white: human, black: human, timeControl: { kind: 'untimed' } }
const clock = { whiteMs: 0, blackMs: 0, running: null, flagged: null }

const SCHOLARS_MATE: Array<[Square, Square]> = [
  ['e2', 'e4'], ['e7', 'e5'],
  ['f1', 'c4'], ['b8', 'c6'],
  ['d1', 'h5'], ['g8', 'f6'],
  ['h5', 'f7'],
]

/** A live game, played up to (but not including) the mating move. */
function almostMated(): Game {
  const game = new Game()
  for (const [from, to] of SCHOLARS_MATE.slice(0, -1)) {
    const r = game.play({ from, to })
    if (!r.ok) throw new Error(`illegal setup move ${from}${to}`)
  }
  return game
}

function mate(game: Game): void {
  const [from, to] = SCHOLARS_MATE[SCHOLARS_MATE.length - 1]!
  const r = game.play({ from, to })
  if (!r.ok) throw new Error('illegal mating move')
}

const live = (game: Game): MatchSnapshot => ({
  phase: { kind: 'awaiting-human', side: game.current().turn() },
  game,
  clock,
  config,
})

const finished = (game: Game): MatchSnapshot => ({
  phase: { kind: 'finished', status: game.status(), reason: 'normal', winner: 'w' },
  game,
  clock,
  config,
})

describe('useEndCard', () => {
  // Red if a live finish stops opening the card at all.
  test('opens when a game the hook has seen unfinished reaches a finish', () => {
    const game = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(game) } })
    expect(result.current.open).toBe(false)

    act(() => mate(game))
    rerender({ s: finished(game) })
    expect(result.current.open).toBe(true)
  })

  // Red if the card starts firing for an imported/resumed/replayed game:
  // every load builds a NEW Game (controller.begin), so a finish that
  // arrives on a game id the hook has never seen unfinished is not live.
  test('never opens for a game that arrives already finished on a new game object', () => {
    const played = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(played) } })

    const built = gameFromSan(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])
    if (!built.ok) throw new Error(built.error)
    rerender({ s: finished(built.game) })
    expect(result.current.open).toBe(false)
  })

  // Red if `reset()` (called from startMatch/loadMatch) stops clearing what
  // the hook had seen — the belt to the game-id braces above, and what makes
  // `handleReplay`'s load()-then-finishAs() safe even on one Game object.
  test('reset() makes the next finish, whatever it lands on, not a live one', () => {
    const game = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(game) } })

    act(() => result.current.reset())
    act(() => mate(game))
    rerender({ s: finished(game) })
    expect(result.current.open).toBe(false)
  })

  // Red if the card is left standing over a position that is live again.
  test('an undo out of the finished phase closes the card', () => {
    const game = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(game) } })
    act(() => mate(game))
    rerender({ s: finished(game) })
    expect(result.current.open).toBe(true)

    act(() => {
      game.undo()
    })
    rerender({ s: live(game) })
    expect(result.current.open).toBe(false)
  })

  // Red if one finish can pop the card twice — the same guarantee
  // recordedRef gives history recording.
  test('redoing back onto the same finish does not re-open a dismissed card', () => {
    const game = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(game) } })
    act(() => mate(game))
    rerender({ s: finished(game) })
    act(() => result.current.dismiss())
    expect(result.current.open).toBe(false)

    act(() => {
      game.undo()
    })
    rerender({ s: live(game) })
    act(() => {
      game.redo()
    })
    rerender({ s: finished(game) })
    expect(result.current.open).toBe(false)
  })

  // Red if the key were the Game object alone: a different line played on
  // the SAME object (undo -> another move -> mate) is a different game and
  // does deserve its own card.
  test('a different finish on the same game object opens the card again', () => {
    const game = almostMated()
    const { result, rerender } = renderHook(({ s }) => useEndCard(s), { initialProps: { s: live(game) } })
    act(() => mate(game))
    rerender({ s: finished(game) })
    act(() => result.current.dismiss())

    // Take the mate back and play a different line to a different mate.
    act(() => {
      game.undo()
    })
    rerender({ s: live(game) })
    act(() => {
      game.play({ from: 'b1', to: 'c3' })
      game.play({ from: 'f8', to: 'e7' })
    })
    rerender({ s: live(game) })
    act(() => {
      game.play({ from: 'h5', to: 'f7' })
    })
    expect(game.status().kind).toBe('checkmate')
    rerender({ s: finished(game) })
    expect(result.current.open).toBe(true)
  })
})
