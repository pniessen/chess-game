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
