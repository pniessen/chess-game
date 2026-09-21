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
})
