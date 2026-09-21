import { describe, expect, test } from 'vitest'
import { Game } from './game'

describe('Game', () => {
  test('plays moves and records SAN history', () => {
    const g = new Game()
    expect(g.play({ from: 'e2', to: 'e4' }).ok).toBe(true)
    expect(g.play({ from: 'e7', to: 'e5' }).ok).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5'])
    expect(g.livePly).toBe(2)
    expect(g.current().turn()).toBe('w')
  })

  test('undo removes the last move; redo restores it', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    expect(g.undo()).toBe(true)
    expect(g.moves).toHaveLength(0)
    expect(g.current().turn()).toBe('w')
    expect(g.redo()).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4'])
  })

  test('undo on an empty game returns false', () => {
    expect(new Game().undo()).toBe(false)
  })

  test('goTo shows an earlier position without discarding later moves', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    expect(g.ply).toBe(1)
    expect(g.isViewingLive()).toBe(false)
    expect(g.livePly).toBe(2)
    expect(g.moves).toHaveLength(2)
  })

  test('playing while browsing history is refused, not silently destructive', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    const r = g.play({ from: 'd7', to: 'd5' })
    expect(r.ok).toBe(false)
    expect(g.moves).toHaveLength(2)
  })

  test('truncate then play branches deliberately', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'e7', to: 'e5' })
    g.goTo(1)
    g.truncate(1)
    expect(g.play({ from: 'c7', to: 'c5' }).ok).toBe(true)
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'c5'])
  })

  test('epds lists the position after each ply up to the requested one', () => {
    const g = new Game()
    g.play({ from: 'e2', to: 'e4' })
    g.play({ from: 'c7', to: 'c5' })
    const epds = g.epds(2)
    expect(epds).toHaveLength(3)
    expect(epds[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
    expect(epds[2]).toBe('rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -')
    expect(g.epds(99)).toHaveLength(3) // clamped to the live ply
    expect(g.epds(0)).toHaveLength(1)
  })
})
