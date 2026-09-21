import { describe, expect, test } from 'vitest'
import { Game } from '../game-core/game'
import type { Square } from '../game-core/types'
import { displayedSanKeyOf, gameIdOf, hintKeyOf, liveKeyOf, reviewKeyOf } from './gameKey'

function play(game: Game, ...moves: Array<[Square, Square]>) {
  for (const [from, to] of moves) {
    const r = game.play({ from, to })
    if (!r.ok) throw new Error(`illegal ${from}${to}`)
  }
}

describe('gameKey', () => {
  test('liveKeyOf is the full live SAN list, independent of the browsed ply', () => {
    const g = new Game()
    play(g, ['e2', 'e4'], ['e7', 'e5'])
    expect(liveKeyOf(g)).toBe('e4 e5')
    g.goTo(1)
    expect(liveKeyOf(g)).toBe('e4 e5')
  })

  test('displayedSanKeyOf is the SAN list up to the displayed ply', () => {
    const g = new Game()
    play(g, ['e2', 'e4'], ['e7', 'e5'])
    g.goTo(1)
    expect(displayedSanKeyOf(g)).toBe('e4')
  })

  test('reviewKeyOf is the game id plus the live key', () => {
    const g = new Game()
    play(g, ['e2', 'e4'])
    expect(reviewKeyOf(g)).toBe(`${gameIdOf(g)}|e4`)
  })

  test('hintKeyOf changes when the game finishes on the same ply (resign / flag)', () => {
    const g = new Game()
    play(g, ['e2', 'e4'])
    expect(hintKeyOf(g, 'awaiting-human')).not.toBe(hintKeyOf(g, 'finished'))
  })

  test('hintKeyOf is unchanged by a pause, and changes on a move or navigation', () => {
    const g = new Game()
    play(g, ['e2', 'e4'])
    const before = hintKeyOf(g, 'awaiting-human')
    expect(hintKeyOf(g, 'paused')).toBe(before)
    expect(hintKeyOf(g, 'engine-thinking')).toBe(before)
    g.goTo(0)
    expect(hintKeyOf(g, 'awaiting-human')).not.toBe(before)
  })
})
