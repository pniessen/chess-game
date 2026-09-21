import { describe, expect, test } from 'vitest'
import { Position } from '../../game-core/position'
import { reduceSelection, type SelectionState } from './selection'

const idle: SelectionState = { kind: 'idle' }

describe('reduceSelection', () => {
  test('clicking own piece selects it', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e2' }, new Position())
    expect(out.state).toEqual({ kind: 'selected', square: 'e2' })
    expect(out.move).toBeUndefined()
  })

  test('clicking an empty square while idle does nothing', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e4' }, new Position())
    expect(out.state).toEqual(idle)
  })

  test('clicking the opponent piece while idle does nothing', () => {
    const out = reduceSelection(idle, { kind: 'square-clicked', square: 'e7' }, new Position())
    expect(out.state).toEqual(idle)
  })

  test('selecting then clicking a legal destination emits the move', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e4' },
      new Position(),
    )
    expect(out.move).toEqual({ from: 'e2', to: 'e4' })
    expect(out.state).toEqual(idle)
  })

  test('clicking the selected square deselects', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e2' },
      new Position(),
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })

  test('clicking another own piece re-selects rather than failing', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'd2' },
      new Position(),
    )
    expect(out.state).toEqual({ kind: 'selected', square: 'd2' })
    expect(out.move).toBeUndefined()
  })

  test('clicking an illegal empty destination deselects without a move', () => {
    const out = reduceSelection(
      { kind: 'selected', square: 'e2' },
      { kind: 'square-clicked', square: 'e5' },
      new Position(),
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })

  test('a promotion destination asks for a piece instead of emitting a move', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'selected', square: 'a7' },
      { kind: 'square-clicked', square: 'a8' },
      pos,
    )
    expect(out.state).toEqual({ kind: 'awaiting-promotion', from: 'a7', to: 'a8' })
    expect(out.move).toBeUndefined()
  })

  test('choosing a promotion piece emits the complete move', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'awaiting-promotion', from: 'a7', to: 'a8' },
      { kind: 'promotion-chosen', piece: 'n' },
      pos,
    )
    expect(out.move).toEqual({ from: 'a7', to: 'a8', promotion: 'n' })
    expect(out.state).toEqual(idle)
  })

  test('cancelling a promotion emits no move at all', () => {
    const pos = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1')
    const out = reduceSelection(
      { kind: 'awaiting-promotion', from: 'a7', to: 'a8' },
      { kind: 'cancel' },
      pos,
    )
    expect(out.state).toEqual(idle)
    expect(out.move).toBeUndefined()
  })
})
