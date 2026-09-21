import type { Game } from '../game-core/game'
import type { MatchPhase } from '../match/types'

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
  return `${gameIdOf(game)}|${liveKeyOf(game)}`
}

const sanKey = (game: Game, plies: number): string =>
  game.moves.slice(0, plies).map((m) => m.san).join(' ')

/**
 * The LIVE game's full SAN list, whatever ply is being browsed. An undo
 * followed by a different move keeps the same Game object and length, so
 * the SANs themselves are the key.
 */
export function liveKeyOf(game: Game): string {
  return sanKey(game, game.livePly)
}

/**
 * The SANs up to the DISPLAYED ply (what the board shows while browsing):
 * the opening name follows the browsed position, not the live one.
 */
export function displayedSanKeyOf(game: Game): string {
  return sanKey(game, game.ply)
}

/**
 * Must change on any move, undo/redo, navigation, new game, AND the game
 * ending: a hint still pending when the human resigns or a clock flags has
 * to be dropped, even though neither changes the ply. Only `finished`
 * matters; a pause or the engine starting to think leaves a hint alone.
 */
export function hintKeyOf(game: Game, phaseKind: MatchPhase['kind']): string {
  const over = phaseKind === 'finished' ? 'over' : 'live'
  return `${gameIdOf(game)}:${game.livePly}:${game.ply}:${over}`
}
