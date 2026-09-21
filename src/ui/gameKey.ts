import type { Game } from '../game-core/game'

const ids = new WeakMap<Game, number>()
let next = 1

/** A stable number per Game object: a new game or a load gets a new id. */
export function gameIdOf(game: Game): number {
  let id = ids.get(game)
  if (id === undefined) {
    id = next++
    ids.set(game, id)
  }
  return id
}

/**
 * Identifies a Game object AND its exact live move list (ruling P5): the
 * gameId alone is not enough, because `MatchController` mutates ONE `Game`
 * object in place across undo/redo/new moves (see controller.ts) — the same
 * object can carry many different move lists over its lifetime. App's
 * `reviewKey` and Task 13's history-accuracy write guard both use this, so
 * that a review can never be attached to the wrong history entry merely
 * because it happens to share a `Game` object (identity) with the entry that
 * WAS recorded, when the actual moves differ (e.g. finish A -> undo -> play a
 * different line -> finish B: same object, different game).
 */
export function reviewKeyOf(game: Game): string {
  return `${gameIdOf(game)}|${game.moves.map((m) => m.san).join(' ')}`
}
